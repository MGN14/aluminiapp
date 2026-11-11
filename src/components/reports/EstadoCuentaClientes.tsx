/**
 * Estado de cuenta de clientes — módulo unificado que reemplaza en el menú a
 * Anticipos + Módulo de Cobranza + Relación de pagos (Nico 2026-09-01).
 *
 * RENOVACIÓN 2026-11-11 (Nico: "hacele una renovación completa, que haya
 * filtros en la tabla"). Este archivo quedó como CONTENEDOR: trae los datos,
 * guarda el estado de la vista y conecta acciones. La presentación vive en
 * ./estado-cuenta/:
 *   · ResumenCartera — te deben (con edades de la deuda), anticipos y al día;
 *     cada bloque filtra la tabla.
 *   · TablaClientes  — filtros (estado, mora, saldo, chips), orden por
 *     columna, totales de lo filtrado.
 *   · PanelCliente   — al abrir un cliente: cómo se llega al saldo y sus
 *     facturas, pagos y remisiones en pestañas.
 *
 * Los números siguen saliendo del MISMO motor canónico de cartera
 * (calculateAllClientReceivables + aging vía useCollectionData — el de
 * Cobranza, el score IA, los emails y Wompi). Nada se re-deriva acá, para que
 * jamás haya descuadre entre módulos:
 *   saldo_neto > 0  → te debe · saldo_neto < 0 → anticipo vivo · 0 → al día
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import writeXlsxFile from 'write-excel-file';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useModuleContext } from '@/hooks/useModuleContext';
import { useCollectionData, useInvalidateCollection } from '@/hooks/useCollectionData';
import { normalizeName, type ClientReceivable } from '@/lib/clientReceivables';
import { findLikelyDuplicateClients, type DuplicatePair } from '@/lib/duplicateClients';
import type { AgingBuckets } from '@/lib/agingBuckets';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CheckCircle2, Download, GitMerge, Loader2, ShieldQuestion, Truck, X } from 'lucide-react';
import VincularPagoModal from './VincularPagoModal';
import AcordarPagoModal from '@/components/expected-payments/AcordarPagoModal';
import PaymentLinkModal from '@/components/collection/PaymentLinkModal';
import ResumenCartera from './estado-cuenta/ResumenCartera';
import TablaClientes from './estado-cuenta/TablaClientes';
import PanelCliente from './estado-cuenta/PanelCliente';
import {
  fetchAllRows, useRespCanon, buildClientRespIds, isUuidClient, fetchDespachosDelAnio, type DespachoRow,
} from './estado-cuenta/datos';
import {
  TRAMOS, construirFila, estadoDe, totalesDe, formatCurrency, FILTROS_DEFAULT,
  type FiltrosTabla, type Orden, type TramoMora,
} from './estado-cuenta/modelo';

/** Mensaje legible de CUALQUIER error — los de Supabase (PostgrestError) son
 *  objetos planos, no instancias de Error: `instanceof Error` los tapaba y el
 *  usuario veía "Error desconocido" en vez de la causa real. */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const partes = [e.message, e.details, e.hint, e.code ? `(${e.code})` : null].filter(Boolean);
    if (partes.length) return partes.join(' — ');
  }
  return String(err);
}

const currentYear = new Date().getFullYear();
const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

// ── Vista persistida por pestaña (sessionStorage): filtros y orden ─────────
const VISTA_KEY = 'aluminia.estadoCuenta.vista.v2';
function cargarVista(): { filtros: FiltrosTabla; orden: Orden | null } {
  try {
    const raw = sessionStorage.getItem(VISTA_KEY);
    if (!raw) return { filtros: FILTROS_DEFAULT, orden: null };
    const v = JSON.parse(raw) as { filtros?: Partial<FiltrosTabla>; orden?: Orden | null };
    return { filtros: { ...FILTROS_DEFAULT, ...(v.filtros ?? {}) }, orden: v.orden ?? null };
  } catch {
    return { filtros: FILTROS_DEFAULT, orden: null };
  }
}

