// Reporte: Relación de pagos (historial de movimientos exportable).
//
// Lista todos los pagos del año seleccionado — ingresos y/o egresos — con
// filtros, totales y exportación a Excel + opción de compartir vía
// Web Share API (si el navegador lo soporta) o copiar al portapapeles.
//
// Fuentes:
//  - transactions (extractos bancarios) — ambos módulos
//  - cash_movements (efectivo) — solo módulo Gerencial
//
// El cliente lo pidió como "relación de pagos enviable" — ideal para
// adjuntar a un correo a contador o socio sin tener que armar un Excel
// a mano.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import writeXlsxFile from 'write-excel-file';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useModuleContext } from '@/hooks/useModuleContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Download,
  Share2,
  Filter,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  Banknote,
  Wallet,
} from 'lucide-react';

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

const MONTH_LABELS = [
  'Todos los meses',
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(v));
}

function formatDateLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface PaymentRow {
  id: string;
  date: string;
  description: string;
  type: 'ingreso' | 'egreso';
  amount: number;
  source: 'banco' | 'efectivo';
  category: string | null;
  responsible: string | null;
  invoice_ref: string | null;
}

type FilterType = 'todos' | 'ingreso' | 'egreso';

export default function PaymentsLogReport() {
  const { user } = useAuth();
  const { isGerencial } = useModuleContext();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState<number>(0); // 0 = todos
  const [typeFilter, setTypeFilter] = useState<FilterType>('todos');
  const [sharing, setSharing] = useState(false);

  const startDate = month === 0 ? `${year}-01-01` : `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = (() => {
    if (month === 0) return `${year}-12-31`;
    // último día del mes
    const last = new Date(year, month, 0);
    return `${year}-${String(month).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  })();

  const { data, isLoading } = useQuery({
    queryKey: ['payments-log', user?.id, year, month, typeFilter, isGerencial],
    queryFn: async (): Promise<PaymentRow[]> => {
      if (!user) return [];

      // Banco: transactions con type ingreso/egreso
      const txQuery = supabase
        .from('transactions')
        .select(`
          id,
          date,
          description,
          type,
          amount,
          category_id,
          responsible_id,
          invoice_id,
          categories ( name ),
          responsibles ( name ),
          invoices ( invoice_number )
        `)
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .in('type', ['ingreso', 'egreso'])
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });

      const txResult = await txQuery;
      if (txResult.error) throw txResult.error;

      const bankRows: PaymentRow[] = (txResult.data ?? []).map((r: any) => ({
        id: `bank-${r.id}`,
        date: r.date,
        description: r.description ?? 'Sin descripción',
        type: r.type as 'ingreso' | 'egreso',
        amount: Math.abs(Number(r.amount ?? 0)),
        source: 'banco',
        category: r.categories?.name ?? null,
        responsible: r.responsibles?.name ?? null,
        invoice_ref: r.invoices?.invoice_number ?? null,
      }));

      // Efectivo: solo en Gerencial
      let cashRows: PaymentRow[] = [];
      if (isGerencial) {
        const cashRes = await supabase
          .from('cash_movements')
          .select('id, date, type, amount, category, notes')
          .eq('user_id', user.id)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: false });
        if (!cashRes.error && cashRes.data) {
          cashRows = (cashRes.data as any[]).map((r) => ({
            id: `cash-${r.id}`,
            date: r.date,
            description: r.notes ?? 'Movimiento en efectivo',
            type: r.type as 'ingreso' | 'egreso',
            amount: Math.abs(Number(r.amount ?? 0)),
            source: 'efectivo',
            category: r.category ?? null,
            responsible: null,
            invoice_ref: null,
          }));
        }
      }

      let all = [...bankRows, ...cashRows];
      if (typeFilter !== 'todos') {
        all = all.filter((r) => r.type === typeFilter);
      }
      return all.sort((a, b) => b.date.localeCompare(a.date));
    },
    enabled: !!user,
  });

  const rows = data ?? [];

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        if (r.type === 'ingreso') acc.ingresos += r.amount;
        else acc.egresos += r.amount;
        return acc;
      },
      { ingresos: 0, egresos: 0 },
    );
  }, [rows]);

  const netoPeriodo = totals.ingresos - totals.egresos;

  const buildWorkbook = () => {
    const header = [
      { value: 'Fecha', fontWeight: 'bold' },
      { value: 'Tipo', fontWeight: 'bold' },
      { value: 'Origen', fontWeight: 'bold' },
      { value: 'Descripción', fontWeight: 'bold' },
      { value: 'Categoría', fontWeight: 'bold' },
      { value: 'Responsable', fontWeight: 'bold' },
      { value: 'Factura', fontWeight: 'bold' },
      { value: 'Monto (COP)', fontWeight: 'bold', align: 'right' },
    ];
    const dataRows = rows.map((r) => [
      { value: r.date, type: String },
      { value: r.type === 'ingreso' ? 'Ingreso' : 'Egreso', type: String },
      { value: r.source === 'banco' ? 'Banco' : 'Efectivo', type: String },
      { value: r.description, type: String },
      { value: r.category ?? '—', type: String },
      { value: r.responsible ?? '—', type: String },
      { value: r.invoice_ref ?? '—', type: String },
      {
        value: r.type === 'egreso' ? -r.amount : r.amount,
        type: Number,
        format: '#,##0',
        align: 'right',
      },
    ]);
    return [header, ...dataRows];
  };

  const handleExport = async () => {
    if (rows.length === 0) {
      toast.error('No hay pagos en el periodo seleccionado.');
      return;
    }
    try {
      const data = buildWorkbook();
      const periodoLabel = month === 0 ? `${year}` : `${MONTH_LABELS[month]}-${year}`;
      const fileName = `aluminia_relacion_pagos_${periodoLabel}.xlsx`;
      await writeXlsxFile(data as any, {
        fileName,
        columns: [
          { width: 12 }, // Fecha
          { width: 10 }, // Tipo
          { width: 10 }, // Origen
          { width: 40 }, // Descripción
          { width: 18 }, // Categoría
          { width: 18 }, // Responsable
          { width: 14 }, // Factura
          { width: 16 }, // Monto
        ],
      } as any);
      toast.success(`Exportado: ${rows.length} movimientos`);
    } catch (e) {
      console.error(e);
      toast.error('No pudimos exportar. Intentá de nuevo.');
    }
  };

  const handleShare = async () => {
    if (rows.length === 0) {
      toast.error('No hay pagos para compartir.');
      return;
    }
    setSharing(true);
    try {
      const data = buildWorkbook();
      const periodoLabel = month === 0 ? `${year}` : `${MONTH_LABELS[month]}-${year}`;
      const fileName = `aluminia_relacion_pagos_${periodoLabel}.xlsx`;
      // writeXlsxFile sin fileName devuelve Blob.
      const blob = await (writeXlsxFile as unknown as (d: unknown, o: unknown) => Promise<Blob>)(
        data,
        {
          columns: [
            { width: 12 }, { width: 10 }, { width: 10 }, { width: 40 },
            { width: 18 }, { width: 18 }, { width: 14 }, { width: 16 },
          ],
        },
      );
      const file = new File([blob], fileName, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      // Web Share API con archivos (iOS Safari, Chrome móvil, Edge).
      const navAny = navigator as any;
      if (navAny.canShare && navAny.canShare({ files: [file] })) {
        await navAny.share({
          files: [file],
          title: 'Relación de pagos',
          text: `Relación de pagos AluminIA — ${periodoLabel}`,
        });
        toast.success('Compartido');
      } else {
        // Fallback: descargar igual que Exportar.
        await writeXlsxFile(data as any, {
          fileName,
          columns: [
            { width: 12 }, { width: 10 }, { width: 10 }, { width: 40 },
            { width: 18 }, { width: 18 }, { width: 14 }, { width: 16 },
          ],
        } as any);
        toast.info('Tu navegador no soporta compartir archivos. Descargamos el Excel para que lo envíes manualmente.');
      }
    } catch (e: any) {
      // AbortError = el usuario canceló la ventana de compartir, no es error real.
      if (e?.name !== 'AbortError') {
        console.error(e);
        toast.error('No pudimos compartir. Probá descargar y enviarlo manualmente.');
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filtros + acciones */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground shrink-0" />

              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-[110px] h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-[170px] h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTH_LABELS.map((label, i) => (
                    <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as FilterType)}>
                <SelectTrigger className="w-[140px] h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Ingresos y egresos</SelectItem>
                  <SelectItem value="ingreso">Solo ingresos</SelectItem>
                  <SelectItem value="egreso">Solo egresos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={isLoading || rows.length === 0}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Exportar Excel
              </Button>
              <Button
                size="sm"
                onClick={handleShare}
                disabled={isLoading || rows.length === 0 || sharing}
                className="gap-2"
              >
                <Share2 className="h-4 w-4" />
                {sharing ? 'Compartiendo…' : 'Compartir'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ingresos del periodo</CardTitle>
            <div className="p-2 rounded-lg bg-success/10">
              <TrendingUp className="h-4 w-4 text-success" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{formatCurrency(totals.ingresos)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {rows.filter((r) => r.type === 'ingreso').length} movimientos
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Egresos del periodo</CardTitle>
            <div className="p-2 rounded-lg bg-destructive/10">
              <TrendingDown className="h-4 w-4 text-destructive" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{formatCurrency(totals.egresos)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {rows.filter((r) => r.type === 'egreso').length} movimientos
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Neto del periodo</CardTitle>
            <div className="p-2 rounded-lg bg-primary/10">
              <ArrowUpDown className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${netoPeriodo >= 0 ? 'text-success' : 'text-destructive'}`}>
              {netoPeriodo >= 0 ? '+' : ''}{formatCurrency(netoPeriodo)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Ingresos − egresos
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/80">
                  <TableHead className="font-semibold">Fecha</TableHead>
                  <TableHead className="font-semibold">Tipo</TableHead>
                  <TableHead className="font-semibold">Origen</TableHead>
                  <TableHead className="font-semibold">Descripción</TableHead>
                  <TableHead className="font-semibold">Categoría</TableHead>
                  <TableHead className="font-semibold">Responsable</TableHead>
                  <TableHead className="font-semibold">Factura</TableHead>
                  <TableHead className="font-semibold text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      Cargando movimientos...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      No hay pagos en el periodo seleccionado.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDateLong(r.date)}
                      </TableCell>
                      <TableCell>
                        {r.type === 'ingreso' ? (
                          <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                            Ingreso
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                            Egreso
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          {r.source === 'banco' ? (
                            <Banknote className="h-3 w-3" />
                          ) : (
                            <Wallet className="h-3 w-3" />
                          )}
                          {r.source === 'banco' ? 'Banco' : 'Efectivo'}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-sm" title={r.description}>
                        {r.description}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.category ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.responsible ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.invoice_ref ? `#${r.invoice_ref}` : '—'}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium tabular-nums ${
                          r.type === 'ingreso' ? 'text-success' : 'text-destructive'
                        }`}
                      >
                        {r.type === 'ingreso' ? '+' : '−'}
                        {formatCurrency(r.amount)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
