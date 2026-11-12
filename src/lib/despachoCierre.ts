import { supabase } from '@/integrations/supabase/client';
import { resyncRemisionInventory } from '@/lib/remisionInventory';
import {
  makeCanon, buildCargueLines, resumenCargue, ajustarItemsALoCargado, aplicarAjuste, notaCargue,
  type RemisionItemLite, type ResumenCargue,
} from '@/lib/despachoCargue';

// Cierre del cargue: deja la remisión "despachado" con quién, cuándo y cuántas
// unidades se verificaron. Si lo cargado no cuadra y la bodega eligió ajustar,
// primero lleva los ítems a lo cargado y recalcula el inventario con la MISMA
// función que usa Editar remisión (resyncRemisionInventory). El orden importa:
// ajustar → recuadrar → marcar despachado. Si algo falla a mitad, la remisión
// sigue "pendiente" y reintentar es seguro (el ajuste es idempotente).

export type ItemCierre = RemisionItemLite & { unit_cost: number | null };

export interface RemisionCierre {
  id: string;
  number: string;
  date: string;
  beneficiary: string | null;
  status: string;
  notes: string | null;
  user_id: string | null;
  created_at: string | null;
  remision_type: string;
  remision_items: ItemCierre[];
}

/** La remisión cambió por fuera del cargue (la cerró otro, la cancelaron…). */
export class CierreConflicto extends Error {}

export interface CierreResultado {
  number: string;
  date: string;
  beneficiary: string;
  items: { reference: string; product_name: string; units: number }[];
  resumen: ResumenCargue;
  ajustada: boolean;
  /** false = la remisión quedó bien pero el inventario no se pudo recuadrar. */
  inventarioOk: boolean;
}

export interface PlanCierre {
  resumen: ResumenCargue;
  ajustada: boolean;
  items: ItemCierre[];
  ajuste: ReturnType<typeof ajustarItemsALoCargado> | null;
}

/** Qué haría el cierre, sin escribir nada (también lo usa el modo práctica). */
export function planearCierre(
  items: ItemCierre[],
  cargado: Record<string, number>,
  aliases: Record<string, string>,
  ajustar: boolean,
): PlanCierre {
  const canon = makeCanon(aliases);
  const resumen = resumenCargue(buildCargueLines(items, canon), cargado);
  if (resumen.cuadra || !ajustar) return { resumen, ajustada: false, items, ajuste: null };
  const ajuste = ajustarItemsALoCargado(items, canon, cargado);
  return { resumen, ajustada: true, items: aplicarAjuste(items, ajuste), ajuste };
}

export function itemsParaImprimir(items: ItemCierre[]) {
  return items
    .filter((i) => (Number(i.units) || 0) > 0)
    .map((i) => ({ reference: i.reference, product_name: i.product_name || i.reference, units: Number(i.units) || 0 }));
}

export async function cerrarDespacho(input: {
  remisionId: string;
  cargado: Record<string, number>;
  aliases: Record<string, string>;
  ajustar: boolean;
  userId: string;
  operador: string;
  /** Texto que se suma a la nota (paquetes, fotos, vehículo…). */
  notaExtra?: string;
}): Promise<CierreResultado> {
  const { remisionId, cargado, aliases, ajustar, userId, operador, notaExtra } = input;

  // Siempre contra la remisión FRESCA: la oficina pudo editarla durante el cargue.
  const { data, error } = await (supabase.from('remisiones') as any)
    .select('id, number, date, beneficiary, status, notes, user_id, created_at, remision_type, remision_items(id, reference, product_name, units, unit_cost)')
    .eq('id', remisionId)
    .maybeSingle();
  if (error) throw error;
  const rem = data as RemisionCierre | null;
  if (!rem) throw new CierreConflicto('Esta remisión ya no existe.');
  if (rem.status !== 'pendiente') {
    throw new CierreConflicto(`Esta remisión ya está "${rem.status}": la cerró otra persona o la cambiaron en la oficina.`);
  }

  const plan = planearCierre(rem.remision_items || [], cargado, aliases, ajustar);
  if (plan.resumen.totalCargado <= 0) throw new Error('Todavía no se ha cargado nada de este pedido.');

  let inventarioOk = true;
  if (plan.ajuste) {
    if (plan.ajuste.deletes.length > 0) {
      const { error: delErr } = await supabase.from('remision_items').delete().in('id', plan.ajuste.deletes);
      if (delErr) throw delErr;
    }
    for (const u of plan.ajuste.updates) {
      // total_cost lo recalcula el trigger remision_items_set_total_cost.
      const { error: upErr } = await supabase.from('remision_items').update({ units: u.units }).eq('id', u.id);
      if (upErr) throw upErr;
    }
    try {
      await resyncRemisionInventory({
        remision: { id: rem.id, user_id: rem.user_id, remision_type: rem.remision_type, created_at: rem.created_at },
        items: plan.items.map((i) => ({
          reference: i.reference,
          product_name: i.product_name || i.reference,
          units: Number(i.units) || 0,
          unit_cost: Number(i.unit_cost) || 0,
        })),
        status: 'despachado',
        movementDate: rem.date,
        userId,
      });
    } catch (e) {
      // Mismo criterio que Editar remisión: la remisión queda bien y el cuadre
      // automático de Inventario → Por variante lo corrige al cargar.
      console.warn('[despacho] remisión ajustada pero el inventario no se re-sincronizó:', e);
      inventarioOk = false;
    }
  }

  const nota = [notaCargue(plan.resumen, { operador, cuando: new Date(), ajustada: plan.ajustada }), notaExtra?.trim()]
    .filter(Boolean).join(' ');
  const notes = [rem.notes?.trim(), nota].filter(Boolean).join('\n');
  const { data: upd, error: updErr } = await (supabase.from('remisiones') as any)
    .update({
      status: 'despachado',
      verified_at: new Date().toISOString(),
      verified_by: userId,
      verified_units: plan.resumen.totalCargado,
      notes,
    })
    .eq('id', rem.id)
    .eq('status', 'pendiente')
    .select('id');
  if (updErr) throw updErr;
  if (!upd || (upd as unknown[]).length === 0) {
    throw new CierreConflicto('Otra persona cerró esta remisión al mismo tiempo.');
  }

  return {
    number: rem.number,
    date: rem.date,
    beneficiary: rem.beneficiary ?? '',
    items: itemsParaImprimir(plan.items),
    resumen: plan.resumen,
    ajustada: plan.ajustada,
    inventarioOk,
  };
}
