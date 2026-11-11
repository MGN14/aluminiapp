/**
 * Beneficiarios para un movimiento clasificado como VENTAS — pedido de Nico
 * (2026-11-11): "si en conciliación está clasificado como ventas, que solo
 * aparezcan clientes. No Tigo, no Yolanda. Con la excepción de que Nicolás
 * sí aparezca".
 *
 * El rol se DERIVA, nunca se digita (regla del módulo Terceros). Un tercero
 * entra a la lista de Ventas si:
 *   · es CLIENTE por evidencia comercial: tiene facturas de venta, remisiones
 *     de venta o cotizaciones — la misma regla que `derivarRoles`; o
 *   · ya fue beneficiario de un movimiento clasificado como Ventas (el
 *     historial de conciliación). Así entra Nicolás, que no tiene factura
 *     pero sí cobró una venta el 2026-05-22; y así quedan afuera Tigo (solo
 *     Servicios) y Yolanda (solo Nómina). Sin nombres quemados en el código:
 *     el día que a Yolanda se le cobre una venta, aparece sola.
 *
 * El beneficiario YA asignado a la fila se conserva siempre (lo que está
 * grabado no desaparece del selector), y la UI deja un escape "Ver todos los
 * terceros" para el caso raro: un proveedor que te compra por primera vez.
 *
 * Funciones puras → testeables sin base de datos.
 */

/** ¿La categoría es de ventas? Mismo criterio que usa la fila para
 *  autoasignar Ventas al aceptar una sugerencia de cliente. */
export function esCategoriaVentas(nombre: string | null | undefined): boolean {
  return (nombre ?? '').toLowerCase().includes('venta');
}

export interface EvidenciaClientes {
  facturasVenta: { responsible_id: string | null }[];
  remisionesVenta: { responsible_id: string | null }[];
  cotizaciones: { responsible_id: string | null }[];
}

/** Ids de terceros con evidencia comercial de cliente (misma regla que
 *  derivarRoles en terceroProfile). Array plano, ordenado: es dato de query. */
export function clienteIdsDesdeEvidencia(ev: EvidenciaClientes): string[] {
  return idsUnicos([...ev.facturasVenta, ...ev.remisionesVenta, ...ev.cotizaciones]);
}

/** Ids únicos y ordenados (array plano: es dato de query). */
export function idsUnicos(rows: { responsible_id: string | null }[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) if (r.responsible_id) ids.add(r.responsible_id);
  return [...ids].sort();
}

/**
 * Filtra la lista de beneficiarios para una fila clasificada como Ventas.
 * Devuelve los mismos objetos (no copia), en el mismo orden que entraron.
 */
export function filtrarBeneficiariosVentas<T extends { id: string }>(params: {
  responsibles: T[];
  clienteIds: Iterable<string>;
  usadosEnVentas: Iterable<string>;
  /** El beneficiario ya grabado en la fila: nunca se esconde. */
  seleccionadoId: string | null | undefined;
}): T[] {
  const ok = new Set<string>([...params.clienteIds, ...params.usadosEnVentas]);
  if (params.seleccionadoId) ok.add(params.seleccionadoId);
  return params.responsibles.filter((r) => ok.has(r.id));
}
