/**
 * MOTOR DE VENTAS, Fases 4+5 (Nico, 2026-08-07): "¿de quién es este pago?"
 * cuando NINGUNA factura calza sola.
 *
 * El motor por factura (suggest_invoice_matches_for_tx) pre-filtra por monto
 * ±10% — un anticipo, un pago parcial o un cliente que junta dos facturas en
 * una sola transferencia quedan sin sugerencia. Esta capa puntúa CLIENTES
 * con todo lo que la app sabe:
 *
 *   · alias/nombre en la descripción (los aprendidos en Fase 3 incluidos)
 *   · cartera: cuánto debe, y si el pago cubre EXACTO su saldo
 *   · combinaciones de facturas (Fase 5): FIFO viejas-primero, pares y
 *     tríos que suman el monto — "FV-10 + FV-12 = $5.000.000"
 *   · pago parcial: el monto cabe en su factura abierta más vieja
 *   · montos habituales: cuánto suele pagar este cliente por transferencia
 *   · TIEMPOS de pago: a cuántos días paga históricamente; si este pago cae
 *     en la ventana esperada de una factura abierta, suma
 *
 * Probabilidad, NUNCA regla: propone con evidencia y el humano decide.
 * Lógica pura y testeable; el fetch va aparte.
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeForMatch, normalizeCompanyName } from '@/lib/stringUtils';

const db = supabase as never as { from: (t: string) => any };

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface FacturaAbierta {
  id: string;
  invoice_number: string;
  responsible_id: string | null;
  issue_date: string;
  balance_pending: number;
}

export interface EmisionFactura {
  id: string;
  issue_date: string;
  responsible_id: string | null;
}

/**
 * SOLO DATOS PLANOS: esto se persiste como cache de react-query (JSON), y un
 * Map no sobrevive la rehidratación — al recargar quedaba "t.get is not a
 * function" (reporte de Nico 2026-08-08, segunda vez que pasa). Los índices
 * se arman en memoria, nunca se guardan.
 */
export interface DatosVentasProbable {
  clientes: { id: string; name: string }[];
  aliases: { responsible_id: string; alias: string }[];
  facturasAbiertas: FacturaAbierta[];
  /** Historia de cobros: pagos con cliente conocido (para montos habituales)
   *  y pagos vinculados a factura (para tiempos de pago). */
  cobros: {
    responsible_id: string | null;
    invoice_id: string | null;
    amount: number;
    date: string;
  }[];
  /** Emisión de facturas históricas (para calcular días de pago). Array
   *  plano — el Map se arma al usarlo. */
  emisiones: EmisionFactura[];
}

export interface ComboFacturas {
  facturas: FacturaAbierta[];
  total: number;
}

export interface SugerenciaCliente {
  responsibleId: string;
  nombre: string;
  confianza: number;          // 0-95: esto jamás se auto-aplica
  señales: string[];          // evidencia legible, la ve el usuario
  deuda: number;
  /** Fase 5: combinación de facturas que suma el monto (±1%). */
  combo: ComboFacturas | null;
  /** Fase 5: si no hay combo, posible abono a esta factura (la más vieja). */
  abonoA: FacturaAbierta | null;
}

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

// ── Fase 5: combinaciones de facturas ───────────────────────────────────────

const cerca = (a: number, b: number, tolPct = 0.01) => Math.abs(a - b) <= Math.max(1, b * tolPct);

/**
 * ¿Alguna combinación de facturas abiertas del cliente suma el monto?
 * Orden de búsqueda: prefijos FIFO (viejas primero — como paga la gente),
 * después pares y tríos. Con ±1% de tolerancia.
 */
