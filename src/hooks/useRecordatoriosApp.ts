/**
 * Señales para los recordatorios de "Pendientes en la app" (tarjeta de Salud
 * del Dashboard). Solo lee: la última factura de venta y de compra, los
 * períodos de los extractos, el último conteo de inventario y lo que se movió
 * desde entonces, la caja menor sin cerrar y el estado de Siigo.
 *
 * Todas son consultas chicas (limit 1 o count sin filas), salvo los períodos
 * de extractos, que son pocas filas. La data es JSON plano (se persiste en el
 * cache de React Query): las reglas viven en lib/recordatoriosApp.ts.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDataOwner } from '@/hooks/useDataOwner';
import { usePermissions } from '@/hooks/usePermissions';
import type { ModuleKey } from '@/hooks/useCollaborators';
import {
  construirRecordatorios, filtrarPospuestos, posponer,
  type Pospuestos, type Recordatorio, type SenalesApp,
} from '@/lib/recordatoriosApp';
import { clasificarErrorSiigo } from '@/lib/siigoConexion';

/** Misma llave que el aviso de extractos de Conciliación ("No avisar de esta cuenta"). */
const EXTRACTOS_NO_AVISAR_KEY = 'aluminia_extractos_no_avisar_v1';
const POSPUESTOS_KEY = 'aluminia_recordatorios_pospuestos_v1';

type SenalesDb = Omit<SenalesApp, 'hoy' | 'extractosSilenciados'>;

function hoyLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function leerLista(key: string): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function leerPospuestos(): Pospuestos {
  try {
    const obj = JSON.parse(localStorage.getItem(POSPUESTOS_KEY) ?? '{}');
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v === 'string')) as Pospuestos;
  } catch {
    return {};
  }
}

const dia = (v: unknown): string | null => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null);
const maxDia = (...xs: (string | null)[]): string | null =>
  xs.filter((x): x is string => !!x).sort().pop() ?? null;

// Tablas que el tipo generado no conoce o conoce con otro shape: mismo patrón
// que el resto de hooks (cast a un cliente sin tipos).
type RespuestaDb = PromiseLike<{ data: unknown; error: unknown; count?: number | null }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as never as { from: (t: string) => any };

async function primeraFila(q: RespuestaDb): Promise<Record<string, unknown> | null> {
  const { data, error } = await q;
  if (error) return null; // una señal que falla no tumba las demás
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

async function contar(q: RespuestaDb): Promise<number> {
  const { count, error } = await q;
  return error ? 0 : count ?? 0;
}

async function fetchSenales(ownerId: string, esDueno: boolean): Promise<SenalesDb> {
  const [siigo, venta, compra, extractosRes, sesion, variante, corte, cajaVieja, cajaN] = await Promise.all([
    esDueno
      ? primeraFila(db.from('user_siigo_credentials').select('connection_status, last_error').eq('user_id', ownerId).limit(1))
      : Promise.resolve(null),
    primeraFila(db.from('invoices').select('issue_date').eq('user_id', ownerId).eq('type', 'venta')
      .order('issue_date', { ascending: false }).limit(1)),
    primeraFila(db.from('invoices').select('issue_date').eq('user_id', ownerId).eq('type', 'compra')
      .order('issue_date', { ascending: false }).limit(1)),
    db.from('bank_statements').select('bank_name, period_start, period_end')
      .eq('user_id', ownerId).is('deleted_at', null) as RespuestaDb,
    primeraFila(db.from('inventory_count_sessions').select('fecha_conteo').eq('user_id', ownerId)
      .eq('estado', 'confirmado').order('fecha_conteo', { ascending: false }).limit(1)),
    primeraFila(db.from('inventory_variants').select('last_count_date').eq('user_id', ownerId)
      .not('last_count_date', 'is', null).order('last_count_date', { ascending: false }).limit(1)),
    primeraFila(db.from('inventory_variants').select('stock_inicial_date').eq('user_id', ownerId)
      .not('stock_inicial_date', 'is', null).order('stock_inicial_date', { ascending: false }).limit(1)),
    primeraFila(db.from('petty_cash_movements').select('date').eq('user_id', ownerId)
      .is('closing_id', null).order('date', { ascending: true }).limit(1)),
    contar(db.from('petty_cash_movements').select('id', { count: 'exact', head: true })
      .eq('user_id', ownerId).is('closing_id', null)),
  ]);

  // Último conteo = el cierre confirmado más reciente (o la fecha que ese
  // cierre dejó en las variantes). Si nunca hubo cierre, la fecha de corte
  // del stock inicial hace de punto de partida.
  const ultimoConteo = maxDia(dia(sesion?.fecha_conteo), dia(variante?.last_count_date)) ?? dia(corte?.stock_inicial_date);
  const movimientosDesdeConteo = ultimoConteo
    ? await contar(db.from('inventory_variant_movements').select('id', { count: 'exact', head: true })
      .eq('user_id', ownerId).gt('fecha', ultimoConteo))
    : 0;

  const extractos = (Array.isArray(extractosRes.data) ? extractosRes.data : []) as SenalesApp['extractos'];

  return {
    siigo: siigo
      ? {
        estado: typeof siigo.connection_status === 'string' ? siigo.connection_status : null,
        errorDeClave: clasificarErrorSiigo(typeof siigo.last_error === 'string' ? siigo.last_error : null) === 'clave',
      }
      : null,
    ultimaVenta: dia(venta?.issue_date),
    ultimaCompra: dia(compra?.issue_date),
    extractos: extractosRes.error ? [] : extractos,
    ultimoConteo,
    movimientosDesdeConteo,
    cajaSinCerrar: { movimientos: cajaN, masViejo: dia(cajaVieja?.date) },
  };
}

export interface UseRecordatoriosAppResult {
  recordatorios: Recordatorio[];
  loading: boolean;
  /** Esconde el recordatorio 7 días en este navegador. */
  posponer: (id: string) => void;
}

export function useRecordatoriosApp(): UseRecordatoriosAppResult {
  const { dataOwnerId, isCollaborator, loading: ownerLoading } = useDataOwner();
  const { hasModule, isAdmin, loading: permsLoading } = usePermissions();
  const esDueno = !isCollaborator;

  const query = useQuery({
    queryKey: ['recordatorios-app', dataOwnerId, esDueno],
    enabled: !!dataOwnerId && !ownerLoading,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchSenales(dataOwnerId!, esDueno),
  });

  const [pospuestos, setPospuestos] = useState<Pospuestos>(() => leerPospuestos());
  const hoy = hoyLocal();

  const recordatorios = useMemo(() => {
    if (!query.data) return [];
    const todos = construirRecordatorios({
      ...query.data,
      hoy,
      extractosSilenciados: leerLista(EXTRACTOS_NO_AVISAR_KEY),
    });
    // Solo lo que esta persona puede ir a resolver.
    const permitidos = todos.filter((r) => (r.modulo === 'admin' ? esDueno && isAdmin : hasModule(r.modulo as ModuleKey)));
    return filtrarPospuestos(permitidos, pospuestos, hoy);
  }, [query.data, hoy, esDueno, isAdmin, hasModule, pospuestos]);

  const posponerUno = useCallback((id: string) => {
    setPospuestos((prev) => {
      const next = posponer(prev, id, hoyLocal());
      try { localStorage.setItem(POSPUESTOS_KEY, JSON.stringify(next)); } catch { /* modo privado */ }
      return next;
    });
  }, []);

  return {
    recordatorios,
    loading: query.isPending || ownerLoading || permsLoading,
    posponer: posponerUno,
  };
}
