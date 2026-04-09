import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/layout/AppLayout';
import { Transaction, Category, Responsible, getCurrentCuatrimestre, getCurrentMonth } from '@/types/transaction';
import { parseLocalDate } from '@/lib/dateUtils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Download, FileSpreadsheet, Loader2, ShieldAlert, ArrowRight, AlertTriangle, FileDown, Mail, CheckCircle, Landmark, Scale, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import writeXlsxFile from 'write-excel-file';
import { toast as sonnerToast } from 'sonner';

interface StatementOption {
  id: string;
  display_name: string | null;
  bank_name: string;
  statement_month: number | null;
  statement_year: number | null;
}

export default function Export() {
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [statements, setStatements] = useState<StatementOption[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const [selectedStatement, setSelectedStatement] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [lastExportedAt, setLastExportedAt] = useState<Date | null>(null);
  const [hasEditsAfterExport, setHasEditsAfterExport] = useState(false);

  useEffect(() => {
    fetchStatements();
    fetchCategories();
    fetchResponsibles();
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [selectedStatement]);

  // Track if transactions were edited after last export
  useEffect(() => {
    if (!lastExportedAt || transactions.length === 0) return;
    // Check if any transaction was updated after export
    const hasEdits = transactions.some(tx => {
      const updatedAt = new Date(tx.created_at);
      return updatedAt > lastExportedAt;
    });
    setHasEditsAfterExport(hasEdits);
  }, [transactions, lastExportedAt]);

  const fetchStatements = async () => {
    const { data } = await supabase
      .from('bank_statements')
      .select('id, display_name, bank_name, statement_month, statement_year')
      .is('deleted_at', null)
      .order('statement_year', { ascending: false })
      .order('statement_month', { ascending: false });
    setStatements((data as StatementOption[]) || []);
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
      .is('deleted_at', null)
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
        toast({ title: 'Sin datos', description: 'No hay transacciones para exportar.', variant: 'destructive' });
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

      setLastExportedAt(new Date());
      setHasEditsAfterExport(false);

      toast({
        title: 'Exportación exitosa',
        description: `Se exportaron ${transactions.length} transacciones.`,
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({ title: 'Error', description: 'No se pudo exportar el archivo.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const getStatementLabel = (stmt: StatementOption) => {
    if (stmt.display_name) return stmt.display_name;
    return `${stmt.bank_name} ${stmt.statement_month ?? ''}/${stmt.statement_year ?? ''}`;
  };

  const steps = [
    { icon: FileDown, label: 'Exporta tu archivo', desc: 'Descarga el Excel con tus transacciones conciliadas.' },
    { icon: Mail, label: 'Envíalo a tu contadora', desc: 'Comparte el archivo para registro contable.' },
    { icon: CheckCircle, label: 'Verifica la conciliación', desc: 'Confirma que todo quede cuadrado en el sistema contable.' },
  ];

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-8">
        {/* BLOQUE 1 – Gráfico educativo */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Exportar datos</h1>
          <p className="text-muted-foreground">
            Descarga tus transacciones organizadas para tu contadora y mantén consistencia con la DIAN.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div
                key={i}
                className="relative flex flex-col items-center text-center p-5 rounded-2xl border border-border bg-card hover:shadow-md transition-shadow group"
              >
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-success text-white flex items-center justify-center text-xs font-bold shadow-sm">
                  {i + 1}
                </div>
                <div className="w-11 h-11 rounded-xl bg-success/10 flex items-center justify-center mb-3 group-hover:bg-success/20 transition-colors">
                  <Icon className="h-5 w-5 text-success" />
                </div>
                <p className="text-sm font-semibold text-foreground leading-tight">{step.label}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{step.desc}</p>
                {i < steps.length - 1 && (
                  <ArrowRight className="hidden sm:block absolute -right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/40 z-10" />
                )}
              </div>
            );
          })}
        </div>

        {/* Update Alert */}
        {hasEditsAfterExport && lastExportedAt && (
          <div className="flex items-center gap-3 p-4 rounded-xl border border-warning/40 bg-warning/5 animate-fade-in">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Datos actualizados desde la última descarga</p>
              <p className="text-xs text-muted-foreground">Se editaron transacciones después de exportar. Descarga de nuevo para tener la versión más reciente.</p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5 border-warning/40 text-warning hover:bg-warning/10" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" />
              Actualizar
            </Button>
          </div>
        )}

        {/* BLOQUE 2 – Exportar Excel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-success" />
              Exportar movimientos contables
            </CardTitle>
            <CardDescription>
              Descarga tus transacciones organizadas para tu auxiliar contable o contador. Este archivo es la base para llevar tu contabilidad al día y mantener consistencia con la DIAN.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Extracto</label>
              <Select value={selectedStatement} onValueChange={setSelectedStatement}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos los extractos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los extractos</SelectItem>
                  {statements.map((stmt) => (
                    <SelectItem key={stmt.id} value={stmt.id}>
                      {getStatementLabel(stmt)}
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

        {/* BLOQUE 3 – Intro reportes */}
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-foreground">Prepárate para el banco y la DIAN</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Cuando solicitas un préstamo o enfrentas una revisión de la DIAN, no basta con tener los datos… necesitas entenderlos y saber explicarlos.
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            AluminIA genera reportes claros con la información que realmente analizan estas entidades.
          </p>
        </div>

        {/* BLOQUE 4 – Reportes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="flex flex-col">
            <CardHeader>
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
                <Landmark className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-base">Informe para solicitud de crédito</CardTitle>
              <CardDescription>
                Presenta tu negocio con claridad ante el banco. Incluye flujo de caja, clientes principales, cartera y evaluación de riesgo.
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => sonnerToast.info('Próximamente disponible')}
              >
                Generar informe para banco
              </Button>
            </CardContent>
          </Card>

          <Card className="flex flex-col">
            <CardHeader>
              <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center mb-2">
                <Scale className="h-5 w-5 text-destructive" />
              </div>
              <CardTitle className="text-base">Informe para revisión DIAN</CardTitle>
              <CardDescription>
                Organiza tu información fiscal y detecta inconsistencias antes de una auditoría. Incluye IVA, anticipos, ingresos sin factura y consistencia fiscal.
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => sonnerToast.info('Próximamente disponible')}
              >
                Generar informe DIAN
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* BLOQUE 5 – Conciencia */}
        <Card className="border-border bg-muted/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="font-semibold text-foreground text-sm">¿Por qué estos reportes son importantes?</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Muchos negocios tienen la información, pero no saben explicarla.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">Esto puede hacer que:</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>te nieguen un crédito</li>
                  <li>tengas problemas en una revisión de la DIAN</li>
                </ul>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Estos reportes te ayudan a responder con claridad y seguridad.
                </p>
              </div>
            </div>
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