export function buscarCombo(facturas: FacturaAbierta[], monto: number): ComboFacturas | null {
  if (monto <= 0 || facturas.length < 2) return null;
  const fifo = [...facturas].sort((a, b) => a.issue_date.localeCompare(b.issue_date));

  // Prefijos FIFO: FV1, FV1+FV2, FV1+FV2+FV3…
  let suma = 0;
  const prefijo: FacturaAbierta[] = [];
  for (const f of fifo) {
    suma += f.balance_pending;
    prefijo.push(f);
    if (prefijo.length >= 2 && cerca(suma, monto)) return { facturas: [...prefijo], total: suma };
    if (suma > monto * 1.02) break;
  }

  const n = Math.min(fifo.length, 12); // pares/tríos sobre las 12 más viejas
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s2 = fifo[i].balance_pending + fifo[j].balance_pending;
      if (cerca(s2, monto)) return { facturas: [fifo[i], fifo[j]], total: s2 };
      for (let k = j + 1; k < n; k++) {
        const s3 = s2 + fifo[k].balance_pending;
        if (cerca(s3, monto)) return { facturas: [fifo[i], fifo[j], fifo[k]], total: s3 };
      }
    }
  }
  return null;
}

// ── Tiempos de pago ─────────────────────────────────────────────────────────

const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

/** Mediana de días factura→pago del cliente (necesita ≥3 pagos vinculados). */
export function diasPagoTipicos(
  cobros: DatosVentasProbable['cobros'],
  emisiones: EmisionFactura[] | Map<string, { issue_date: string; responsible_id: string | null }>,
  responsibleId: string,
): number | null {
  const porId = emisiones instanceof Map
    ? emisiones
    : new Map(emisiones.map((e) => [e.id, { issue_date: e.issue_date, responsible_id: e.responsible_id }]));
  const dias: number[] = [];
  for (const c of cobros) {
    if (!c.invoice_id) continue;
    const inv = porId.get(c.invoice_id);
    if (!inv) continue;
    const respDelPago = c.responsible_id ?? inv.responsible_id;
    if (respDelPago !== responsibleId) continue;
    const d = diasEntre(c.date, inv.issue_date);
    if (d >= 0 && d <= 365) dias.push(d);
  }
  if (dias.length < 3) return null;
  dias.sort((a, b) => a - b);
  return dias[Math.floor(dias.length / 2)];
}

// ── Fase 4: puntuar clientes ────────────────────────────────────────────────

export interface PagoAPuntuar {
  amount: number;   // positivo
  date: string;
  description: string | null;
}

/**
 * El mejor candidato a dueño del pago, o null si nadie llega al piso (45).
 * Tope 95: esto es una sugerencia — jamás se aplica sola.
 */
