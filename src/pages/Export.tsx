import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/layout/AppLayout';
import { Transaction, CATEGORIES } from '@/types/transaction';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

interface Statement {
  id: string;
  file_name: string;
}

export default function Export() {
  const { toast } = useToast();
  const [statements, setStatements] = useState<Statement[]>([]);
  const [selectedStatement, setSelectedStatement] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [transactionCount, setTransactionCount] = useState(0);

  useEffect(() => {
    fetchStatements();
  }, []);

  useEffect(() => {
    fetchTransactionCount();
  }, [selectedStatement]);

  const fetchStatements = async () => {
    const { data } = await supabase
      .from('bank_statements')
      .select('id, file_name')
      .order('uploaded_at', { ascending: false });
    setStatements(data || []);
  };

  const fetchTransactionCount = async () => {
    let query = supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true });

    if (selectedStatement !== 'all') {
      query = query.eq('statement_id', selectedStatement);
    }

    const { count } = await query;
    setTransactionCount(count || 0);
  };

  const getCategoryLabel = (value: string | null) => {
    if (!value) return '';
    const cat = CATEGORIES.find(c => c.value === value);
    return cat?.label || value;
  };

  const handleExport = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('transactions')
        .select('*')
        .order('date', { ascending: false });

      if (selectedStatement !== 'all') {
        query = query.eq('statement_id', selectedStatement);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length === 0) {
        toast({
          title: 'Sin datos',
          description: 'No hay transacciones para exportar.',
          variant: 'destructive',
        });
        return;
      }

      const exportData = data.map(tx => ({
        'Fecha': tx.date,
        'Descripción': tx.description,
        'Monto': tx.amount,
        'Débito': tx.debit || '',
        'Crédito': tx.credit || '',
        'Saldo': tx.balance || '',
        'Categoría': getCategoryLabel(tx.category),
        'Responsable': tx.owner || '',
        'Conciliado': tx.reconciled ? 'Sí' : 'No',
        'Tiene IVA': tx.has_vat ? 'Sí' : 'No',
        '% IVA': tx.vat_percentage,
        'Monto IVA': tx.vat_amount || '',
        'Retención': tx.withholding || '',
        'Afecta DIAN': tx.affects_dian ? 'Sí' : 'No',
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      
      // Set column widths
      ws['!cols'] = [
        { wch: 12 }, // Fecha
        { wch: 40 }, // Descripción
        { wch: 15 }, // Monto
        { wch: 15 }, // Débito
        { wch: 15 }, // Crédito
        { wch: 15 }, // Saldo
        { wch: 18 }, // Categoría
        { wch: 15 }, // Responsable
        { wch: 10 }, // Conciliado
        { wch: 10 }, // Tiene IVA
        { wch: 8 },  // % IVA
        { wch: 12 }, // Monto IVA
        { wch: 12 }, // Retención
        { wch: 12 }, // Afecta DIAN
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Transacciones');

      const fileName = `transacciones_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

      toast({
        title: 'Exportación exitosa',
        description: `Se exportaron ${data.length} transacciones.`,
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

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Exportar Datos</h1>
          <p className="text-muted-foreground">
            Descarga tus transacciones en formato Excel.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Exportar a Excel
            </CardTitle>
            <CardDescription>
              Selecciona qué transacciones quieres exportar y descarga el archivo.
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
                Se exportarán <span className="font-semibold text-foreground">{transactionCount}</span> transacciones
                con todas las columnas: fecha, descripción, monto, categoría, responsable, 
                estado de conciliación, IVA, retenciones y afectación DIAN.
              </p>
            </div>

            <Button 
              onClick={handleExport} 
              disabled={loading || transactionCount === 0}
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
