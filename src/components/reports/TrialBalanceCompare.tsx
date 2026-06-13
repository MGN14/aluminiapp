import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Trash2, GitCompare, Info, AlertTriangle } from 'lucide-react';
import { useExternalTrialBalance } from '@/hooks/useExternalTrialBalance';
import type { BalanceSheet } from '@/lib/balanceSheet';
import { SECTION_ORDER, SECTION_LABEL, isActivo, isPasivo, type BalanceSection } from '@/lib/pucClassify';
import TrialBalanceImport from './TrialBalanceImport';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';

const fmt = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(v));

/** Mapea los rubros del balance derivado de la app a las secciones PUC. */
function appBySection(sheet: BalanceSheet): Record<BalanceSection, number> {
  const a = (k: string) => sheet.activos.find((l) => l.key === k)?.value ?? 0;
  const p = (k: string) => sheet.pasivos.find((l) => l.key === k)?.value ?? 0;
  return {
    disponible: a('caja_bancos'),
    // En el PUC, anticipos a proveedores (1330) e IVA a favor / anticipo de
    // impuestos (1355) viven en el grupo 13 (deudores) → los alineamos a
    // 'cartera' para que coincida con dónde clasifica el balance de Siigo.
    cartera: a('cuentas_por_cobrar') + a('anticipos_a_proveedores') + a('iva_a_favor'),
    inventario: a('inventario'),
    activos_fijos: a('activos_fijos'), // ahora viene del módulo Activos fijos
    otros_activos: a('otros_activos'),
    obligaciones_financieras: p('deuda_financiera'),
    proveedores_cxp: p('cuentas_por_pagar'),
    impuestos: p('impuestos_por_pagar'),
    obligaciones_laborales: p('prestaciones_por_pagar'),
    otros_pasivos: p('anticipos_de_clientes'),
    patrimonio: sheet.patrimonio,
    no_balance: 0,
  };
}

