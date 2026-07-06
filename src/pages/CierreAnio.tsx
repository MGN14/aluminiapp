import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CalendarCheck, ChevronDown, ChevronRight, Download, Lock, RotateCcw, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/integrations/supabase/client';
import { computeYearCloseSuggestions } from '@/lib/yearClose';
import { useYearClosings, useCloseFiscalYear, useReopenFiscalYear, type YearClosing } from '@/hooks/useYearClosings';
import { generateYearClosingPdf } from '@/lib/yearClosingPdf';

const fmt = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(v));
const now = new Date();
const YEARS = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i);

// Parseo es-CO: quita separadores de miles (puntos) y deja la coma como decimal.
function parseMoney(raw: string): number {
  if (!raw.trim()) return NaN;
  const norm = raw.replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.-]/g, '');
  const n = Number(norm);
  return Number.isFinite(n) ? n : NaN;
}

export default function CierreAnio() {
  const { user } = useAuth();
  const { canEdit } = usePermissions();
  const editable = canEdit('cierre_anio');
  const [year, setYear] = useState(now.getFullYear() - (now.getMonth() < 1 ? 1 : 0)); // por defecto, año pasado en enero
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [realByRubro, setRealByRubro] = useState<Record<string, string>>({});
  const [realByTercero, setRealByTercero] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');

  const closingsQ = useYearClosings();
  const closeMut = useCloseFiscalYear();
  const reopenMut = useReopenFiscalYear();

  const alreadyClosed = useMemo(
    () => (closingsQ.data ?? []).find((c) => c.fiscal_year === year),
    [closingsQ.data, year],
  );

  const sugQ = useQuery({
    queryKey: ['year-close-suggestions', user?.id, year],
    enabled: !!user && !alreadyClosed,
    queryFn: () => computeYearCloseSuggestions(year),
  });

  const activos = sugQ.data?.rubros.filter((r) => r.kind === 'activo') ?? [];
  const pasivos = sugQ.data?.rubros.filter((r) => r.kind === 'pasivo') ?? [];

  // Real efectivo de un rubro: si hay reales por tercero cargados, su suma manda;
  // si no, el valor escrito al nivel del rubro.
  const tkey = (rubro: string, i: number) => `${rubro}:${i}`;
  const rubroReal = (rubroKey: string): number => {
    const rubro = sugQ.data?.rubros.find((r) => r.key === rubroKey);
    if (rubro && rubro.terceros.length > 0) {
      const anyTercero = rubro.terceros.some((_, i) => (realByTercero[tkey(rubroKey, i)] ?? '').trim() !== '');
      if (anyTercero) {
        // Tercero sin valor cargado = se acepta el sugerido (mismo criterio que
        // al guardar en handleClose), así el total del rubro = Σ líneas tercero.
        return rubro.terceros.reduce((s, t, i) => {
          const v = parseMoney(realByTercero[tkey(rubroKey, i)] ?? '');
          return s + (Number.isNaN(v) ? t.suggested : v);
        }, 0);
      }
    }
    const v = parseMoney(realByRubro[rubroKey] ?? '');
    return Number.isNaN(v) ? rubro?.suggested ?? 0 : v;
  };

  const totalActivosReal = activos.reduce((s, r) => s + rubroReal(r.key), 0);
  const totalPasivosReal = pasivos.reduce((s, r) => s + rubroReal(r.key), 0);
  const patrimonioReal = totalActivosReal - totalPasivosReal;
  const patrimonioSug = sugQ.data?.patrimonio ?? 0;

  const toggle = (k: string) => setExpanded((prev) => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
  });

  const pct = (real: number, sug: number) => {
    if (Math.abs(sug) < 1) return real === 0 ? '0%' : '—';
    return `${(((real - sug) / Math.abs(sug)) * 100).toFixed(1)}%`;
  };

  const handleClose = async () => {
    if (!sugQ.data) return;
    const lines: Array<{ rubro: string; responsible_id: string | null; responsible_name: string | null; suggested_amount: number; real_amount: number }> = [];
    for (const r of sugQ.data.rubros) {
      lines.push({ rubro: r.key, responsible_id: null, responsible_name: null, suggested_amount: r.suggested, real_amount: rubroReal(r.key) });
      r.terceros.forEach((t, i) => {
        const v = parseMoney(realByTercero[tkey(r.key, i)] ?? '');
        lines.push({
          rubro: r.key, responsible_id: t.responsible_id, responsible_name: t.responsible_name,
          suggested_amount: t.suggested, real_amount: Number.isNaN(v) ? t.suggested : v,
        });
      });
    }
    try {
      await closeMut.mutateAsync({ fiscal_year: year, lines, total_sugerido: patrimonioSug, total_real: patrimonioReal, notes: notes.trim() || undefined });
      toast.success(`Año ${year} cerrado`);
      setRealByRubro({}); setRealByTercero({}); setNotes('');
    } catch (e) {
      toast.error(`Error al cerrar: ${(e as Error).message}`);
    }
  };

  const handleReopen = async (c: YearClosing) => {
    if (!window.confirm(`¿Reabrir el cierre de ${c.fiscal_year}? Se borrará el registro de reconciliación.`)) return;
    try {
      await reopenMut.mutateAsync(c.id);
      toast.success(`Cierre de ${c.fiscal_year} reabierto`);
    } catch (e) {
      toast.error(`Error: ${(e as Error).message}`);
    }
  };

  const handlePdf = async (c: YearClosing) => {
    const { data: company } = await supabase
      .from('profiles')
      .select('company_name, company_nit, company_city')
      .eq('user_id', user?.id ?? '')
      .maybeSingle();
    const doc = generateYearClosingPdf(c, (company as never) ?? {});
    doc.save(`cierre-anio-${c.fiscal_year}.pdf`);
  };

  const renderRubroRows = (rubros: typeof activos) => rubros.map((r) => {
    const real = rubroReal(r.key);
    const diff = real - r.suggested;
    const isOpen = expanded.has(r.key);
    const hasTercero = r.terceros.length > 0;
    const tercerosFilled = hasTercero && r.terceros.some((_, i) => (realByTercero[tkey(r.key, i)] ?? '').trim() !== '');
    return (
      <Fragment key={r.key}>
        <TableRow className="border-b">
          <TableCell className="py-2">
            <button type="button" disabled={!hasTercero} onClick={() => toggle(r.key)} className={cn('flex items-center gap-1.5 text-sm', hasTercero ? 'hover:text-primary' : 'cursor-default')}>
              {hasTercero ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="w-3.5" />}
              {r.label}
              {!r.operativo && <Badge variant="outline" className="text-[9px] ml-1">apertura</Badge>}
            </button>
          </TableCell>
          <TableCell className="text-right font-mono text-sm py-2">{fmt(r.suggested)}</TableCell>
          <TableCell className="text-right py-1">
            <Input
              inputMode="decimal" disabled={!editable || tercerosFilled}
              value={tercerosFilled ? String(Math.round(real)) : (realByRubro[r.key] ?? '')}
              onChange={(e) => setRealByRubro((p) => ({ ...p, [r.key]: e.target.value }))}
              placeholder={String(Math.round(r.suggested))}
              className="h-8 w-32 text-right font-mono text-sm ml-auto"
            />
          </TableCell>
          <TableCell className={cn('text-right font-mono text-sm py-2', Math.abs(diff) < 1 ? 'text-muted-foreground' : diff > 0 ? 'text-amber-600' : 'text-destructive')}>{fmt(diff)}</TableCell>
          <TableCell className="text-right font-mono text-xs py-2 text-muted-foreground">{pct(real, r.suggested)}</TableCell>
        </TableRow>
        {isOpen && r.terceros.map((t, i) => {
          const tv = parseMoney(realByTercero[tkey(r.key, i)] ?? '');
          const treal = Number.isNaN(tv) ? t.suggested : tv;
          const tdiff = treal - t.suggested;
          return (
            <TableRow key={`${r.key}:${i}`} className="bg-muted/20">
              <TableCell className="py-1 pl-10 text-xs text-muted-foreground">{t.responsible_name}</TableCell>
              <TableCell className="text-right font-mono text-xs py-1">{fmt(t.suggested)}</TableCell>
              <TableCell className="text-right py-1">
                <Input inputMode="decimal" disabled={!editable}
                  value={realByTercero[tkey(r.key, i)] ?? ''}
                  onChange={(e) => setRealByTercero((p) => ({ ...p, [tkey(r.key, i)]: e.target.value }))}
                  placeholder={String(Math.round(t.suggested))}
                  className="h-7 w-28 text-right font-mono text-xs ml-auto" />
              </TableCell>
              <TableCell className={cn('text-right font-mono text-xs py-1', Math.abs(tdiff) < 1 ? 'text-muted-foreground' : tdiff > 0 ? 'text-amber-600' : 'text-destructive')}>{fmt(tdiff)}</TableCell>
              <TableCell className="text-right font-mono text-[10px] py-1 text-muted-foreground">{pct(treal, t.suggested)}</TableCell>
            </TableRow>
          );
        })}
      </Fragment>
    );
  });

  return (
    <AppLayout>
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><CalendarCheck className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cierre de Año</h1>
            <p className="text-sm text-muted-foreground">Compará el cierre que calcula la app contra los saldos reales del contador.</p>
          </div>
        </div>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>{YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {alreadyClosed ? (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="py-4 px-5 flex items-center gap-3">
            <Lock className="h-5 w-5 text-success shrink-0" />
            <div className="text-sm">
              El año <strong>{year}</strong> ya está cerrado. Patrimonio app {fmt(alreadyClosed.total_sugerido)} · contador {fmt(alreadyClosed.total_real)} · diferencia {fmt(alreadyClosed.total_diferencia)}.
            </div>
          </CardContent>
        </Card>
      ) : sugQ.isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Calculando saldos de cierre…</div>
      ) : sugQ.data ? (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Reconciliación al 31-dic-{year}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/60">
                      <TableHead className="text-xs">Rubro</TableHead>
                      <TableHead className="text-xs text-right">Sugerido (app)</TableHead>
                      <TableHead className="text-xs text-right">Real (contador)</TableHead>
                      <TableHead className="text-xs text-right">Diferencia</TableHead>
                      <TableHead className="text-xs text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="bg-muted/30"><TableCell colSpan={5} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activos</TableCell></TableRow>
                    {renderRubroRows(activos)}
                    <TableRow className="bg-muted/30"><TableCell colSpan={5} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pasivos</TableCell></TableRow>
                    {renderRubroRows(pasivos)}
                    <TableRow className="bg-primary/5 font-bold border-t-2">
                      <TableCell className="py-2.5 text-sm">Patrimonio (Activos − Pasivos)</TableCell>
                      <TableCell className="text-right font-mono text-sm py-2.5">{fmt(patrimonioSug)}</TableCell>
                      <TableCell className="text-right font-mono text-sm py-2.5">{fmt(patrimonioReal)}</TableCell>
                      <TableCell className={cn('text-right font-mono text-sm py-2.5', Math.abs(patrimonioReal - patrimonioSug) < 1 ? 'text-muted-foreground' : 'text-amber-600')}>{fmt(patrimonioReal - patrimonioSug)}</TableCell>
                      <TableCell className="text-right font-mono text-xs py-2.5 text-muted-foreground">{pct(patrimonioReal, patrimonioSug)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Los rubros marcados <Badge variant="outline" className="text-[9px] mx-0.5">apertura</Badge> (caja/bancos, anticipos, IVA) son los que la app tomará del contador como apertura del próximo año. El resto (cartera, inventario, créditos…) se arrastra solo desde sus módulos.
          </p>

          <Card>
            <CardContent className="py-4 px-5 space-y-3">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas del cierre (ajustes, observaciones del contador)…"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 min-h-[60px] bg-background" disabled={!editable} />
              <div className="flex justify-end">
                <Button onClick={handleClose} disabled={!editable || closeMut.isPending} className="gap-2">
                  <Lock className="h-4 w-4" /> {closeMut.isPending ? 'Cerrando…' : `Cerrar año ${year}`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="text-center py-12 text-muted-foreground text-sm">No se pudo calcular el cierre.</div>
      )}

      {/* Historial */}
      {(closingsQ.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Cierres anteriores</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60">
                  <TableHead className="text-xs">Año</TableHead>
                  <TableHead className="text-xs text-right">Patrimonio app</TableHead>
                  <TableHead className="text-xs text-right">Patrimonio contador</TableHead>
                  <TableHead className="text-xs text-right">Diferencia</TableHead>
                  <TableHead className="text-xs text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(closingsQ.data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="py-2 text-sm font-medium">{c.fiscal_year}{c.rolled_forward && <Badge variant="outline" className="text-[9px] ml-1.5">apertura aplicada</Badge>}</TableCell>
                    <TableCell className="text-right font-mono text-sm py-2">{fmt(c.total_sugerido)}</TableCell>
                    <TableCell className="text-right font-mono text-sm py-2">{fmt(c.total_real)}</TableCell>
                    <TableCell className={cn('text-right font-mono text-sm py-2', Math.abs(c.total_diferencia) < 1 ? 'text-muted-foreground' : 'text-amber-600')}>{fmt(c.total_diferencia)}</TableCell>
                    <TableCell className="text-right py-2">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => handlePdf(c)}><Download className="h-3.5 w-3.5" /> PDF</Button>
                        {editable && !c.rolled_forward && (
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => handleReopen(c)}><RotateCcw className="h-3.5 w-3.5" /> Reabrir</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
    </AppLayout>
  );
}
