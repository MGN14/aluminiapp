/**
 * Fase 2 del inventario por VARIANTE de color: movimientos automáticos.
 *
 *   ENTRADA — packing list nacionalizado: cuando un pedido de Importaciones
 *   pasa a 'entregado', sus import_items (packing manda sobre proforma) suman
 *   stock por variante con su costo (costo_unitario_excel como vara v1).
 *   SALIDA — remisiones: la referencia de remision_items ya viene con el
 *   sufijo de color tal como se despachó → descuenta la variante exacta.
 *
 * Puertas de entrada de referencias NUEVAS (decisión de Nico, 2026-07-29):
 *   · IMPORTACIONES: el packing del contenedor CREA las variantes que no
 *     existan (es lo primero que entra al sistema con referencias).
 *   · La maestra sigue mandando para ANCLAR conteos.
 *   · Las REMISIONES nunca crean (un typo no fabrica inventario): sin match
 *     → no-op + aviso.
 * El inventario -5 (inventory_products) sigue su flujo propio (Siigo).
 *
 * Idempotencia: índice único (variant_id, source_type, source_id) + chequeo
 * previo por source — reintentar no duplica el contenedor ni la remisión.
 */

import { supabase } from '@/integrations/supabase/client';
import { applyColorSuffix, canonicalizeRef } from '@/lib/refFamily';
import { fetchFechaCorte } from '@/lib/inventoryConfig';


const db = supabase as never as {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

interface VariantLite {
  id: string;
  variant_reference: string;
  stock: number;
  avg_cost: number;
  /** Conteo de maestra, o timestamp de NACIMIENTO si la auto-creó un contenedor. */
  stock_inicial_date: string | null;
  /** Último conteo REAL (maestra o ajuste manual). null = nunca contada: su
   *  vida rastreada arranca en la FECHA DE ARRIBO del contenedor que la creó
   *  (regla de Nico 2026-08-02: "las remisiones solo restan después de la
   *  fecha del entregado") — no en el click de 'entregado' en la app, que
   *  puede ser días después de que bodega ya despachaba de ese contenedor. */
  last_count_date: string | null;
}

/** Todas las variantes activas (la maestra son ~cientos de filas: barato). */
async function fetchActiveVariants(): Promise<VariantLite[]> {
  const { data, error } = await db
    .from('inventory_variants')
    .select('id, variant_reference, stock, avg_cost, stock_inicial_date, last_count_date')
    .eq('active', true);
  if (error) throw error;
  return (data ?? []) as VariantLite[];
}

/** Variantes activas indexadas por referencia normalizada. Map vacío = maestra
 *  sin sembrar → todos los hooks quedan en no-op. */
async function fetchVariantsByRefs(refs: string[]): Promise<Map<string, VariantLite>> {
  const buscadas = new Set(refs.map((r) => canonicalizeRef(r)).filter(Boolean));
  if (!buscadas.size) return new Map();
  // Se cruzan por forma canónica: el `.in()` exacto fallaba cuando la misma
  // pieza venía escrita distinto ("38*38-3" de China vs "38X38-3" de la
  // maestra) y el contenedor no entraba al stock.
  const map = new Map<string, VariantLite>();
  for (const v of await fetchActiveVariants()) {
    const key = canonicalizeRef(v.variant_reference);
    if (buscadas.has(key)) map.set(key, v);
  }
  return map;
}

/** ¿Esta fuente ya se aplicó al ledger? (idempotencia por source). */
async function sourceAlreadyApplied(sourceType: string, sourceId: string): Promise<boolean> {
  const { data, error } = await db
    .from('inventory_variant_movements')
    .select('id')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export interface VariantApplyResult {
  applied: number;
  /** Referencias sin variante en la maestra (remisiones: se saltan — un typo
   *  no crea inventario. Importaciones: se CREAN, ver applyVariantImportEntrada). */
  unmatched: string[];
  /** Variantes NUEVAS creadas desde el packing del contenedor. */
  created?: number;
}

const NOOP: VariantApplyResult = { applied: 0, unmatched: [], created: 0 };

// ── SALIDA / ENTRADA por remisión ───────────────────────────────────────────

export interface VariantRemisionItem {
  reference: string; // tal como se despachó (con sufijo de color)
  units: number;
}

/** Remisión con lo necesario para conciliar su rastro en el ledger. */
export interface RemisionParaLedger {
  id: string;
  remision_type: 'venta' | 'compra';
  /** Fecha de la remisión (columna `fecha` del movimiento). */
  date: string;
  /** Cuándo se REGISTRÓ en la app — decide si un conteo posterior ya la
   *  absorbió (el conteo físico no vio las unidades que salieron antes). */
  created_at: string;
  /** Cancelada: sus filas del ledger posteriores al conteo se eliminan. */
  cancelada?: boolean;
  items: VariantRemisionItem[];
}

export interface ReconcileResult {
  /** Filas del ledger insertadas (líneas que nunca se habían descontado). */
  insertadas: number;
  /** Filas con cantidad corregida (remisión editada después de aplicar). */
  corregidas: number;
  /** Filas eliminadas (línea borrada o remisión cancelada). */
  eliminadas: number;
  unmatched: string[];
}

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Alias confirmados a mano (product_aliases), llaveados en forma canónica.
 *  Se consulta acá (y no vía remisionInventory) para no crear import circular. */
async function fetchAliasesCanonicos(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data } = await db.from('product_aliases').select('alias, ref_siigo');
    for (const r of (data ?? []) as { alias: string; ref_siigo: string }[]) {
      const k = canonicalizeRef(r.alias);
      if (k && r.ref_siigo) map.set(k, r.ref_siigo);
    }
  } catch { /* los alias son un plus: sin tabla o sin permiso, cruce directo */ }
  return map;
}

