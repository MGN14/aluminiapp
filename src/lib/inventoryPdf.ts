import jsPDF from 'jspdf';
import { addAluminiaFooter } from './pdfBranding';
import { formatCurrency } from './formatters';
import type { ProductWithMetrics } from '@/hooks/useInventoryData';

interface CompanyInfo {
  company_name?: string | null;
  company_nit?: string | null;
  company_city?: string | null;
}

const BRAND: [number, number, number] = [54, 105, 78];
const INK: [number, number, number] = [29, 29, 31];
const MUTED: [number, number, number] = [110, 110, 115];
const PANEL: [number, number, number] = [245, 246, 247];
const ROJO: [number, number, number] = [170, 60, 60];

export type InventoryPdfFiltro = 'todos' | 'con_diferencia';

interface Options {
  /** 'con_diferencia' deja solo las referencias descuadradas — que es para lo
   *  que se imprime esto la mayoría de las veces. */
  filtro?: InventoryPdfFiltro;
  /** Etiqueta del origen del stock teórico ('Siigo' o 'Teórico'). */
  etiquetaTeorico?: string;
}

const fmtNum = (n: number | null | undefined, dec = 0) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : new Intl.NumberFormat('es-CO', { maximumFractionDigits: dec }).format(n);

/** Recorta a una línea marcando con "…" que el texto sigue. */
function clip(doc: jsPDF, text: string | null | undefined, widthMm: number): string {
  const raw = (text || '').trim();
  if (!raw) return '—';
  const lines = doc.splitTextToSize(raw, widthMm) as string[];
  if (lines.length <= 1) return lines[0] ?? raw;
  return `${doc.splitTextToSize(raw, widthMm - 2)[0]}…`;
}

/**
 * PDF del inventario, pensado para revisar DIFERENCIAS con el papel en la
 * mano en bodega.
 *
 * Horizontal a propósito: en vertical las 8 columnas quedaban de 20mm y los
 * nombres de producto se cortaban a la mitad. Acostado entran holgadas y se
 * puede escribir al lado.
 */