export default function TrialBalanceCompare({ appSheet }: { appSheet: BalanceSheet }) {
  const { data, isLoading, importBalance, clearBalance } = useExternalTrialBalance();
  const [showImport, setShowImport] = useState(false);

  const app = useMemo(() => appBySection(appSheet), [appSheet]);

  if (isLoading) return null;

  if (!data?.hasBalance) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 text-center space-y-2">
          <GitCompare className="h-7 w-7 text-muted-foreground/50 mx-auto" />
          <p className="text-sm font-medium">Comparar con el balance contable de Siigo</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Importá el balance de prueba de Siigo y lo ponemos lado a lado con el balance que calcula la app, rubro por rubro. Así ves exactamente dónde difieren.
          </p>
          <Button size="sm" onClick={() => setShowImport(true)} className="gap-1.5 mt-1">
            <Upload className="h-3.5 w-3.5" /> Importar balance de Siigo
          </Button>
        </CardContent>
        <TrialBalanceImport open={showImport} onOpenChange={setShowImport}
          onConfirm={(rows, snap) => importBalance.mutate({ rows, snapshotDate: snap })} />
      </Card>
    );
  }

  // Aviso si el balance de Siigo es de un corte lejano a hoy (compara fechas distintas).
  const snapStale = (() => {
    if (!data.balanceSnapshotDate) return false;
    const days = (Date.now() - parseLocalDate(data.balanceSnapshotDate).getTime()) / 86_400_000;
    return days > 35;
  })();

  const siigo = data.bySection;
  const rows = SECTION_ORDER.map((s) => {
    const sv = siigo[s] || 0;
    const av = app[s] || 0;
    return { section: s, label: SECTION_LABEL[s], siigo: sv, app: av, diff: av - sv };
  });

  const sum = (pred: (s: BalanceSection) => boolean, src: 'siigo' | 'app') =>
    rows.filter((r) => pred(r.section)).reduce((acc, r) => acc + r[src], 0);
  const totActSiigo = sum(isActivo, 'siigo'), totActApp = sum(isActivo, 'app');
  const totPasSiigo = sum(isPasivo, 'siigo'), totPasApp = sum(isPasivo, 'app');
  const patSiigo = siigo.patrimonio || 0, patApp = app.patrimonio || 0;

  // Partidas que Siigo tiene y la app NO registra (o casi): Siigo > $1M y la
  // app < 10% de Siigo. Son las cuentas contables que la app aún no deriva.
  // Impuestos se excluye (ya tiene su nota "la app aún no liquida impuestos").
  const isGap = (sv: number, av: number) => Math.abs(sv) > 1_000_000 && Math.abs(av) < Math.abs(sv) * 0.1;
  const gaps = rows.filter((r) => r.section !== 'patrimonio' && r.section !== 'impuestos' && isGap(r.siigo, r.app));
  // Efecto neto en patrimonio: gaps de activo suman, gaps de pasivo restan.
  const gapActivos = gaps.filter((g) => isActivo(g.section)).reduce((s, g) => s + Math.abs(g.siigo), 0);
  const gapPasivos = gaps.filter((g) => isPasivo(g.section)).reduce((s, g) => s + Math.abs(g.siigo), 0);
  const gapNetoPatrimonio = gapActivos - gapPasivos;

  // Diferencia material = supera 5% relativo Y $100k absoluto (no pinta rojo
  // por diferencias chicas a escala de la empresa).
  const MIN_ABS = 100_000;
  const Row = ({ label, sv, av, bold, noFlag, note, gap }: {
    label: string; sv: number; av: number; bold?: boolean; noFlag?: boolean; note?: string; gap?: boolean;
  }) => {
    const diff = av - sv;
    const rel = sv !== 0 ? Math.abs(diff) / Math.abs(sv) : (av !== 0 ? 1 : 0);
    const material = Math.abs(diff) >= MIN_ABS && rel > 0.05;
    const diffColor = noFlag || !material ? 'text-muted-foreground' : 'text-destructive';
    return (
      <TableRow className={bold ? 'bg-muted/40 font-semibold' : (gap ? 'bg-amber-500/5' : '')}>
        <TableCell className="text-sm py-2">
          {label}
          {gap && <span className="ml-1.5 text-[9px] font-semibold text-amber-600 border border-amber-500/40 rounded px-1 py-0.5 align-middle">solo en Siigo</span>}
          {note && <span className="block text-[10px] text-muted-foreground font-normal">{note}</span>}
        </TableCell>
        <TableCell className="text-sm text-right font-mono py-2">{fmt(sv)}</TableCell>
        <TableCell className="text-sm text-right font-mono py-2">{fmt(av)}</TableCell>
        <TableCell className={`text-sm text-right font-mono py-2 ${diffColor}`}>{diff >= 0 ? '' : '−'}{fmt(Math.abs(diff))}</TableCell>
      </TableRow>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-primary" /> Siigo (contable) vs App (derivado)
          </CardTitle>
          {data.balanceSnapshotDate && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Balance de Siigo al {format(parseLocalDate(data.balanceSnapshotDate), 'dd MMM yyyy', { locale: es })} · {data.count} cuentas
            </p>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowImport(true)}><Upload className="h-3.5 w-3.5" /> Reimportar</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive" onClick={() => { if (window.confirm('¿Borrar el balance de Siigo cargado? (no afecta el Estado de Resultados)')) clearBalance.mutate('balance'); }}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {snapStale && (
          <p className="text-[11px] text-amber-600 bg-amber-500/10 border-b border-amber-500/25 px-3 py-2 flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            El balance de Siigo es de hace más de un mes y la app calcula a hoy: parte de las diferencias puede ser por el desfase de fechas. Reimportá el balance de prueba al corte actual para comparar parejo.
          </p>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60">
                <TableHead className="text-xs">Rubro</TableHead>
                <TableHead className="text-xs text-right">Siigo</TableHead>
                <TableHead className="text-xs text-right">App</TableHead>
                <TableHead className="text-xs text-right">Diferencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.filter((r) => isActivo(r.section)).map((r) => (
                <Row key={r.section} label={r.label} sv={r.siigo} av={r.app} gap={isGap(r.siigo, r.app)} />
              ))}
              <Row label="Total activos" sv={totActSiigo} av={totActApp} bold />
              {rows.filter((r) => isPasivo(r.section)).map((r) => (
                <Row key={r.section} label={r.label} sv={r.siigo} av={r.app}
                  gap={r.section !== 'impuestos' && isGap(r.siigo, r.app)}
                  noFlag={r.section === 'impuestos'}
                  note={r.section === 'impuestos' ? 'la app aún no liquida impuestos' : undefined} />
              ))}
              <Row label="Total pasivos" sv={totPasSiigo} av={totPasApp} bold />
              <Row label="Patrimonio" sv={patSiigo} av={patApp} bold noFlag note="app: Activo − Pasivo (derivado); Siigo: cuentas reales clase 3 — no comparables directamente" />
            </TableBody>
          </Table>
        </div>

        {/* Análisis de brecha: partidas que Siigo registra y la app no */}
        <div className="p-3 space-y-2 border-t">
          {gaps.length > 0 ? (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 px-3 py-2">
              <p className="text-[11px] font-semibold text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Partidas que Siigo lleva y la app aún no deriva
              </p>
              <ul className="mt-1.5 space-y-1">
                {gaps.map((g) => (
                  <li key={g.section} className="text-[11px] text-amber-900 flex items-center justify-between gap-3">
                    <span>{g.label} <span className="text-amber-700/70">({isActivo(g.section) ? 'activo' : 'pasivo'})</span></span>
                    <span className="font-mono font-medium">{fmt(g.siigo)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-amber-700/90 mt-1.5 leading-snug">
                Son cuentas que tu contadora lleva en Siigo y la app todavía no deriva (inversiones, intangibles, diferidos, etc.).
                {gapNetoPatrimonio !== 0 && <> Efecto neto aproximado sobre el patrimonio: <span className="font-mono font-medium">{gapNetoPatrimonio >= 0 ? '+' : '−'}{fmt(Math.abs(gapNetoPatrimonio))}</span> (activos que suman menos pasivos que restan).</>}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-success flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0" /> No hay partidas grandes que Siigo tenga y la app no — el balance de la app cubre los rubros principales.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Siigo es tu contabilidad oficial; la app es un balance gerencial derivado. Las filas en ámbar ("solo en Siigo") y las diferencias en rojo te muestran exactamente dónde revisar. El patrimonio no es comparable directo (la app lo calcula como Activo − Pasivo).
          </p>
        </div>
      </CardContent>
      <TrialBalanceImport open={showImport} onOpenChange={setShowImport}
        onConfirm={(rows2, snap) => importBalance.mutate({ rows: rows2, snapshotDate: snap })} />
    </Card>
  );
}