/**
 * Concilia el rastro de remisiones en el ledger por variante — la ÚNICA
 * escritura de filas source_type='remision'.
 *
 * DESDE LA FÓRMULA ÚNICA (2026-08-04) el ledger es INCONDICIONAL: un espejo
 * fiel de remision_items, sin ventanas ni anclas. Por cada par (remisión,
 * variante): falta la fila → se inserta con la fecha REAL de la remisión;
 * la cantidad/fecha difiere (remisión editada) → se corrige; sobra (línea
 * borrada, remisión cancelada) → se elimina. La fecha de corte F0 se aplica
 * únicamente al CALCULAR el stock (computeVariantDesglose) — por eso mover
 * F0 o recuadrar nunca puede cambiar el valor del inventario.
 *
 * Al final, el stock cacheado de las variantes tocadas se recalcula con la
 * fórmula. Idempotente: correrla dos veces seguidas no cambia nada.
 */
export async function reconcileVariantRemisionLedger(
  remisiones: RemisionParaLedger[],
  opts?: {
    /** Limitar el cruce a estas referencias (ej. recién creadas por contenedor). */
    onlyRefs?: string[];
    /** true = la lista de remisiones es TODA la tabla: filas del ledger cuya
     *  remisión no aparezca (borrada a mano) también se limpian. */
    exhaustive?: boolean;
  },
): Promise<ReconcileResult> {
  const res: ReconcileResult = { insertadas: 0, corregidas: 0, eliminadas: 0, unmatched: [] };
  if (!remisiones.length) return res;

  const variantes = await fetchActiveVariants();
  if (!variantes.length) return res;
  const porCanonical = new Map<string, VariantLite>();
  for (const v of variantes) {
    const k = canonicalizeRef(v.variant_reference);
    if (k && !porCanonical.has(k)) porCanonical.set(k, v);
  }
  const porId = new Map(variantes.map((v) => [v.id, v]));

  const onlySet = opts?.onlyRefs?.length
    ? new Set(opts.onlyRefs.map((r) => canonicalizeRef(r)).filter(Boolean))
    : null;
  const permitida = (v: VariantLite) => !onlySet || onlySet.has(canonicalizeRef(v.variant_reference));
  const aliases = await fetchAliasesCanonicos();
  const resolver = (ref: string): VariantLite | null => {
    const directo = porCanonical.get(canonicalizeRef(ref));
    if (directo) return directo;
    const destino = aliases.get(canonicalizeRef(ref));
    return destino ? (porCanonical.get(canonicalizeRef(destino)) ?? null) : null;
  };

  // Lo ESPERADO según remision_items, agregado por (remisión, variante).
  const remPorId = new Map(remisiones.map((r) => [r.id, r]));
  const esperado = new Map<string, Map<string, number>>(); // remId → variantId → qty
  const sinMatch = new Set<string>();
  for (const rem of remisiones) {
    const qtyPorVariante = new Map<string, number>();
    if (!rem.cancelada) {
      for (const it of rem.items ?? []) {
        const qty = Math.abs(Number(it.units ?? 0));
        if (qty <= 0) continue;
        const v = resolver(it.reference);
        if (!v) {
          if (!onlySet) sinMatch.add(it.reference);
          continue;
        }
        if (!permitida(v)) continue;
        qtyPorVariante.set(v.id, (qtyPorVariante.get(v.id) ?? 0) + qty);
      }
    }
    esperado.set(rem.id, qtyPorVariante);
  }

  // Lo APLICADO: filas del ledger de esas remisiones (o todas, si exhaustive).
  interface LedgerRow { id: string; variant_id: string; movement_type: string; quantity: number; source_id: string; fecha: string | null }
  const existentes: LedgerRow[] = [];
  if (opts?.exhaustive) {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('inventory_variant_movements')
        .select('id, variant_id, movement_type, quantity, source_id, fecha')
        .eq('source_type', 'remision')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as LedgerRow[];
      existentes.push(...rows);
      if (rows.length < PAGE) break;
    }
  } else {
    for (const ids of chunk([...remPorId.keys()], 150)) {
      const { data, error } = await db
        .from('inventory_variant_movements')
        .select('id, variant_id, movement_type, quantity, source_id, fecha')
        .eq('source_type', 'remision')
        .in('source_id', ids);
      if (error) throw error;
      existentes.push(...((data ?? []) as LedgerRow[]));
    }
  }
  const filaPorPar = new Map<string, LedgerRow>();
  for (const row of existentes) filaPorPar.set(`${row.source_id}|${row.variant_id}`, row);

  // Diff → insertar / corregir / eliminar. SIN ventanas: el ledger es el
  // espejo de remision_items; F0 filtra recién al calcular el stock.
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: { id: string; quantity: number; movement_type: string; fecha: string }[] = [];
  const toDeleteIds: string[] = [];
  const afectadas = new Set<string>();
  const consumidas = new Set<string>();

  for (const [remId, qtyPorVariante] of esperado) {
    const rem = remPorId.get(remId)!;
    const movementType = rem.remision_type === 'compra' ? 'entrada' : 'salida';
    for (const [variantId, qty] of qtyPorVariante) {
      const key = `${remId}|${variantId}`;
      consumidas.add(key);
      const fila = filaPorPar.get(key);
      if (!fila) {
        toInsert.push({
          variant_id: variantId,
          movement_type: movementType,
          quantity: qty,
          unit_cost: 0,
          source_type: 'remision',
          source_id: remId,
          fecha: rem.date,
        });
        afectadas.add(variantId);
        continue;
      }
      const filaFecha = (fila.fecha ?? '').slice(0, 10);
      if (Number(fila.quantity) !== qty || fila.movement_type !== movementType
        || filaFecha !== rem.date.slice(0, 10)) {
        toUpdate.push({ id: fila.id, quantity: qty, movement_type: movementType, fecha: rem.date });
        afectadas.add(variantId);
      }
    }
  }

  // Filas cuyo par (remisión, variante) ya no existe: línea borrada, remisión
  // cancelada, o (exhaustive) remisión eliminada de la tabla.
  for (const row of existentes) {
    const key = `${row.source_id}|${row.variant_id}`;
    if (consumidas.has(key)) continue;
    const v = porId.get(row.variant_id);
    if (!v || !permitida(v)) continue; // variante inactiva o fuera del alcance
    const rem = remPorId.get(row.source_id);
    if (!rem && !opts?.exhaustive) continue; // remisión fuera de la lista parcial
    toDeleteIds.push(row.id);
    afectadas.add(row.variant_id);
  }

  for (const lote of chunk(toInsert, 500)) {
    const { error } = await db.from('inventory_variant_movements').insert(lote);
    if (error) throw error;
  }
  for (const u of toUpdate) {
    const { error } = await db
      .from('inventory_variant_movements')
      .update({ quantity: u.quantity, movement_type: u.movement_type, fecha: u.fecha })
      .eq('id', u.id);
    if (error) throw error;
  }
  for (const ids of chunk(toDeleteIds, 200)) {
    const { error } = await db.from('inventory_variant_movements').delete().in('id', ids);
    if (error) throw error;
  }
  // El cache de las tocadas se recalcula con la MISMA fórmula del panel.
  if (afectadas.size) await syncVariantStockToLedger({ onlyIds: [...afectadas] });

  res.insertadas = toInsert.length;
  res.corregidas = toUpdate.length;
  res.eliminadas = toDeleteIds.length;
  res.unmatched = [...sinMatch];
  return res;
}

