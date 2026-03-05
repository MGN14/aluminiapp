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
import { Download, FileSpreadsheet, Loader2, ShieldAlert, CheckCircle2, Send, ArrowRight, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import writeXlsxFile from 'write-excel-file';
import NicoChat from '@/components/nico/NicoChat';
import nicoAvatar from '@/assets/nico-avatar.png';

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

  const taxSummary = useMemo(() => {
    const cuatrimestre = getCurrentCuatrimestre();
    const currentMonth = getCurrentMonth();

    const cuatrimestreIVA = transactions
      .filter(tx => {
        const txDate = new Date(tx.date);
        return txDate >= cuatrimestre.start && txDate <= cuatrimestre.end;
      })
      .reduce((sum, tx) => sum + (tx.iva_amount ?? 0), 0);

    const totalIVA = transactions.reduce((sum, tx) => sum + (tx.iva_amount ?? 0), 0);
    const ivaCount = transactions.filter(tx => tx.has_iva).length;

    const monthlyRetefuente = transactions
      .filter(tx => {
        const txDate = new Date(tx.date);
        return txDate >= currentMonth.start && txDate <= currentMonth.end;
      })
      .reduce((sum, tx) => sum + (tx.retefuente_amount ?? 0), 0);

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

      const txHeader = [
        { value: 'Fecha', fontWeight: 'bold' as const },
        { value: 'Descripción', fontWeight: 'bold' as const },
        { value: 'Monto', fontWeight: 'bold' as const },
        { value: 'Tipo', fontWeight: 'bold' as const },
        { value: 'Categoría', fontWeight: 'bold' as const },
        { value: 'Responsable', fontWeight: 'bold' as const },
        { value: 'Conciliado', fontWeight: 'bold' as const },
        { value: 'Aplica IVA', fontWeight: 'bold' as const },
        { value: 'IVA Calculado', fontWeight: 'bold' as const },
        { value: 'Tasa IVA', fontWeight: 'bold' as const },
        { value: 'Aplica Retefuente', fontWeight: 'bold' as const },
        { value: 'Retefuente Calculada', fontWeight: 'bold' as const },
        { value: 'Tasa Retefuente', fontWeight: 'bold' as const },
        { value: 'Notas', fontWeight: 'bold' as const },
      ];

      const txRows = transactions.map(tx => [
        { type: String, value: tx.date },
        { type: String, value: tx.description },
        { type: Number, value: tx.amount ?? 0 },
        { type: String, value: tx.type === 'ingreso' ? 'Ingreso' : tx.type === 'egreso' ? 'Egreso' : 'Transferencia' },
        { type: String, value: getCategoryName(tx) },
        { type: String, value: getResponsibleName(tx) },
        { type: String, value: tx.responsible_id ? 'Sí' : 'No' },
        { type: String, value: tx.has_iva ? 'Sí' : 'No' },
        { type: Number, value: tx.iva_amount > 0 ? tx.iva_amount : 0 },
        { type: String, value: tx.has_iva ? `${(tx.iva_rate * 100).toFixed(0)}%` : '' },
        { type: String, value: tx.has_retefuente ? 'Sí' : 'No' },
        { type: Number, value: tx.retefuente_amount > 0 ? tx.retefuente_amount : 0 },
        { type: String, value: tx.has_retefuente ? `${(tx.retefuente_rate * 100).toFixed(1)}%` : '' },
        { type: String, value: tx.notes || '' },
      ] as const);

      const sheet1Data = [txHeader, ...txRows];

      const dianHeader = [
        { value: 'Concepto', fontWeight: 'bold' as const },
        { value: 'Período', fontWeight: 'bold' as const },
        { value: 'Monto', fontWeight: 'bold' as const },
        { value: 'Transacciones', fontWeight: 'bold' as const },
      ];

      const totalIncome = transactions.filter(tx => (tx.amount ?? 0) > 0).reduce((sum, tx) => sum + (tx.amount ?? 0), 0);
      const totalExpenses = Math.abs(transactions.filter(tx => (tx.amount ?? 0) < 0).reduce((sum, tx) => sum + (tx.amount ?? 0), 0));
      const reconciled = transactions.filter(tx => tx.responsible_id).length;
      const pending = transactions.filter(tx => !tx.responsible_id).length;

      const sheet2Data = [
        dianHeader,
        [{ type: String, value: 'IVA por Pagar - Cuatrimestre' }, { type: String, value: taxSummary.cuatrimestreLabel }, { type: Number, value: taxSummary.cuatrimestreIVA }, { type: Number, value: taxSummary.ivaCount }],
        [{ type: String, value: 'IVA Total Acumulado' }, { type: String, value: 'Todo' }, { type: Number, value: taxSummary.totalIVA }, { type: Number, value: taxSummary.ivaCount }],
        [{ type: String, value: 'Retefuente por Pagar - Mes' }, { type: String, value: taxSummary.monthLabel }, { type: Number, value: taxSummary.monthlyRetefuente }, { type: Number, value: 0 }],
        [{ type: String, value: 'Retefuente Total Acumulada' }, { type: String, value: 'Todo' }, { type: Number, value: taxSummary.totalRetefuente }, { type: Number, value: taxSummary.retefuenteCount }],
        [{ type: String, value: '' }, { type: String, value: '' }, { type: Number, value: 0 }, { type: Number, value: 0 }],
        [{ type: String, value: 'OBLIGACIÓN DIAN ESTIMADA' }, { type: String, value: taxSummary.cuatrimestreLabel }, { type: Number, value: taxSummary.cuatrimestreIVA + taxSummary.monthlyRetefuente }, { type: Number, value: 0 }],
      ] as any;

      const summaryHeader = [
        { value: 'Métrica', fontWeight: 'bold' as const },
        { value: 'Valor', fontWeight: 'bold' as const },
      ];

      const sheet3Data = [
        summaryHeader,
        [{ type: String, value: 'Total Ingresos' }, { type: Number, value: totalIncome }],
        [{ type: String, value: 'Total Egresos' }, { type: Number, value: totalExpenses }],
        [{ type: String, value: 'Saldo Neto' }, { type: Number, value: totalIncome - totalExpenses }],
        [{ type: String, value: 'Transacciones Totales' }, { type: Number, value: transactions.length }],
        [{ type: String, value: 'Transacciones Conciliadas' }, { type: Number, value: reconciled }],
        [{ type: String, value: 'Pendientes por Conciliar' }, { type: Number, value: pending }],
      ] as any;

      const fileName = `aluminia_export_${new Date().toISOString().split('T')[0]}.xlsx`;

      await writeXlsxFile([sheet1Data, sheet2Data, sheet3Data] as any, {
        sheets: ['Transacciones', 'Resumen DIAN', 'Resumen General'],
        fileName,
        columns: [
          [
            { width: 12 }, { width: 50 }, { width: 15 }, { width: 12 },
            { width: 18 }, { width: 15 }, { width: 10 }, { width: 10 },
            { width: 15 }, { width: 10 }, { width: 12 }, { width: 15 },
            { width: 10 }, { width: 25 },
          ],
          [{ width: 30 }, { width: 15 }, { width: 18 }, { width: 15 }],
          [{ width: 25 }, { width: 18 }],
        ],
      });

      toast({
        title: 'Exportación exitosa',
        description: `Se exportaron ${transactions.length} transacciones.`,
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

  const steps = [
    { number: 1, label: 'Exporta tu archivo', desc: 'Descarga el Excel con todas tus transacciones conciliadas.' },
    { number: 2, label: 'Envíalo a tu contadora', desc: 'Comparte el archivo con tu contador(a) para registro contable.' },
    { number: 3, label: 'Verifica la conciliación', desc: 'Confirma que todo quede cuadrado en el sistema contable.' },
  ];

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Exportar Datos</h1>
          <p className="text-muted-foreground">
            Descarga tus transacciones organizadas para tu contadora.
          </p>
        </div>

        {/* Workflow Steps */}
        <Card className="border-accent/20 bg-accent/5">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-2 items-stretch">
              {steps.map((step, i) => (
                <div key={step.number} className="flex-1 flex items-start gap-3 sm:flex-col sm:items-center sm:text-center">
                  <div className="flex items-center gap-2 sm:flex-col">
                    <div className="w-8 h-8 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-sm font-bold shrink-0">
                      {step.number}
                    </div>
                    {i < steps.length - 1 && (
                      <ArrowRight className="h-4 w-4 text-muted-foreground hidden sm:block mt-2" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{step.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Nico Assistant */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-success/30 shrink-0">
                <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
              </div>
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  Pregúntale a Nico
                  <Sparkles className="h-4 w-4 text-success" />
                </CardTitle>
                <CardDescription>
                  ¿Dudas sobre tus datos antes de exportar? Nico te ayuda.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] rounded-lg border border-border overflow-hidden">
              <NicoChat />
            </div>
          </CardContent>
        </Card>

        {/* Export Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Exportar a Excel
            </CardTitle>
            <CardDescription>
              Incluye: Transacciones, Resumen DIAN y Resumen General
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

        {/* Disclaimer */}
        <Card className="border-muted bg-muted/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground text-sm">Aviso de responsabilidad</p>
                <p>
                  AluminIA es una herramienta de apoyo para la organización financiera. Los datos exportados son de carácter informativo y no reemplazan la asesoría de un contador público certificado. AluminIA no se hace responsable por decisiones tributarias, declaraciones fiscales ni errores contables derivados del uso de esta información. Siempre valida los datos con tu profesional contable antes de presentar declaraciones ante la DIAN u otras entidades.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