export function sugerirClienteParaPago(
  datos: DatosVentasProbable,
  pago: PagoAPuntuar,
): SugerenciaCliente | null {
  const monto = Math.abs(pago.amount);
  if (monto <= 0) return null;
  const descNorm = normalizeCompanyName(pago.description ?? '');
  if (!datos.facturasAbiertas.length && !descNorm) return null;

  // Índices en memoria (nunca se guardan: ver DatosVentasProbable).
  const nombrePorId = new Map(datos.clientes.map((c) => [c.id, c.name]));
  const emisiones = datos.emisiones ?? [];
  const abiertasPorCliente = new Map<string, FacturaAbierta[]>();
  for (const f of datos.facturasAbiertas) {
    if (!f.responsible_id || f.balance_pending <= 0) continue;
    const arr = abiertasPorCliente.get(f.responsible_id) ?? [];
    arr.push(f);
    abiertasPorCliente.set(f.responsible_id, arr);
  }
  const aliasPorCliente = new Map<string, string[]>();
  for (const a of datos.aliases) {
    const arr = aliasPorCliente.get(a.responsible_id) ?? [];
    arr.push(a.alias);
    aliasPorCliente.set(a.responsible_id, arr);
  }

  let mejor: SugerenciaCliente | null = null;

  for (const [clienteId, abiertas] of abiertasPorCliente) {
    const nombre = nombrePorId.get(clienteId);
    if (!nombre) continue;
    let score = 0;
    const señales: string[] = [];
    const deuda = abiertas.reduce((s, f) => s + f.balance_pending, 0);

    // 1. Nombre o alias en la descripción (incluye los aprendidos en Fase 3)
    const identificadores = [nombre, ...(aliasPorCliente.get(clienteId) ?? [])]
      .map((s) => normalizeCompanyName(s))
      .filter((s) => s.length >= 4);
    if (descNorm && identificadores.some((idn) => descNorm.includes(idn))) {
      score += 35;
      señales.push('su nombre está en la descripción');
    }

    // 2. Cartera
    if (cerca(monto, deuda, 0.02)) {
      score += 30;
      señales.push(`paga EXACTO su saldo total (${fmtCOP(deuda)})`);
    } else if (deuda >= monto) {
      score += 10;
      señales.push(`debe ${fmtCOP(deuda)} en ${abiertas.length} factura(s)`);
    }

    // 3. Fase 5: combinación de facturas
    const combo = buscarCombo(abiertas, monto);
    if (combo) {
      score += 40;
      señales.push(`${combo.facturas.map((f) => f.invoice_number).join(' + ')} suman ${fmtCOP(combo.total)}`);
    }

    // 4. Monto habitual del cliente
    const montosPrevios = datos.cobros.filter((c) => c.responsible_id === clienteId);
    if (montosPrevios.some((c) => cerca(Math.abs(c.amount), monto, 0.01))) {
      score += 20;
      señales.push('monto que ya le has cobrado antes');
    }

    // 5. Tiempos de pago: ¿alguna factura abierta "vence" justo ahora según
    //    su ritmo histórico?
    const diasTipicos = diasPagoTipicos(datos.cobros, emisiones, clienteId);
    if (diasTipicos != null) {
      const enVentana = abiertas.find((f) => {
        const esperado = diasEntre(pago.date, f.issue_date);
        return Math.abs(esperado - diasTipicos) <= 7;
      });
      if (enVentana) {
        score += 15;
        señales.push(`suele pagar a ~${diasTipicos} días y ${enVentana.invoice_number} está en esa ventana`);
      }
    }

    if (score < 45) continue; // piso: sin evidencia suficiente no se molesta

    const fifo = [...abiertas].sort((a, b) => a.issue_date.localeCompare(b.issue_date));
    const abonoA = !combo && monto < deuda ? fifo[0] : null;
    if (abonoA) señales.push(`posible abono a ${abonoA.invoice_number}`);

    const cand: SugerenciaCliente = {
      responsibleId: clienteId,
      nombre,
      confianza: Math.min(95, score),
      señales,
      deuda,
      combo,
      abonoA,
    };
    if (!mejor || cand.confianza > mejor.confianza) mejor = cand;
  }
  return mejor;
}

// ── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchDatosVentasProbable(): Promise<DatosVentasProbable> {
  const [clientesRes, aliasRes, abiertasRes, cobrosRes, emisionRes] = await Promise.all([
    db.from('responsibles').select('id, name').eq('active', true),
    db.from('responsible_aliases').select('responsible_id, alias'),
    db.from('invoices')
      .select('id, invoice_number, responsible_id, issue_date, balance_pending')
      .eq('type', 'venta')
      .gt('balance_pending', 0)
      // Solo excluir anulación TOTAL: una NC parcial deja saldo vivo y esa
      // factura SÍ es candidata de cobro (antes .is('voided_at', null) las
      // botaba también).
      .or('void_type.is.null,void_type.eq.partial'),
    db.from('transactions')
      .select('responsible_id, invoice_id, amount, date')
      .is('deleted_at', null)
      .gt('amount', 0)
      .or('responsible_id.not.is.null,invoice_id.not.is.null')
      .order('date', { ascending: false })
      .limit(4000),
    db.from('invoices')
      .select('id, issue_date, responsible_id')
      .eq('type', 'venta')
      // Una factura anulada nunca se pagó: no aporta al hábito de pago.
      .or('void_type.is.null,void_type.eq.partial')
      .order('issue_date', { ascending: false })
      .limit(4000),
  ]);

  return {
    clientes: (clientesRes.data ?? []) as { id: string; name: string }[],
    aliases: (aliasRes.data ?? []) as { responsible_id: string; alias: string }[],
    facturasAbiertas: ((abiertasRes.data ?? []) as FacturaAbierta[]).map((f) => ({
      ...f, balance_pending: Number(f.balance_pending ?? 0),
    })),
    cobros: ((cobrosRes.data ?? []) as DatosVentasProbable['cobros']).map((c) => ({
      ...c, amount: Number(c.amount ?? 0),
    })),
    emisiones: (emisionRes.data ?? []) as EmisionFactura[],
  };
}