const DUP_DISMISSED_KEY = 'aluminia.estadoCuenta.dupDismissed.v1';

function loadDismissedPairs(): string[] {
  try {
    const raw = localStorage.getItem(DUP_DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function pairKey(p: DuplicatePair): string {
  return [p.a.client_id, p.b.client_id].sort().join('|');
}

export default function EstadoCuentaClientes() {
  const { user } = useAuth();
  const { isGerencial } = useModuleContext();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [year, setYear] = useState(currentYear);
  const [vistaInicial] = useState(cargarVista);
  const [filtros, setFiltros] = useState<FiltrosTabla>(vistaInicial.filtros);
  const [orden, setOrden] = useState<Orden | null>(vistaInicial.orden);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Unión de posibles duplicados (mismo tercero con dos nombres).
  const [mergePair, setMergePair] = useState<DuplicatePair | null>(null);
  const [merging, setMerging] = useState(false);
  const [dismissedPairs, setDismissedPairs] = useState<string[]>(loadDismissedPairs);

  // Modales de acción por factura — mismos de Cobranza, mismo cableado.
  const [vincularInvoice, setVincularInvoice] = useState<{ id: string; invoice_number: string; counterparty_name: string | null; pending: number; total_amount: number } | null>(null);
  const [paymentLinkInvoice, setPaymentLinkInvoice] = useState<{ id: string; invoice_number: string | null; counterparty_name: string | null; pending: number } | null>(null);
  const [acordarTarget, setAcordarTarget] = useState<{
    invoice?: { id: string; invoice_number: string; pending: number };
    responsible?: { id: string; name: string };
  } | null>(null);

  const queryClient = useQueryClient();
  const { data: cd, isLoading, refetch } = useCollectionData(year);
  const invalidateCollection = useInvalidateCollection();
  const data = cd?.receivables ?? null;
  const onMutated = () => {
    invalidateCollection();
    // Las queries propias del módulo también quedan viejas al vincular un
    // pago: sin esto el Saldo de la fila se actualizaba pero la lista de
    // pagos de abajo seguía mostrando el estado anterior por 5 minutos.
    queryClient.invalidateQueries({ queryKey: ['estado-cuenta-pagos'] });
    queryClient.invalidateQueries({ queryKey: ['estado-cuenta-remisiones'] });
    queryClient.invalidateQueries({ queryKey: ['estado-cuenta-despachos'] });
    refetch();
  };

  // NITs para la tabla y el export formato contador (paginado — H5: los
  // responsables se auto-crean desde facturas y pueden superar 1000).
  const { data: nits } = useQuery<Array<{ id: string; nit: string | null }>>({
    queryKey: ['estado-cuenta-nits', user?.id],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      try {
        return await fetchAllRows<{ id: string; nit: string | null }>((f, t) =>
          supabase.from('responsibles').select('id, nit' as never).order('id').range(f, t));
      } catch (err) {
        console.warn('No se pudieron cargar los NITs:', err);
        return [];
      }
    },
  });

  // Responsables + aliases para canonicalizar (pagos, efectivo y despachos
  // de responsables legacy caen al cliente canónico, igual que en el motor).
  const { data: respCanon } = useRespCanon();

  // Despachos del año (columna "Despachado") — informativo, NO entra al saldo.
  const { data: despachos } = useQuery<DespachoRow[]>({
    queryKey: ['estado-cuenta-despachos', user?.id, year, isGerencial],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: () => fetchDespachosDelAnio(year, isGerencial),
  });

  const clients = useMemo(() => data?.clients ?? [], [data]);

  const nitById = useMemo(() => {
    const idx: Record<string, string> = {};
    for (const r of nits ?? []) if (r.nit) idx[r.id] = r.nit;
    return idx;
  }, [nits]);

  // responsible_ids que cada cliente canónico absorbe (incluye legacy/alias).
  const respIdsByClient = useMemo(() => {
    const idx: Record<string, string[]> = {};
    for (const c of clients) idx[c.client_id] = buildClientRespIds(c, respCanon);
    return idx;
  }, [clients, respCanon]);

  // Despachado por cliente: cruza por responsible_id CANONICALIZADO (una
  // remisión del responsable legacy suma al cliente canónico, igual que el
  // motor) y, si la remisión vieja no tiene responsable, por nombre
  // normalizado del beneficiario. Lo que no matchea ningún cliente se
  // reporta aparte — no se pierde en silencio.
  const { despachadoByClient, despachadoSinCliente } = useMemo(() => {
    const byId: Record<string, number> = {};
    let sinCliente = 0;
    if (!despachos?.length) return { despachadoByClient: byId, despachadoSinCliente: 0 };
    const respToClient: Record<string, string> = {};
    const clientByNorm: Record<string, string> = {};
    for (const c of clients) {
      clientByNorm[normalizeName(c.client_name)] = c.client_id;
      for (const rid of respIdsByClient[c.client_id] ?? []) {
        if (!respToClient[rid]) respToClient[rid] = c.client_id;
      }
    }
    for (const d of despachos) {
      const target =
        (d.responsible_id && respToClient[d.responsible_id]) ||
        (d.beneficiary && clientByNorm[normalizeName(d.beneficiary)]) ||
        null;
      if (target) byId[target] = (byId[target] ?? 0) + d.total;
      else sinCliente += d.total;
    }
    return { despachadoByClient: byId, despachadoSinCliente: sinCliente };
  }, [despachos, clients, respIdsByClient]);



  const sinConciliar = data?.sin_conciliar ?? { count: 0, monto: 0 };

  // Posibles duplicados: mismo tercero con dos nombres (el creado al
  // remisionar "como lo conocemos" vs la razón social que llega al facturar).
  const duplicados = useMemo(
    () => findLikelyDuplicateClients(clients).filter((p) => !dismissedPairs.includes(pairKey(p))),
    [clients, dismissedPairs],
  );

  const dismissPair = (p: DuplicatePair) => {
    const next = [...dismissedPairs, pairKey(p)];
    setDismissedPairs(next);
    try { localStorage.setItem(DUP_DISMISSED_KEY, JSON.stringify(next)); } catch { /* modo privado */ }
  };

  /** Ejecuta la unión real (RPC merge_responsibles: reasigna todo y absorbe
   *  el otro como alias). canonicalId = el nombre que queda. */
  const unirPar = async (pair: DuplicatePair, canonicalId: string) => {
    const legacy = pair.a.client_id === canonicalId ? pair.b : pair.a;
    setMerging(true);
    try {
      const { error } = await (supabase.rpc as any)('merge_responsibles', {
        p_legacy_id: legacy.client_id,
        p_canonical_id: canonicalId,
      });
      if (error) throw error;
      const canonical = pair.a.client_id === canonicalId ? pair.a : pair.b;
      toast({
        title: 'Beneficiarios unidos',
        description: `"${legacy.client_name}" quedó absorbido en "${canonical.client_name}" — facturas, pagos, remisiones y cotizaciones reasignadas.`,
      });
      setMergePair(null);
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta-resp-canon'] });
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta-nits'] });
      onMutated();
    } catch (err) {
      console.error('merge_responsibles falló:', err);
      toast({
        title: 'No se pudo unir',
        description: errMsg(err),
        variant: 'destructive',
      });
    } finally {
      setMerging(false);
    }
  };


  /** Compartir estado de cuenta: Relación de pagos ya tiene PDF + WhatsApp +
   *  email con remisión adjunta — le dejamos el cliente preseleccionado vía
   *  sus filtros persistidos y navegamos allá. */
  const compartirCliente = (c: ClientReceivable) => {
    try {
      const raw = localStorage.getItem('aluminia.paymentsLog.filters.v1');
      const prev = raw ? JSON.parse(raw) : {};
      localStorage.setItem('aluminia.paymentsLog.filters.v1', JSON.stringify({
        ...prev, counterparty: c.client_name.trim(), typeFilter: 'ingreso', year, month: 0,
      }));
    } catch { /* modo privado: igual navegamos, el usuario elige el cliente allá */ }
    navigate('/reportes/relacion-pagos');
  };

  /** Export en el formato del contador: secciones CUENTAS X COBRAR y ANTICIPOS
   *  con NIT, nombre y valor — cuadre directo contra su Excel. */
  const exportContador = async () => {
    setExporting(true);
    try {
      const cxcRows = clients.filter((c) => estadoDe(c) === 'cxc').sort((a, b) => b.saldo_neto - a.saldo_neto);
      const antRows = clients.filter((c) => estadoDe(c) === 'anticipos').sort((a, b) => a.saldo_neto - b.saldo_neto);
      // Totales = Σ de las filas YA redondeadas: si el contador suma la
      // columna en Excel, le cuadra al centavo con la cabecera.
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const totalCxc = r2(cxcRows.reduce((s, c) => s + r2(c.saldo_neto), 0));
      const totalAnt = r2(antRows.reduce((s, c) => s + r2(Math.abs(c.saldo_neto)), 0));

      type XRow = Array<{ value: string | number; fontWeight?: 'bold'; type?: typeof Number }>;
      const cell = (value: string | number, bold = false) =>
        typeof value === 'number'
          ? { value, type: Number, fontWeight: bold ? ('bold' as const) : undefined }
          : { value, fontWeight: bold ? ('bold' as const) : undefined };

      const rows: XRow[] = [
        [cell(''), cell(''), cell('CUENTAS X COBRAR', true), cell(totalCxc, true)],
        ...cxcRows.map((c) => [
          cell('Clientes nacionales'),
          cell(nitById[c.client_id] ?? ''),
          cell(c.client_name),
          cell(Math.round(c.saldo_neto * 100) / 100),
        ]),
        [cell(''), cell(''), cell(''), cell('')],
        [cell(''), cell(''), cell('ANTICIPOS', true), cell(totalAnt, true)],
        ...antRows.map((c) => [
          cell('De clientes'),
          cell(nitById[c.client_id] ?? ''),
          cell(c.client_name),
          cell(Math.round(Math.abs(c.saldo_neto) * 100) / 100),
        ]),
      ];
      await writeXlsxFile(rows as never, {
        fileName: `estado-cuenta-clientes-${year}.xlsx`,
        columns: [{ width: 20 }, { width: 14 }, { width: 42 }, { width: 18 }],
      } as never);
    } finally {
      setExporting(false);
    }
  };

  // ── Filas de la tabla: los números del motor + aging + promesas ─────────
  const agingPorCliente = useMemo(() => {
    const idx: Record<string, { buckets: AgingBuckets; oldest_overdue_days: number }> = {};
    for (const a of cd?.aging?.clients ?? []) idx[a.client_id] = a;
    return idx;
  }, [cd]);

  // promesasByClient es un Map en memoria (esta query no se persiste por eso).
  const promesaPorCliente = useMemo(() => {
    const idx: Record<string, { amount: number; due_date: string }> = {};
    const m = cd?.promesasByClient;
    if (!(m instanceof Map)) return idx;
    for (const c of data?.clients ?? []) {
      const lista = m.get(c.client_id) ?? [];
      const proxima = [...lista].sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
      if (proxima) idx[c.client_id] = { amount: Number(proxima.amount) || 0, due_date: proxima.due_date };
    }
    return idx;
  }, [cd, data]);

  const filas = useMemo(() => clients.map((c) => construirFila({
    client: c,
    nit: nitById[c.client_id] ?? null,
    despachado: despachadoByClient[c.client_id] ?? 0,
    aging: agingPorCliente[c.client_id] ?? null,
    promesa: promesaPorCliente[c.client_id] ?? null,
  })), [clients, nitById, despachadoByClient, agingPorCliente, promesaPorCliente]);

  const resumen = useMemo(() => {
    const t = totalesDe(filas);
    const porTramo = Object.fromEntries(TRAMOS.map((x) => [x.key, 0])) as Record<TramoMora, number>;
    for (const a of cd?.aging?.clients ?? []) {
      for (const x of TRAMOS) if ((a.buckets[x.key] ?? 0) > 1) porTramo[x.key]++;
    }
    return {
      facturado: t.facturado,
      cobrado: t.cobrado,
      nTeDeben: filas.filter((r) => r.estado === 'cxc').length,
      nAFavor: filas.filter((r) => r.estado === 'anticipos').length,
      nAlDia: filas.filter((r) => r.estado === 'aldia').length,
      porTramo,
    };
  }, [filas, cd]);

  useEffect(() => {
    try { sessionStorage.setItem(VISTA_KEY, JSON.stringify({ filtros, orden })); } catch { /* modo privado */ }
  }, [filtros, orden]);

  // Cambiar de año cierra el detalle abierto (puede no existir en el otro año).
  useEffect(() => { setExpanded(null); }, [year]);

  const renderPanel = (fila: ReturnType<typeof construirFila>) => {
    const c = fila.client;
    return (
      <PanelCliente
        fila={fila}
        year={year}
        isGerencial={isGerencial}
        clientRespIds={respIdsByClient[c.client_id] ?? []}
        onCompartir={() => compartirCliente(c)}
        onVincularInvoice={(inv) => setVincularInvoice({
          id: inv.id,
          invoice_number: inv.invoice_number,
          counterparty_name: c.client_name,
          pending: inv.effective_pending,
          total_amount: inv.total_amount,
        })}
        onAcordarInvoice={(inv) => setAcordarTarget({
          invoice: { id: inv.id, invoice_number: inv.invoice_number, pending: inv.effective_pending },
          responsible: isUuidClient(c.client_id) ? { id: c.client_id, name: c.client_name } : undefined,
        })}
        onLinkPagoInvoice={(inv) => setPaymentLinkInvoice({
          id: inv.id,
          invoice_number: inv.invoice_number,
          counterparty_name: c.client_name,
          pending: inv.effective_pending,
        })}
        onAcordarCliente={() => setAcordarTarget({
          responsible: isUuidClient(c.client_id) ? { id: c.client_id, name: c.client_name } : undefined,
        })}
      />
    );
  };

  const avisos = sinConciliar.count > 0 || duplicados.length > 0 || despachadoSinCliente > 1;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* ── Barra superior: año + export ───────────────────────────── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28 h-9" aria-label="Año">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground hidden sm:block">
              Mismos números que Cobranza y Relación de pagos.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={exportContador} disabled={exporting || isLoading}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Exportar formato contador
          </Button>
        </div>

        <ResumenCartera
          cargando={isLoading}
          year={year}
          teDeben={data?.total_saldo_pendiente ?? 0}
          nTeDeben={resumen.nTeDeben}
          aFavor={data?.total_saldo_a_favor ?? 0}
          nAFavor={resumen.nAFavor}
          nAlDia={resumen.nAlDia}
          facturado={resumen.facturado}
          cobrado={resumen.cobrado}
          tramos={cd?.aging?.totals ?? null}
          clientesPorTramo={resumen.porTramo}
          estado={filtros.estado}
          mora={filtros.mora}
          onEstado={(estado) => setFiltros({ ...filtros, estado })}
          onMora={(mora) => setFiltros({ ...filtros, mora })}
        />

        {/* ── Para revisar: lo que puede hacer que la cartera no cuadre ── */}
        {avisos && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] divide-y divide-amber-500/20">
            {sinConciliar.count > 0 && (
              <div className="flex items-start gap-2.5 px-4 py-3 text-sm">
                <ShieldQuestion className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-muted-foreground">
                  <span className="font-semibold text-foreground tabular-nums">{formatCurrency(sinConciliar.monto)}</span> en {sinConciliar.count} ingreso{sinConciliar.count === 1 ? '' : 's'} del año sin cliente identificable: la cartera puede estar sobrestimada hasta por ese monto.{' '}
                  <Link to="/transactions" className="font-medium text-foreground underline underline-offset-2">Conciliar ahora</Link>
                </p>
              </div>
            )}

            {/* Posibles duplicados: el cliente creado al remisionar vs el que
                crea la facturación — unir con un clic (RPC merge_responsibles). */}
            {duplicados.length > 0 && (
              <div className="px-4 py-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <GitMerge className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                  Estos parecen el mismo cliente con dos nombres
                </p>
                {duplicados.map((p) => {
                  const ambosUuid = isUuidClient(p.a.client_id) && isUuidClient(p.b.client_id);
                  return (
                    <div key={pairKey(p)} className="flex items-center gap-2 text-xs flex-wrap pl-6">
                      <span className="font-medium">{p.a.client_name}</span>
                      <span className="text-muted-foreground">y</span>
                      <span className="font-medium">{p.b.client_name}</span>
                      <span className="text-muted-foreground">({Math.round(p.score * 100)} % parecido)</span>
                      {ambosUuid ? (
                        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={() => setMergePair(p)}>
                          <GitMerge className="h-3 w-3" /> Unir
                        </Button>
                      ) : (
                        <span className="text-muted-foreground italic">
                          uno no tiene tercero creado: asignale el beneficiario a sus facturas en Conciliación y quedan unidos
                        </span>
                      )}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                        title="No son el mismo: no volver a mostrar"
                        onClick={() => dismissPair(p)}
                      >
                        <X className="h-3 w-3" /> No son el mismo
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {despachadoSinCliente > 1 && (
              <div className="flex items-start gap-2.5 px-4 py-3 text-sm">
                <Truck className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-muted-foreground">
                  <span className="font-semibold text-foreground tabular-nums">{formatCurrency(despachadoSinCliente)}</span> despachados en {year} sin cliente identificable: remisiones sin tercero asignado.{' '}
                  <Link to="/remisiones" className="font-medium text-foreground underline underline-offset-2">Ver remisiones</Link>
                </p>
              </div>
            )}
          </div>
        )}

        <TablaClientes
          filas={filas}
          cargando={isLoading}
          year={year}
          filtros={filtros}
          onFiltros={setFiltros}
          orden={orden}
          onOrden={setOrden}
          abierto={expanded}
          onAbrir={setExpanded}
          renderPanel={renderPanel}
        />

        <VincularPagoModal
          open={!!vincularInvoice}
          onOpenChange={(v) => { if (!v) setVincularInvoice(null); }}
          invoice={vincularInvoice}
          onSuccess={onMutated}
        />
        <AcordarPagoModal
          open={!!acordarTarget}
          onOpenChange={(v) => { if (!v) setAcordarTarget(null); }}
          invoice={acordarTarget?.invoice ?? null}
          responsible={acordarTarget?.responsible ?? null}
          onSuccess={onMutated}
        />
        <PaymentLinkModal
          open={!!paymentLinkInvoice}
          onOpenChange={(v) => { if (!v) setPaymentLinkInvoice(null); }}
          invoice={paymentLinkInvoice}
        />

        {/* Unión de duplicados: elegir cuál nombre queda como principal */}
        <AlertDialog open={!!mergePair} onOpenChange={(o) => { if (!o && !merging) setMergePair(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <GitMerge className="h-4 w-4" />
                Unir beneficiarios
              </AlertDialogTitle>
              <AlertDialogDescription>
                Se juntan facturas, pagos, remisiones, cotizaciones y saldos de los dos
                en uno solo, y el otro queda como alias para siempre. Elegí cuál nombre
                queda:
              </AlertDialogDescription>
            </AlertDialogHeader>
            {mergePair && (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start h-auto py-2 text-left"
                  disabled={merging}
                  onClick={() => unirPar(mergePair, mergePair.a.client_id)}
                >
                  {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-600" />}
                  Dejar «{mergePair.a.client_name}»
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start h-auto py-2 text-left"
                  disabled={merging}
                  onClick={() => unirPar(mergePair, mergePair.b.client_id)}
                >
                  {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-600" />}
                  Dejar «{mergePair.b.client_name}»
                </Button>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={merging}>Cancelar</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