export function generateInventoryPdf(
  productos: ProductWithMetrics[],
  company: CompanyInfo,
  opts: Options = {},
): jsPDF {
  const filtro = opts.filtro ?? 'todos';
  const etiquetaTeorico = opts.etiquetaTeorico ?? 'Teórico';

  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  let y = margin;

  const filas = filtro === 'con_diferencia'
    ? productos.filter((p) => Math.abs(p.difference) >= 0.01)
    : productos;

  // ── Header
  doc.setFillColor(BRAND[0], BRAND[1], BRAND[2]);
  doc.roundedRect(margin, y, 8, 8, 1.2, 1.2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('A', margin + 4, y + 5.5, { align: 'center' });

  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(
    filtro === 'con_diferencia' ? 'Inventario — diferencias' : 'Inventario',
    margin + 12,
    y + 5.5,
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(
    `Generado el ${new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })}`,
    pageW - margin,
    y + 5.5,
    { align: 'right' },
  );
  y += 13;

  // ── Empresa
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(company.company_name || 'Mi empresa', margin, y);
  const meta: string[] = [];
  if (company.company_nit) meta.push(`NIT ${company.company_nit}`);
  if (company.company_city) meta.push(company.company_city);
  if (meta.length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(meta.join(' · '), margin + 60, y);
  }
  y += 7;

  // ── Resumen. Los totales se calculan sobre lo que SE IMPRIME: un PDF que
  // dice "12 referencias" y totaliza 161 es peor que no tener totales.
  const valorTotal = filas.reduce((s, p) => s + (p.stock_physical ?? p.teorico) * p.cost_per_unit, 0);
  const conDif = filas.filter((p) => Math.abs(p.difference) >= 0.01);
  const valorDif = conDif.reduce((s, p) => s + p.difference * p.cost_per_unit, 0);
  const sinConteo = filas.filter((p) => p.stock_physical == null).length;

  doc.setFillColor(PANEL[0], PANEL[1], PANEL[2]);
  doc.roundedRect(margin, y, pageW - 2 * margin, 13, 1.5, 1.5, 'F');
  const cajaW = (pageW - 2 * margin) / 4;
  const kpi = (i: number, label: string, valor: string, color: [number, number, number]) => {
    const x = margin + 4 + cajaW * i;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(label.toUpperCase(), x, y + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(valor, x, y + 10);
  };
  kpi(0, 'Referencias', String(filas.length), INK);
  kpi(1, 'Valor del inventario', formatCurrency(valorTotal), INK);
  kpi(2, 'Con diferencia', `${conDif.length}`, conDif.length > 0 ? ROJO : BRAND);
  kpi(3, 'Valor de la diferencia', formatCurrency(valorDif), Math.abs(valorDif) < 1 ? BRAND : ROJO);
  y += 17;

  if (sinConteo > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(
      `${sinConteo} referencia(s) nunca se contaron físicamente: su diferencia no se puede calcular y no suman al descuadre.`,
      margin,
      y,
    );
    y += 5;
  }

  // ── Columnas
  const cRef = margin + 2;
  const cNombre = margin + 30;
  const cSistema = margin + 108;
  const cTeorico = margin + 150;
  const cFisico = margin + 172;
  const cDif = margin + 196;
  const cCosto = margin + 226;
  const cValor = pageW - margin - 2;

  const drawHeader = () => {
    doc.setFillColor(PANEL[0], PANEL[1], PANEL[2]);
    doc.rect(margin, y, pageW - 2 * margin, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text('Referencia', cRef, y + 4);
    doc.text('Producto', cNombre, y + 4);
    doc.text('Sistema', cSistema, y + 4);
    doc.text(etiquetaTeorico, cTeorico, y + 4, { align: 'right' });
    doc.text('Físico', cFisico, y + 4, { align: 'right' });
    doc.text('Diferencia', cDif, y + 4, { align: 'right' });
    doc.text('Costo unit.', cCosto, y + 4, { align: 'right' });
    doc.text('Valor', cValor, y + 4, { align: 'right' });
    y += 6;
  };
  drawHeader();

  for (const p of filas) {
    if (y > pageH - 20) {
      addAluminiaFooter(doc, { addToAllPages: false });
      doc.addPage();
      y = margin;
      drawHeader();
    }

    const hayDif = Math.abs(p.difference) >= 0.01;
    if (hayDif) {
      doc.setFillColor(253, 243, 243);
      doc.rect(margin, y - 0.5, pageW - 2 * margin, 5, 'F');
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(clip(doc, p.reference, 27), cRef, y + 3);
    doc.text(clip(doc, p.name, 76), cNombre, y + 3);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(clip(doc, p.system ?? '—', 40), cSistema, y + 3);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(fmtNum(p.teorico), cTeorico, y + 3, { align: 'right' });
    // Nunca contado ≠ contado en cero: se distingue con "—".
    doc.text(p.stock_physical == null ? '—' : fmtNum(p.stock_physical), cFisico, y + 3, { align: 'right' });

    if (p.stock_physical == null) {
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text('sin contar', cDif, y + 3, { align: 'right' });
    } else {
      if (hayDif) doc.setTextColor(ROJO[0], ROJO[1], ROJO[2]);
      else doc.setTextColor(BRAND[0], BRAND[1], BRAND[2]);
      doc.setFont('helvetica', hayDif ? 'bold' : 'normal');
      doc.text(`${p.difference > 0 ? '+' : ''}${fmtNum(p.difference)}`, cDif, y + 3, { align: 'right' });
    }

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(formatCurrency(p.cost_per_unit), cCosto, y + 3, { align: 'right' });
    doc.text(
      formatCurrency((p.stock_physical ?? p.teorico) * p.cost_per_unit),
      cValor,
      y + 3,
      { align: 'right' },
    );

    y += 4.5;
    doc.setDrawColor(235, 236, 238);
    doc.line(margin, y, pageW - margin, y);
    y += 0.5;
  }

  // ── Total
  y += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(`Total (${filas.length} referencias)`, margin, y);
  doc.text(formatCurrency(valorTotal), cValor, y, { align: 'right' });

  addAluminiaFooter(doc, { addToAllPages: true });
  return doc;
}
