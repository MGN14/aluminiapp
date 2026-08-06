/**
 * CIERRE DE INVENTARIO por variante — "cerrar caja" del inventario.
 *
 * Flujo (decisión de Nico, 2026-08-02):
 *   1. Bodega sube el conteo → se crea una sesión BORRADOR con una línea por
 *      referencia: teórico (inicial + contenedor − remisiones) vs contado.
 *      NO se toca el stock todavía.
 *   2. El admin revisa las diferencias (unidades y plata), corrige lo que sea
 *      error de conteo y decide qué pasa con lo que no vino en el archivo.
 *   3. CONFIRMAR (solo admin) → el conteo se vuelve la nueva fuente de verdad:
 *      por cada variante se escribe un movimiento 'ajuste' con el stock
 *      contado, que es el ANCLA nueva de computeVariantDesglose. De ahí en
 *      adelante contenedores y remisiones POSTERIORES vuelven a mover el saldo.
 *
 * NO se borra un solo movimiento del ledger: la historia de rotación por
 * referencia (la que alimenta el análisis de cuándo montar pedido) queda
 * intacta — solo deja de sumar al saldo, porque el ancla la reemplaza.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { canonicalizeRef } from '@/lib/refFamily';
import { fetchVariantValuation } from '@/lib/variantInventory';
import { trySaveFechaCorte } from '@/lib/inventoryConfig';

const db = supabase as never as { from: (t: string) => any };

export type CountSessionEstado = 'borrador' | 'confirmado' | 'descartado';

export interface CountSession {
  id: string;
  estado: CountSessionEstado;
  fecha_conteo: string;
  nombre: string | null;
  notas: string | null;
  cuenta_faltantes_como_cero: boolean;
  total_referencias: number;
  total_con_diferencia: number;
  total_unidades_diferencia: number;
  total_valor_diferencia: number;
  confirmado_at: string | null;
  created_at: string;
}

export interface CountLine {
  id: string;
  session_id: string;
  variant_id: string | null;
  variant_reference: string;
  descripcion: string | null;
  stock_teorico: number;
  stock_contado: number;
  diferencia: number;
  costo_unitario: number;
  es_nueva: boolean;
  nota: string | null;
}

/** Fila del archivo de conteo ya parseada (misma forma que la maestra). */
export interface ConteoRow {
  reference: string;
  name: string;
  stock: number;
  cost: number;
}

/**
 * Líneas de una sesión de conteo, imperativo (para exportar a Excel un cierre
 * del historial sin montar un hook por fila).
 */
export async function fetchCountLines(sessionId: string): Promise<CountLine[]> {
  const { data, error } = await db
    .from('inventory_count_lines')
    .select('*')
    .eq('session_id', sessionId)
    .order('variant_reference');
  if (error) throw error;
  return (data ?? []) as CountLine[];
}

/**
 * Re-sincroniza el "Debería haber" de un borrador con el stock VIVO de la
 * fórmula. El teórico se congela al crear el borrador; si después cambia la
 * fecha de corte, se recuadran movimientos o entra un contenedor, el borrador
 * quedaba comparando contra un número viejo (reporte de Nico 2026-08-05:
 * "faltan" $410M cuando la merma real era ~$5M). `diferencia` es columna
 * generada — se recalcula sola al actualizar stock_teorico.
 * Devuelve cuántas líneas se corrigieron.
 */
export async function syncTeoricoBorrador(sessionId: string): Promise<number> {
  const [lineas, valuacion] = await Promise.all([
    fetchCountLines(sessionId),
    fetchVariantValuation(),
  ]);
  const teoricoPorCanon = new Map(valuacion.map((v) => [canonicalizeRef(v.variant_reference), v.stock]));
  let corregidas = 0;
  for (const l of lineas) {
    const vivo = teoricoPorCanon.get(canonicalizeRef(l.variant_reference));
    if (vivo == null) continue; // ref nueva: no existe en variantes todavía
    if (Math.abs(Number(l.stock_teorico ?? 0) - vivo) < 0.5) continue;
    const { error } = await db
      .from('inventory_count_lines')
      .update({ stock_teorico: vivo })
      .eq('id', l.id);
    if (error) throw error;
    corregidas++;
  }
  return corregidas;
}

