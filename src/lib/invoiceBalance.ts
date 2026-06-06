// ============================================================================
// Fórmula ÚNICA de retenciones de una factura.
// ============================================================================
// Antes esta lógica estaba COPIADA en tres lugares y divergía al tocar una sola:
//   - clientReceivables.ts  (cobranza / "lo que me deben")
//   - InvoiceSelector.tsx   (conciliación bancaria)
//   - AdvancesReport.tsx     (anticipos)
// Por eso "se rompían" entre sí. Ahora viven acá, una sola vez, para que los
// tres saldos cuadren SIEMPRE.
//
// Comportamiento (idéntico al que ya tenían — refactor sin cambio funcional):
//   VENTA:  retefuente_cliente (SOLO si está explícito: monto cargado o tasa
//           a mano — sin fallback automático de 2.5%) + reteica + autoretefuente.
//   COMPRA: solo reteica + autoretefuente. En `invoices` NO existe el retefuente
//           del proveedor (pedir `retefuente_amount` rompe el query: esa columna
//           vive en transactions).
//   Si la factura no trae `type` (cobranza y anticipos solo manejan ventas), se
//   asume 'venta' — exactamente como se calculaba antes en esos módulos.
//
// Las retenciones son plata que el cliente retuvo y pagó a DIAN/municipio: no
// vuelve al banco, así que se descuenta del saldo vivo de la factura.

export interface RetencionBreakdown {
  retefuente: number;
  reteica: number;
  autoretefuente: number;
  /** retefuente + reteica + autoretefuente */
  total: number;
}

/**
 * Calcula las retenciones de una factura. Acepta cualquier objeto con los
 * campos relevantes (los tres call sites usan shapes distintos), por eso el
 * parámetro es laxo y se lee defensivamente.
 */
export function invoiceRetenciones(inv: Record<string, unknown>): RetencionBreakdown {
  const reteica = Math.abs(Number(inv.reteica_amount ?? 0));
  const autoretefuente = Math.abs(Number(inv.autoretefuente_amount ?? 0));
  const tipo = (inv.type as string | null | undefined) ?? 'venta';

  let retefuente = 0;
  if (tipo === 'venta') {
    const savedRete = Number(inv.retefuente_cliente_amount ?? 0);
    const rawRate = inv.retefuente_cliente_rate as number | null | undefined;
    const hasExplicitRate = rawRate !== null && rawRate !== undefined;
    // Solo se resta retefuente cuando está EXPLÍCITO: un monto cargado
    // (típicamente de Siigo) o una tasa cargada a mano. Se quitó el fallback
    // automático del 2.5% que asumía que TODO cliente retiene — falso para
    // clientes que NO son agentes de retención (Aluminios y Amortiguadores La 11,
    // Cristian, etc.): les inventaba una retención fantasma y les bajaba el
    // saldo. Ahora funciona igual que reteica/autoretefuente: explícito o cero.
    if (savedRete > 0) {
      retefuente = savedRete;
    } else if (hasExplicitRate) {
      retefuente = Math.round(Number(inv.subtotal_base ?? 0) * Number(rawRate));
    }
  }

  return { retefuente, reteica, autoretefuente, total: retefuente + reteica + autoretefuente };
}