/**
 * Concilia contra remisiones leídas DIRECTO de la base (todas, incluidas las
 * canceladas — sus filas residuales se limpian). La usan el panel (auto y
 * botón Recuadrar) y la entrada de contenedor (refs recién creadas).
 */
export async function backfillVariantRemisionesDesdeDB(
  opts?: { onlyRefs?: string[] },
): Promise<ReconcileResult> {
  const PAGE = 500;
  const remisiones: RemisionParaLedger[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('remisiones')
      .select('id, date, created_at, remision_type, status, remision_items(reference, units)')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as {
      id: string; date: string; created_at: string; remision_type: string;
      status: string | null; remision_items: { reference: string; units: number }[] | null;
    }[];
    for (const r of rows) {
      remisiones.push({
        id: r.id,
        remision_type: r.remision_type === 'compra' ? 'compra' : 'venta',
        date: r.date,
        created_at: r.created_at,
        cancelada: r.status === 'cancelado',
        items: (r.remision_items ?? []).map((i) => ({ reference: i.reference, units: Number(i.units ?? 0) })),
      });
    }
    if (rows.length < PAGE) break;
  }
  return reconcileVariantRemisionLedger(remisiones, { onlyRefs: opts?.onlyRefs, exhaustive: true });
}

/**
 * Aplica una remisión al inventario por variante. venta = salida; compra =
 * entrada. Best-effort: si la maestra está vacía o ninguna ref matchea, no-op.
 * Idempotente POR LÍNEA (no por remisión): reintentar completa lo que falte.
 */
