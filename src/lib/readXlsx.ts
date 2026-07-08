/**
 * Lectura de archivos Excel (.xlsx/.xls) en el navegador para los importadores
 * de la app (packing list / proforma en la pestaña Costeo de Importaciones).
 *
 * SheetJS se carga con import() dinámico: el bundle principal no crece —
 * el chunk (~140 KB gzip) se baja solo la primera vez que alguien suelta un
 * Excel en el dropzone.
 *
 * Devuelve TODAS las hojas como matrices de strings (misma forma que produce
 * parseDelimited para CSV/pegado), así el flujo de mapeo de columnas
 * downstream es idéntico sin importar de dónde vinieron las filas.
 */

export interface XlsxSheet {
  name: string;
  rows: string[][];
}

export async function readXlsxFile(file: File): Promise<XlsxSheet[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
    const rows = raw
      .map((r) => r.map((c) => (c == null ? '' : String(c).trim())))
      // Hojas de cálculo reales traen colas de filas vacías (formato fantasma).
      .filter((r) => r.some((c) => c !== ''));
    return { name, rows };
  }).filter((s) => s.rows.length > 0);
}

export function isExcelFile(file: File): boolean {
  return /\.(xlsx|xls)$/i.test(file.name);
}
