/**
 * Export a Excel del CIERRE DE INVENTARIO (conteo físico vs teórico).
 *
 * Sirve para dos cosas:
 *   · el borrador — la lista de qué hay que ir a re-contar en bodega;
 *   · un cierre confirmado — el soporte del ajuste para el contador, con la
 *     plata que costó el faltante/sobrante.
 *
 * El costo unitario es el landed promedio de la variante (avg_cost), el mismo
 * que valoriza la pestaña "Por variante".
 */

import type { CountLine, CountSession } from '@/hooks/useInventoryCount';

export interface CountLineCalc {
  linea: CountLine;
  teorico: number;
  contado: number;
  diferencia: number;
  costo: number;
  valor: number;
  estado: 'Faltante' | 'Sobrante' | 'Cuadra';
  nueva: boolean;
}

/**
 * Deriva cada línea del conteo. Regla de Nico (2026-08-04): lo que no vino
 * en el archivo ya llega con contado 0 desde el borrador — acá no hay casos
 * especiales, la diferencia es contado − teórico y punto.
 */
export function calcularLineas(lineas: CountLine[]): CountLineCalc[] {
  return lineas.map((l) => {
    const teorico = Number(l.stock_teorico ?? 0);
    const contado = Number(l.stock_contado ?? 0);
    const diferencia = Math.round(contado - teorico);
    const costo = Number(l.costo_unitario ?? 0);
    return {
      linea: l,
      teorico,
      contado,
      diferencia,
      costo,
      valor: diferencia * costo,
      estado: diferencia < 0 ? 'Faltante' : diferencia > 0 ? 'Sobrante' : 'Cuadra',
      nueva: !!l.es_nueva,
    };
  });
}

export interface CountTotals {
  total: number;
  conDif: number;
  /** Cuántas REFERENCIAS faltan / sobran (distinto de las unidades). */
  lineasFaltan: number;
  lineasSobran: number;
  nuevas: number;
  /** Cuántas no vinieron en el archivo (informativo: cuentan como 0). */
  noVinieron: number;
  unidadesFaltan: number;
  unidadesSobran: number;
  valorFaltan: number;
  valorSobran: number;
  valorNeto: number;
}

export function totalizar(calc: CountLineCalc[]): CountTotals {
  const conDif = calc.filter((c) => c.diferencia !== 0);
  const faltan = conDif.filter((c) => c.diferencia < 0);
  const sobran = conDif.filter((c) => c.diferencia > 0);
  const suma = (arr: CountLineCalc[], f: (c: CountLineCalc) => number) => arr.reduce((s, c) => s + f(c), 0);
  return {
    total: calc.length,
    conDif: conDif.length,
    lineasFaltan: faltan.length,
    lineasSobran: sobran.length,
    nuevas: calc.filter((c) => c.nueva).length,
    noVinieron: calc.filter((c) => (c.linea.nota ?? '').includes('no vino en el archivo')).length,
    unidadesFaltan: suma(faltan, (c) => c.diferencia),
    unidadesSobran: suma(sobran, (c) => c.diferencia),
    valorFaltan: suma(faltan, (c) => c.valor),
    valorSobran: suma(sobran, (c) => c.valor),
    valorNeto: suma(conDif, (c) => c.valor),
  };
}

const fila = (c: CountLineCalc) => ({
  'Referencia': c.linea.variant_reference,
  'Descripción': c.linea.descripcion ?? '',
  'Estado': c.estado + (c.nueva ? ' (nueva)' : ''),
  'Debería haber': c.teorico,
  'Contado': c.contado,
  'Diferencia': c.diferencia,
  'Costo unitario': Math.round(c.costo),
  'Valor diferencia': Math.round(c.valor),
  'Nota': c.linea.nota ?? '',
});

const ANCHOS = [{ wch: 16 }, { wch: 38 }, { wch: 16 }, { wch: 14 }, { wch: 11 }, { wch: 12 }, { wch: 14 }, { wch: 17 }, { wch: 22 }];

/**
 * Arma y descarga el .xlsx: hoja "Diferencias" (lo accionable, ordenado por
 * impacto en plata), hoja "Detalle" (todas las referencias) y hoja "Resumen".
 */
export async function exportCountToExcel(
  session: Pick<CountSession, 'fecha_conteo' | 'estado'>,
  lineas: CountLine[],
): Promise<void> {
  const XLSX = await import('xlsx');
  const calc = calcularLineas(lineas);
  const t = totalizar(calc);

  const porImpacto = [...calc].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const soloDif = porImpacto.filter((c) => c.diferencia !== 0);

  const wb = XLSX.utils.book_new();

  const wsDif = XLSX.utils.json_to_sheet(soloDif.map(fila));
  wsDif['!cols'] = ANCHOS;
  XLSX.utils.book_append_sheet(wb, wsDif, 'Diferencias');

  const wsAll = XLSX.utils.json_to_sheet(
    [...calc].sort((a, b) => a.linea.variant_reference.localeCompare(b.linea.variant_reference)).map(fila),
  );
  wsAll['!cols'] = ANCHOS;
  XLSX.utils.book_append_sheet(wb, wsAll, 'Detalle');

  const wsRes = XLSX.utils.json_to_sheet([
    { Concepto: 'Fecha del conteo', Valor: session.fecha_conteo },
    { Concepto: 'Estado', Valor: session.estado === 'confirmado' ? 'Confirmado (aplicado)' : 'Borrador (sin aplicar)' },
    { Concepto: 'Referencias en el reporte', Valor: t.total },
    { Concepto: 'Referencias con diferencia', Valor: t.conDif },
    { Concepto: 'Referencias nuevas (no existían)', Valor: t.nuevas },
    { Concepto: 'No vinieron en el archivo (cuentan como 0)', Valor: t.noVinieron },
    { Concepto: 'Unidades faltantes', Valor: Math.abs(t.unidadesFaltan) },
    { Concepto: 'Unidades sobrantes', Valor: t.unidadesSobran },
    { Concepto: 'Valor faltante (COP)', Valor: Math.round(Math.abs(t.valorFaltan)) },
    { Concepto: 'Valor sobrante (COP)', Valor: Math.round(t.valorSobran) },
    { Concepto: 'Diferencia neta (COP)', Valor: Math.round(t.valorNeto) },
  ]);
  wsRes['!cols'] = [{ wch: 40 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsRes, 'Resumen');

  const prefijo = session.estado === 'confirmado' ? 'cierre-inventario' : 'conteo-inventario-borrador';
  XLSX.writeFile(wb, `${prefijo}-${session.fecha_conteo}.xlsx`);
}