export async function applyVariantRemision(params: {
  remisionId: string;
  remisionType: 'venta' | 'compra';
  movementDate: string;
  items: VariantRemisionItem[];
  /** created_at real de la remisión (ediciones). Sin él se asume "ahora". */
  remisionCreatedAt?: string;
}): Promise<VariantApplyResult> {
  const { remisionId, remisionType, movementDate, items, remisionCreatedAt } = params;
  const r = await reconcileVariantRemisionLedger([
    {
      id: remisionId,
      remision_type: remisionType,
      date: movementDate,
      created_at: remisionCreatedAt ?? new Date().toISOString(),
      items,
    },
  ]);
  return { applied: r.insertadas + r.corregidas, unmatched: r.unmatched };
}

/** Revierte los movimientos por variante de una remisión (borrado/edición):
 *  borra sus filas y recalcula el cache de las variantes tocadas con LA fórmula. */
export async function reverseVariantRemision(remisionId: string): Promise<void> {
  const { data, error } = await db
    .from('inventory_variant_movements')
    .select('id, variant_id')
    .eq('source_type', 'remision')
    .eq('source_id', remisionId);
  if (error) throw error;
  const rows = (data ?? []) as { id: string; variant_id: string }[];
  if (!rows.length) return;
  await db.from('inventory_variant_movements').delete().in('id', rows.map((r) => r.id));
  await syncVariantStockToLedger({ onlyIds: [...new Set(rows.map((r) => r.variant_id))] });
}

// ── ENTRADA por packing nacionalizado (import → entregado) ─────────────────