export function useInventoryCount() {
  const qc = useQueryClient();

  /** Sesiones: el borrador vivo (si hay) + el historial de cierres. */
  const sessions = useQuery({
    queryKey: ['inventory-count-sessions'],
    queryFn: async (): Promise<CountSession[]> => {
      const { data, error } = await db
        .from('inventory_count_sessions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as CountSession[];
    },
    staleTime: 60_000,
  });

  const borrador = (sessions.data ?? []).find((s) => s.estado === 'borrador') ?? null;

  const lines = useQuery({
    queryKey: ['inventory-count-lines', borrador?.id ?? null],
    enabled: !!borrador?.id,
    queryFn: async (): Promise<CountLine[]> => {
      const { data, error } = await db
        .from('inventory_count_lines')
        .select('*')
        .eq('session_id', borrador!.id)
        .order('variant_reference');
      if (error) throw error;
      return (data ?? []) as CountLine[];
    },
    staleTime: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['inventory-count-sessions'] });
    qc.invalidateQueries({ queryKey: ['inventory-count-lines'] });
  };

  /**
   * Crea el BORRADOR: cruza el archivo contra el teórico del ledger y guarda
   * una línea por referencia. No toca el inventario.
   */
  const crearBorrador = useMutation({
    mutationFn: async ({ filas, fechaConteo, nombre }: {
      filas: ConteoRow[]; fechaConteo: string; nombre?: string;
    }) => {
      if (!filas.length) throw new Error('El archivo no trae filas de conteo.');

      // Teórico vivo por variante (la MISMA cuenta de la pestaña Por variante).
      const [valuacion, variantesRes] = await Promise.all([
        fetchVariantValuation(),
        db.from('inventory_variants').select('id, variant_reference, avg_cost, name').eq('active', true),
      ]);
      const variantes = ((variantesRes as any).data ?? []) as {
        id: string; variant_reference: string; avg_cost: number; name: string | null;
      }[];
      const teoricoPorCanon = new Map(valuacion.map((v) => [canonicalizeRef(v.variant_reference), v.stock]));
      const variantePorCanon = new Map(variantes.map((v) => [canonicalizeRef(v.variant_reference), v]));

      const { data: ses, error: sesErr } = await db
        .from('inventory_count_sessions')
        .insert({
          estado: 'borrador',
          fecha_conteo: fechaConteo,
          nombre: nombre ?? null,
          total_referencias: filas.length,
        })
        .select('id')
        .single();
      if (sesErr) throw sesErr;

      const contadasCanon = new Set<string>();
      const rows = filas.map((f) => {
        const canon = canonicalizeRef(f.reference);
        contadasCanon.add(canon);
        const v = variantePorCanon.get(canon) ?? null;
        return {
          session_id: ses.id,
          variant_id: v?.id ?? null,
          variant_reference: v?.variant_reference ?? f.reference.trim().toUpperCase(),
          descripcion: f.name || v?.name || null,
          stock_teorico: teoricoPorCanon.get(canon) ?? 0,
          stock_contado: Number(f.stock ?? 0),
          costo_unitario: Number(f.cost ?? 0) > 0 ? Number(f.cost) : Number(v?.avg_cost ?? 0),
          es_nueva: !v,
        };
      });

      // Referencias que EXISTEN y NO vinieron en el archivo: se listan con
      // contado = teórico (diferencia 0) para que el admin decida — si marca
      // "lo no contado va a 0", se ajustan al confirmar.
      for (const v of variantes) {
        const canon = canonicalizeRef(v.variant_reference);
        if (contadasCanon.has(canon)) continue;
        const teo = teoricoPorCanon.get(canon) ?? 0;
        rows.push({
          session_id: ses.id,
          variant_id: v.id,
          variant_reference: v.variant_reference,
          descripcion: v.name,
          stock_teorico: teo,
          // Regla de Nico (2026-08-04): si no vino en el archivo es porque
          // NO HAY — contado 0, diferencia = −teórico. El admin puede
          // corregir la línea si de verdad hay stock sin contar.
          stock_contado: 0,
          costo_unitario: Number(v.avg_cost ?? 0),
          es_nueva: false,
          // @ts-expect-error columna opcional, la usa la UI para marcarla
          nota: 'no vino en el archivo',
        });
      }

      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await db.from('inventory_count_lines').insert(rows.slice(i, i + CHUNK));
        if (error) throw error;
      }
      return { sessionId: ses.id, lineas: rows.length };
    },
    onSuccess: invalidate,
  });

  /** Corrige el contado de una línea (error de conteo detectado en la revisión). */
  const editarLinea = useMutation({
    mutationFn: async ({ id, stock_contado }: { id: string; stock_contado: number }) => {
      const { error } = await db
        .from('inventory_count_lines')
        .update({ stock_contado })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-count-lines'] }),
  });

  /**
   * CONFIRMA el cierre: el conteo pasa a ser la fuente de verdad.
   * Por cada línea se escribe un movimiento 'ajuste' con el stock ABSOLUTO
   * contado (lo que no vino en el archivo va con 0 — regla de Nico
   * 2026-08-04), FECHADO EL DÍA DEL CONTEO, y la fecha de corte global (F0)
   * se mueve a ese día: las remisiones y contenedores posteriores vuelven a
   * mover el saldo desde ahí. Los movimientos viejos NO se borran.
   */
  const confirmarCierre = useMutation({
    mutationFn: async ({ sessionId, notas }: { sessionId: string; notas?: string }) => {
      // El cierre SIEMPRE se confirma contra el teórico vivo — nunca contra
      // el congelado al crear el borrador.
      await syncTeoricoBorrador(sessionId);
      const [{ data: lineasData, error: lErr }, { data: sesData, error: sErr }] = await Promise.all([
        db.from('inventory_count_lines').select('*').eq('session_id', sessionId),
        db.from('inventory_count_sessions').select('fecha_conteo').eq('id', sessionId).limit(1),
      ]);
      if (lErr) throw lErr;
      if (sErr) throw sErr;
      const lineas = (lineasData ?? []) as CountLine[];
      if (!lineas.length) throw new Error('El cierre no tiene líneas.');
      const fechaConteo = String((sesData as { fecha_conteo: string }[] | null)?.[0]?.fecha_conteo ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaConteo)) throw new Error('La sesión no tiene fecha de conteo.');

      const nowIso = new Date().toISOString();

      // 1. Crear las variantes nuevas que trajo el conteo.
      const nuevas = lineas.filter((l) => l.es_nueva && !l.variant_id);
      if (nuevas.length) {
        const { error } = await db.from('inventory_variants').upsert(
          nuevas.map((l) => ({
            variant_reference: l.variant_reference.trim().toUpperCase(),
            name: l.descripcion,
            stock: 0,
            avg_cost: Number(l.costo_unitario ?? 0),
            stock_inicial: 0,
            stock_inicial_date: nowIso,
            active: true,
          })),
          { onConflict: 'user_id,variant_reference' },
        );
        if (error) throw error;
        const { data: refetch } = await db
          .from('inventory_variants')
          .select('id, variant_reference')
          .eq('active', true);
        const porCanon = new Map(
          ((refetch ?? []) as { id: string; variant_reference: string }[])
            .map((v) => [canonicalizeRef(v.variant_reference), v.id]),
        );
        for (const l of nuevas) {
          l.variant_id = porCanon.get(canonicalizeRef(l.variant_reference)) ?? null;
        }
      }

      // 2. Aplicar el ancla: TODO se ancla a lo contado (el borrador ya trae
      //    0 en lo que no vino en el archivo).
      const aAncla = lineas.filter((l) => l.variant_id);
      const movimientos: Record<string, unknown>[] = [];
      for (const l of aAncla) {
        const stockFinal = Number(l.stock_contado ?? 0);
        const { error } = await db
          .from('inventory_variants')
          .update({
            stock: stockFinal,
            stock_inicial: stockFinal,
            stock_inicial_date: `${fechaConteo}T00:00:00Z`,
            last_count_date: `${fechaConteo}T00:00:00Z`,
            ...(Number(l.costo_unitario ?? 0) > 0 ? { avg_cost: Math.round(Number(l.costo_unitario)) } : {}),
          })
          .eq('id', l.variant_id);
        if (error) throw error;
        movimientos.push({
          variant_id: l.variant_id,
          movement_type: 'ajuste',       // foto absoluta (computeVariantDesglose)
          quantity: stockFinal,
          unit_cost: Number(l.costo_unitario ?? 0),
          source_type: 'cierre_inventario',
          source_id: sessionId,
          fecha: fechaConteo,            // el día CONTADO, no el click
          nota: `Cierre de inventario · dif ${Number(l.diferencia ?? 0) > 0 ? '+' : ''}${Math.round(Number(l.diferencia ?? 0))}`,
        });
      }
      const CHUNK = 500;
      for (let i = 0; i < movimientos.length; i += CHUNK) {
        const { error } = await db.from('inventory_variant_movements').insert(movimientos.slice(i, i + CHUNK));
        if (error) throw error;
      }

      // 2b. F0 := fecha del conteo — desde acá cuentan remisiones y
      //     contenedores para TODO el inventario.
      await trySaveFechaCorte(fechaConteo);

      // 3. Congelar los totales del reporte y cerrar la sesión.
      const conDif = lineas.filter((l) => Math.round(Number(l.diferencia ?? 0)) !== 0);
      const totalUnidades = conDif.reduce((s, l) => s + Number(l.diferencia ?? 0), 0);
      const totalValor = conDif.reduce((s, l) => s + Number(l.diferencia ?? 0) * Number(l.costo_unitario ?? 0), 0);
      const { data: userData } = await supabase.auth.getUser();
      const { error: upErr } = await db
        .from('inventory_count_sessions')
        .update({
          estado: 'confirmado',
          cuenta_faltantes_como_cero: true, // regla fija: no vino = 0
          notas: notas ?? null,
          total_referencias: lineas.length,
          total_con_diferencia: conDif.length,
          total_unidades_diferencia: Math.round(totalUnidades),
          total_valor_diferencia: Math.round(totalValor),
          confirmado_por: userData?.user?.id ?? null,
          confirmado_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', sessionId);
      if (upErr) throw upErr;

      return { ancladas: aAncla.length, conDiferencia: conDif.length, totalUnidades, totalValor };
    },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['inventory-variants'] });
      qc.invalidateQueries({ queryKey: ['inventory-variant-movs'] });
      qc.invalidateQueries({ queryKey: ['inventory-fecha-corte'] });
      qc.invalidateQueries({ queryKey: ['imports'] });
    },
  });

  /** Descarta el borrador sin aplicar nada. */
  const descartarBorrador = useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await db
        .from('inventory_count_sessions')
        .update({ estado: 'descartado', updated_at: new Date().toISOString() })
        .eq('id', sessionId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /** Líneas de un cierre YA confirmado (reporte histórico). */
  const useLineasDe = (sessionId: string | null) => useQuery({
    queryKey: ['inventory-count-lines', sessionId],
    enabled: !!sessionId,
    queryFn: () => fetchCountLines(sessionId!),
  });

  return {
    sessions: sessions.data ?? [],
    isPending: sessions.isPending,
    borrador,
    lineasBorrador: lines.data ?? [],
    lineasPending: lines.isPending,
    crearBorrador,
    editarLinea,
    confirmarCierre,
    descartarBorrador,
    useLineasDe,
  };
}
