import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/layout/AppLayout';
import { Transaction, Category, Responsible, getCurrentCuatrimestre, getCurrentMonth } from '@/types/transaction';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Download, FileSpreadsheet, Loader2, Receipt } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

interface Statement {
  id: string;
  file_name: string;
}

export default function Export() {
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const [selectedStatement, setSelectedStatement] = useState<string>('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchStatements();
    fetchCategories();
    fetchResponsibles();
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [selectedStatement]);

  const fetchStatements = async () => {
    const { data } = await supabase
      .from('bank_statements')
      .select('id, file_name')
      .order('uploaded_at', { ascending: false });
    setStatements(data || []);
  };

  const fetchCategories = async () => {
    const { data } = await supabase.from('categories').select('*').order('sort_order');
    setCategories((data as Category[]) || []);
  };

  const fetchResponsibles = async () => {
    const { data } = await supabase.from('responsibles').select('*').order('name');
    setResponsibles((data as Responsible[]) || []);
  };

  const fetchTransactions = async () => {
    let query = supabase
      .from('transactions')
      .select('*')
      .order('date', { ascending: false });

    if (selectedStatement !== 'all') {
      query = query.eq('statement_id', selectedStatement);
    }

    const { data } = await query;
    setTransactions((data as Transaction[]) || []);
  };

  const getCategoryName = (tx: Transaction) => {
    if (tx.category_id) {
      const cat = categories.find(c => c.id === tx.category_id);
      return cat?.name || '';
    }
    return tx.category || '';
  };

  const getResponsibleName = (tx: Transaction) => {
    if (tx.responsible_id) {
      const resp = responsibles.find(r => r.id === tx.responsible_id);
      return resp?.name || '';
    }
    return tx.owner || '';
  };

  // Calculate tax summaries using server-calculated values
  const taxSummary = useMemo(() => {
    const cuatrimestre = getCurrentCuatrimestre();
    const currentMonth = getCurrentMonth();

    // Cuatrimestre IVA - sum iva_amount for transactions in period
    const cuatrimestreIVA = transactions
      .filter(tx => {
        const txDate = new Date(tx.date);
        return txDate >= cuatrimestre.start && txDate <= cuatrimestre.end;
      })
      .reduce((sum, tx) => sum + (tx.iva_amount ?? 0), 0);

    // Total IVA
    const totalIVA = transactions.reduce((sum, tx) => sum + (tx.iva_amount ?? 0), 0);
    const ivaCount = transactions.filter(tx => tx.has_iva).length;

    // Monthly retefuente - sum retefuente_amount for transactions in period
    const monthlyRetefuente = transactions
      .filter(tx => {
        const txDate = new Date(tx.date);
        return txDate >= currentMonth.start && txDate <= currentMonth.end;
      })
      .reduce((sum, tx) => sum + (tx.retefuente_amount ?? 0), 0);

    // Total retefuente
    const totalRetefuente = transactions.reduce((sum, tx) => sum + (tx.retefuente_amount ?? 0), 0);
    const retefuenteCount = transactions.filter(tx => tx.has_retefuente).length;

    return {
      totalIVA,
      cuatrimestreIVA,
      cuatrimestreLabel: cuatrimestre.label,
      totalRetefuente,
      monthlyRetefuente,
      monthLabel: currentMonth.label,
      ivaCount,
      retefuenteCount,
    };
  }, [transactions]);

  const handleExport = async () => {
    setLoading(true);
    try {
      if (!transactions || transactions.length === 0) {
        toast({
          title: 'Sin datos',
          description: 'No hay transacciones para exportar.',
          variant: 'destructive',
        });
        return;
      }

      // Sheet 1: Transactions
      const transactionData = transactions.map(tx => ({
        'Fecha': tx.date,
        'Descripción': tx.description,
        'Sucursal': tx.sucursal || '',
        'Dcto': tx.dcto || '',
        'Monto': tx.amount,
        'Débito': tx.debit || '',
        'Crédito': tx.credit || '',
        'Saldo': tx.balance || '',
        'Categoría': getCategoryName(tx),
        'Responsable': getResponsibleName(tx),
        'Pendiente': tx.responsible_id ? 'No' : 'Sí',
        'Aplica IVA': tx.has_iva ? 'Sí' : 'No',
        'IVA Calculado': tx.iva_amount > 0 ? tx.iva_amount : '',
        'Tasa IVA': tx.has_iva ? `${(tx.iva_rate * 100).toFixed(0)}%` : '',
        'Aplica Retefuente': tx.has_retefuente ? 'Sí' : 'No',
        'Retefuente Calculada': tx.retefuente_amount > 0 ? tx.retefuente_amount : '',
        'Tasa Retefuente': tx.has_retefuente ? `${(tx.retefuente_rate * 100).toFixed(1)}%` : '',
        'Notas': tx.notes || '',
      }));

      const wsTransactions = XLSX.utils.json_to_sheet(transactionData);
      
      // Set column widths
      wsTransactions['!cols'] = [
        { wch: 12 },  // Fecha
        { wch: 50 },  // Descripción (más ancha)
        { wch: 12 },  // Sucursal
        { wch: 12 },  // Dcto
        { wch: 15 },  // Monto
        { wch: 15 },  // Débito
        { wch: 15 },  // Crédito
        { wch: 15 },  // Saldo
        { wch: 18 },  // Categoría
        { wch: 15 },  // Responsable
        { wch: 10 },  // Pendiente
        { wch: 12 },  // Aplica IVA
        { wch: 15 },  // IVA Calculado
        { wch: 10 },  // Tasa IVA
        { wch: 15 },  // Aplica Retefuente
        { wch: 18 },  // Retefuente Calculada
        { wch: 12 },  // Tasa Retefuente
        { wch: 25 },  // Notas
      ];

      // Sheet 2: DIAN Summary
      const dianSummaryData = [
        { 'Concepto': 'IVA por Pagar - Cuatrimestre', 'Período': taxSummary.cuatrimestreLabel, 'Monto': taxSummary.cuatrimestreIVA, 'Transacciones': taxSummary.ivaCount },
        { 'Concepto': 'IVA Total Acumulado', 'Período': 'Todo', 'Monto': taxSummary.totalIVA, 'Transacciones': taxSummary.ivaCount },
        { 'Concepto': 'Retefuente por Pagar - Mes', 'Período': taxSummary.monthLabel, 'Monto': taxSummary.monthlyRetefuente, 'Transacciones': '' },
        { 'Concepto': 'Retefuente Total Acumulada', 'Período': 'Todo', 'Monto': taxSummary.totalRetefuente, 'Transacciones': taxSummary.retefuenteCount },
        { 'Concepto': '', 'Período': '', 'Monto': '', 'Transacciones': '' },
        { 'Concepto': 'OBLIGACIÓN DIAN ESTIMADA', 'Período': taxSummary.cuatrimestreLabel, 'Monto': taxSummary.cuatrimestreIVA + taxSummary.monthlyRetefuente, 'Transacciones': '' },
      ];

      const wsDIAN = XLSX.utils.json_to_sheet(dianSummaryData);
      wsDIAN['!cols'] = [
        { wch: 30 },
        { wch: 15 },
        { wch: 18 },
        { wch: 15 },
      ];

      // Sheet 3: Income Summary
      const totalIncome = transactions.filter(tx => (tx.amount ?? 0) > 0).reduce((sum, tx) => sum + (tx.amount ?? 0), 0);
      const totalExpenses = Math.abs(transactions.filter(tx => (tx.amount ?? 0) < 0).reduce((sum, tx) => sum + (tx.amount ?? 0), 0));
      const reconciled = transactions.filter(tx => tx.responsible_id).length;
      const pending = transactions.filter(tx => !tx.responsible_id).length;
      
      const summaryData = [
        { 'Métrica': 'Total Ingresos', 'Valor': totalIncome },
        { 'Métrica': 'Total Egresos', 'Valor': totalExpenses },
        { 'Métrica': 'Saldo Neto', 'Valor': totalIncome - totalExpenses },
        { 'Métrica': 'Transacciones Totales', 'Valor': transactions.length },
        { 'Métrica': 'Transacciones Conciliadas', 'Valor': reconciled },
        { 'Métrica': 'Pendientes por Conciliar', 'Valor': pending },
      ];

      const wsSummary = XLSX.utils.json_to_sheet(summaryData);
      wsSummary['!cols'] = [
        { wch: 25 },
        { wch: 18 },
      ];

      // Create workbook with all sheets
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsTransactions, 'Transacciones');
      XLSX.utils.book_append_sheet(wb, wsDIAN, 'Resumen DIAN');
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen General');

      const fileName = `aluminia_export_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

      toast({
        title: 'Exportación exitosa',
        description: `Se exportaron ${transactions.length} transacciones con resumen DIAN.`,
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Error',
        description: 'No se pudo exportar el archivo.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Exportar Datos</h1>
          <p className="text-muted-foreground">
            Descarga tus transacciones con cálculos de impuestos en Excel.
          </p>
        </div>

        {/* Tax Summary Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Resumen de Obligaciones DIAN
            </CardTitle>
            <CardDescription>
              Estos valores se incluirán en la hoja "Resumen DIAN" del Excel
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="p-4 rounded-lg bg-muted/50 border border-border">
                <p className="text-sm text-muted-foreground">IVA por Pagar</p>
                <p className="text-xl font-bold text-accent">{formatCurrency(taxSummary.cuatrimestreIVA)}</p>
                <p className="text-xs text-muted-foreground mt-1">{taxSummary.cuatrimestreLabel} • {taxSummary.ivaCount} transacciones</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 border border-border">
                <p className="text-sm text-muted-foreground">Retefuente por Pagar</p>
                <p className="text-xl font-bold text-accent">{formatCurrency(taxSummary.monthlyRetefuente)}</p>
                <p className="text-xs text-muted-foreground mt-1">{taxSummary.monthLabel} (2.5%)</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Exportar a Excel
            </CardTitle>
            <CardDescription>
              El archivo incluye: Transacciones, Resumen DIAN y Resumen General
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Extracto
              </label>
              <Select value={selectedStatement} onValueChange={setSelectedStatement}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos los extractos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los extractos</SelectItem>
                  {statements.map((stmt) => (
                    <SelectItem key={stmt.id} value={stmt.id}>
                      {stmt.file_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="p-4 rounded-lg bg-muted/50 border border-border">
              <p className="text-sm text-muted-foreground">
                Se exportarán <span className="font-semibold text-foreground">{transactions.length}</span> transacciones
                con los siguientes datos:
              </p>
              <ul className="mt-2 text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>Fecha, descripción completa, sucursal, documento</li>
                <li>Monto, débito, crédito, saldo</li>
                <li>Categoría y responsable</li>
                <li>Estado pendiente (sin responsable = pendiente)</li>
                <li>Cálculos de IVA y Retefuente con tasas</li>
                <li>Notas del usuario</li>
              </ul>
            </div>

            <Button 
              onClick={handleExport} 
              disabled={loading || transactions.length === 0}
              className="w-full"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Exportando...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Descargar Excel
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