/**
 * Suma el packing list de un pedido entregado al inventario por variante,
 * con su costo (costo_unitario_excel v1 — la vara de Nico) y recalcula el
 * costo promedio ponderado. Packing manda sobre proforma. Idempotente.
 */
export async function applyVariantImportEntrada(
  importId: string,
  opts?: { reapply?: boolean },
): Promise<VariantApplyResult> {
  // Re-aplicar (excel nuevo): la reversa SOLO se hace si la nueva entrada va
  // a matchear algo. Antes se reversaba primero y, si las referencias del
  // excel no existían en la maestra, la re-entrada quedaba en no-op y el
  // stock se PERDÍA (bug detectado 2026-07-24).
  if (opts?.reapply) {
    // Con el auto-create (2026-07-29) el reapply es seguro mientras el pedido
    // tenga items: la re-entrada matchea o CREA — nunca deja el stock perdido.
    const { data: peek } = await db
      .from('import_items')
      .select('id')
      .eq('import_id', importId)
      .limit(1);
    if (!((peek ?? []) as unknown[]).length) return NOOP;
    await reverseVariantImportEntrada(importId);
  }
  return applyVariantImportEntradaInner(importId);
}

async function applyVariantImportEntradaInner(importId: string): Promise<VariantApplyResult> {
  const { data: itemsData, error: itErr } = await db
    .from('import_items')
    .select('reference, descripcion, cantidad, color, source, costo_unitario_excel')
    .eq('import_id', importId);
  if (itErr) throw itErr;
  const all = (itemsData ?? []) as { reference: string; descripcion: string | null; cantidad: number; color: string | null; source: string | null; costo_unitario_excel: number | null }[];
  if (!all.length) return NOOP;

  // Packing definitivo manda; proforma solo si no hay packing.
  const hayPacking = all.some((r) => (r.source ?? 'packing') === 'packing');
  const items = hayPacking ? all.filter((r) => (r.source ?? 'packing') === 'packing') : all;

  const refsConSufijo = items.map((it) => applyColorSuffix(it.reference, it.color ?? null));
  let variants = await fetchVariantsByRefs(refsConSufijo);
  if (await sourceAlreadyApplied('import', importId)) return NOOP;

  // Referencias del contenedor SIN variante: se CREAN (decisión de Nico,
  // 2026-07-29 — "el módulo de importaciones es la puerta de entrada de
  // referencias nuevas"). Antes se saltaban en silencio y la app no conocía
  // mercancía que estaba físicamente en bodega (las 43 refs de Lina). La
  // maestra sigue mandando para ANCLAR conteos; ya no es la única puerta.
  let created = 0;
  const nuevasPorCanonical = new Map<string, { variant_reference: string; name: string | null }>();
  for (let i = 0; i < items.length; i++) {
    const key = canonicalizeRef(refsConSufijo[i]);
    if (!key || variants.has(key) || nuevasPorCanonical.has(key)) continue;
    if (Math.abs(Number(items[i].cantidad ?? 0)) <= 0) continue;
    nuevasPorCanonical.set(key, {
      variant_reference: refsConSufijo[i].trim().toUpperCase(),
      name: (items[i].descripcion ?? '').trim() || null,
    });
  }
  if (nuevasPorCanonical.size) {
    const nowIso = new Date().toISOString();
    const rows = [...nuevasPorCanonical.values()].map((n) => ({
      variant_reference: n.variant_reference,
      name: n.name,
      stock: 0,           // la entrada del contenedor pone stock y costo abajo
      avg_cost: 0,
      stock_inicial: 0,
      stock_inicial_date: nowIso,
      active: true,
    }));
    // Upsert por si dos corridas concurrentes crean la misma (trigger pone user_id).
    const { error: crErr } = await db
      .from('inventory_variants')
      .upsert(rows, { onConflict: 'user_id,variant_reference' });
    if (crErr) throw crErr;
    created = rows.length;
    variants = await fetchVariantsByRefs(refsConSufijo); // re-cruce con las nuevas
  }
  if (!variants.size) return NOOP;

  // Agregar por variante (mismo color puede venir en varios renglones).
  const acc = new Map<string, { qty: number; costo: number }>(); // costo = Σ qty×unit
  const unmatched: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const v = variants.get(canonicalizeRef(refsConSufijo[i]));
    if (!v) { unmatched.push(refsConSufijo[i]); continue; }
    const qty = Math.abs(Number(items[i].cantidad ?? 0));
    if (qty <= 0) continue;
    const unit = Number(items[i].costo_unitario_excel ?? 0);
    const a = acc.get(v.id) ?? { qty: 0, costo: 0 };
    a.qty += qty; a.costo += qty * unit;
    acc.set(v.id, a);
  }
  if (!acc.size) return { applied: 0, unmatched, created };

  // La fecha del HECHO: el arribo real del contenedor (no el click de
  // 'entregado') — es la que usa la fórmula para decidir si suma sobre F0.
  const { data: impRows } = await db
    .from('imports')
    .select('fecha_arribo_real')
    .eq('id', importId)
    .limit(1);
  const fechaEntrada = String((impRows as { fecha_arribo_real: string | null }[] | null)?.[0]?.fecha_arribo_real ?? '').slice(0, 10)
    || new Date().toISOString().slice(0, 10);

  const porId = new Map([...variants.values()].map((v) => [v.id, v]));
  const rows = [...acc.entries()].map(([variantId, a]) => ({
    variant_id: variantId,
    movement_type: 'entrada',
    quantity: a.qty,
    unit_cost: a.qty > 0 ? a.costo / a.qty : 0,
    source_type: 'import',
    source_id: importId,
    fecha: fechaEntrada,
    nota: 'Packing list nacionalizado',
  }));
  const { error } = await db.from('inventory_variant_movements').insert(rows);
  if (error) throw error;

  for (const [variantId, a] of acc) {
    const v = porId.get(variantId)!;
    const unit = a.qty > 0 ? a.costo / a.qty : 0;
    // Costo promedio ponderado: solo si la entrada trae costo (>0). El STOCK
    // ya no se toca acá — lo recalcula la fórmula única al final.
    if (unit > 0) {
      // El clamp a 0 es SOLO para ponderar el costo (no promediar contra
      // stock negativo). Guard del kardex: si el stock previo no tiene costo
      // (ancla de conteo sin columna de costo → avg 0), el costo de la
      // entrada MANDA — promediar contra $0 diluía el costo del excel
      // (reporte de Nico 2026-07-30).
      const base = Math.max(0, Number(v.stock ?? 0));
      const avgPrevio = Number(v.avg_cost ?? 0);
      const nuevoAvg = (base <= 0 || avgPrevio <= 0)
        ? unit
        : (base * avgPrevio + a.costo) / (base + a.qty);
      const { error: upErr } = await db
        .from('inventory_variants')
        .update({ avg_cost: Math.round(nuevoAvg) })
        .eq('id', variantId);
      if (upErr) throw upErr;
    }
  }
  // Cache := fórmula (inicial + contenedor − remisiones desde F0).
  await syncVariantStockToLedger({ onlyIds: [...acc.keys()] });

  return { applied: acc.size, unmatched, created };
}

// ── Desglose teórico + cuadre stock↔ledger ─────────────────────────────────

export interface VariantMovLite {
  movement_type: string;
  quantity: number;
  source_type: string | null;
  created_at: string;
  /** Fecha del HECHO (cuándo salió/entró la mercancía) — el corte va por acá,
   *  nunca por created_at (cuándo se digitó). Filas viejas pueden no traerla. */
  fecha?: string | null;
}

export interface VariantDesglose {
  ancla: number;
  contenedor: number;
  remisiones: number; // ventas − compras (neto que RESTA)
  teorico: number;
}

/** Día del hecho de un movimiento; sin `fecha` cae al día de la digitación. */
export const diaDeMov = (m: { fecha?: string | null; created_at: string }): string => {
  const f = (m.fecha ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : (m.created_at ?? '').slice(0, 10);
};

/**
 * LA fórmula del stock por variante (decisión de Nico, 2026-08-04):
 *
 *   stock = inicial + contenedor − remisiones, con UNA fecha de corte global
 *   (F0). Cuenta todo movimiento con fecha POSTERIOR a F0; lo anterior ya
 *   está dentro del inicial. Se corta por la fecha del HECHO — mover F0 o
 *   recargar jamás cambia el resultado, porque no depende de cuándo se digitó.
 *
 * El INICIAL es la foto más reciente ('inicial'/'ajuste' guardan el stock
 * ABSOLUTO); sin fotos, cae a inventory_variants.stock_inicial. Una foto
 * POSTERIOR a F0 (ajuste manual, cierre nuevo) mueve el arranque de ESA
 * referencia hacia adelante — si no, la corrección se desharía sola en el
 * siguiente cuadre.
 *
 * Única implementación: la usan la tabla, el cuadre, la valorización del
 * Dashboard y el teórico del cierre de inventario.
 */
export function computeVariantDesglose(
  v: { stock_inicial: number | null; stock_inicial_date?: string | null },
  movs: VariantMovLite[],
  corte: string,
): VariantDesglose {
  let foto: VariantMovLite | null = null;
  for (const m of movs) {
    if (m.movement_type !== 'inicial' && m.movement_type !== 'ajuste') continue;
    if (!foto || diaDeMov(m) > diaDeMov(foto)
      || (diaDeMov(m) === diaDeMov(foto) && m.created_at > foto.created_at)) foto = m;
  }
  const ancla = foto ? Number(foto.quantity ?? 0) : Number(v.stock_inicial ?? 0);
  const corteVar = foto && diaDeMov(foto) > corte ? diaDeMov(foto) : corte;

  let contenedor = 0;
  let remisiones = 0;
  for (const m of movs) {
    if (m.movement_type === 'inicial' || m.movement_type === 'ajuste') continue;
    if (diaDeMov(m) <= corteVar) continue; // ya está dentro del inicial
    const qty = Number(m.quantity ?? 0);
    if (m.source_type === 'import' && m.movement_type === 'entrada') contenedor += qty;
    if (m.source_type === 'remision' && m.movement_type === 'salida') remisiones += qty;
    if (m.source_type === 'remision' && m.movement_type === 'entrada') remisiones -= qty;
  }
  return { ancla, contenedor, remisiones, teorico: ancla + contenedor - remisiones };
}

/**
 * TODOS los movimientos del ledger, paginando de a 1000: PostgREST corta
 * cada request en 1000 filas SIN avisar, y el ledger ya pasa de eso (cada
 * re-anclaje de maestra escribe ~una fila 'inicial' por variante). Con la
 * historia incompleta el teórico salía mal y el cuadre no corregía nada
 * (reporte de Nico 2026-08-01: "el problema del stock sigue igual").
 */
export async function fetchAllVariantMovements(
  opts?: { onlyVariantIds?: string[] },
): Promise<(VariantMovLite & { variant_id: string })[]> {
  const PAGE = 1000;
  const out: (VariantMovLite & { variant_id: string })[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db
      .from('inventory_variant_movements')
      .select('variant_id, movement_type, quantity, source_type, created_at, fecha')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }) // desempate estable para paginar sin duplicar
      .range(from, from + PAGE - 1);
    if (opts?.onlyVariantIds?.length) q = q.in('variant_id', opts.onlyVariantIds);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as (VariantMovLite & { variant_id: string })[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Cuadra el stock guardado (cache que lee Importaciones) con LA fórmula:
 * inicial + contenedor − remisiones desde F0. Devuelve cuántas corrigió.
 * Con `onlyIds` limita el cuadre a esas variantes (post-conciliación).
 */
export async function syncVariantStockToLedger(opts?: { onlyIds?: string[] }): Promise<number> {
  if (opts?.onlyIds && !opts.onlyIds.length) return 0;
  const corte = await fetchFechaCorte();
  let vQuery = db
    .from('inventory_variants')
    .select('id, stock, stock_inicial, stock_inicial_date')
    .eq('active', true);
  if (opts?.onlyIds?.length) vQuery = vQuery.in('id', opts.onlyIds);
  const { data: vData, error: vErr } = await vQuery;
  if (vErr) throw vErr;
  const allMovs = await fetchAllVariantMovements({ onlyVariantIds: opts?.onlyIds });

  const movsPorVariante = new Map<string, VariantMovLite[]>();
  for (const m of allMovs) {
    const arr = movsPorVariante.get(m.variant_id) ?? [];
    arr.push(m);
    movsPorVariante.set(m.variant_id, arr);
  }

  let corregidas = 0;
  const rows = (vData ?? []) as { id: string; stock: number; stock_inicial: number | null; stock_inicial_date: string | null }[];
  for (const v of rows) {
    const d = computeVariantDesglose(v, movsPorVariante.get(v.id) ?? [], corte);
    if (Math.round(Number(v.stock ?? 0)) === Math.round(d.teorico)) continue;
    const { error } = await db.from('inventory_variants').update({ stock: d.teorico }).eq('id', v.id);
    if (error) throw error;
    corregidas++;
  }
  return corregidas;
}

export interface VariantValuation {
  variant_reference: string;
  name: string | null;
  /** Teórico del ledger (inicial + contenedor − remisiones), NO el cacheado. */
  stock: number;
  avg_cost: number;
  valor: number;
}

/**
 * Valorización por variante calculada DESDE el ledger — la misma cuenta de
 * la tabla de Inventario → Variantes. El Dashboard la usa para que el "vale
 * oro" nunca dependa del stock cacheado (que puede estar descuadrado hasta
 * que corra el auto-cuadre del panel).
 */
export async function fetchVariantValuation(): Promise<VariantValuation[]> {
  const { data, error } = await db
    .from('inventory_variants')
    .select('id, variant_reference, name, stock, avg_cost, stock_inicial, stock_inicial_date')
    .eq('active', true);
  if (error) throw error;
  const rows = (data ?? []) as {
    id: string; variant_reference: string; name: string | null; stock: number;
    avg_cost: number; stock_inicial: number | null; stock_inicial_date: string | null;
  }[];
  if (!rows.length) return [];
  const corte = await fetchFechaCorte();
  const allMovs = await fetchAllVariantMovements();
  const movsPorVariante = new Map<string, VariantMovLite[]>();
  for (const m of allMovs) {
    const arr = movsPorVariante.get(m.variant_id) ?? [];
    arr.push(m);
    movsPorVariante.set(m.variant_id, arr);
  }
  const out: VariantValuation[] = [];
  const descuadradas: { id: string; teorico: number }[] = [];
  for (const v of rows) {
    const teorico = computeVariantDesglose(v, movsPorVariante.get(v.id) ?? [], corte).teorico;
    const avg = Number(v.avg_cost ?? 0);
    if (Math.round(Number(v.stock ?? 0)) !== Math.round(teorico)) descuadradas.push({ id: v.id, teorico });
    out.push({
      variant_reference: v.variant_reference,
      name: v.name,
      stock: teorico,
      avg_cost: avg,
      valor: teorico * avg,
    });
  }
  // Self-healing best-effort: la columna cacheada la leen Importaciones y el
  // radar de pedido — si difiere del teórico se corrige acá mismo, sin
  // esperar a que alguien abra la pestaña Variantes. Si falla, el card igual
  // muestra el teórico correcto.
  if (descuadradas.length) {
    try {
      for (const d of descuadradas) {
        await db.from('inventory_variants').update({ stock: d.teorico }).eq('id', d.id);
      }
    } catch { /* no bloquear la lectura por un fallo de escritura */ }
  }
  return out;
}

/** Revierte la entrada de un pedido (estado corregido de 'entregado' a otro):
 *  borra sus filas y recalcula el cache de las variantes tocadas con LA fórmula. */
export async function reverseVariantImportEntrada(importId: string): Promise<void> {
  const { data, error } = await db
    .from('inventory_variant_movements')
    .select('id, variant_id')
    .eq('source_type', 'import')
    .eq('source_id', importId);
  if (error) throw error;
  const rows = (data ?? []) as { id: string; variant_id: string }[];
  if (!rows.length) return;
  await db.from('inventory_variant_movements').delete().in('id', rows.map((r) => r.id));
  await syncVariantStockToLedger({ onlyIds: [...new Set(rows.map((r) => r.variant_id))] });
}
