import jsPDF from 'jspdf';
import { addAluminiaFooter } from './pdfBranding';
import { formatCurrency } from './formatters';
import type { YearClosing } from '@/hooks/useYearClosings';

interface CompanyInfo {
  company_name?: string | null;
  company_nit?: string | null;
  company_city?: string | null;
}

const BRAND: [number, number, number] = [54, 105, 78];
const INK: [number, number, number] = [29, 29, 31];
const MUTED: [number, number, number] = [110, 110, 115];
const PANEL: [number, number, number] = [245, 246, 247];

const RUBRO_LABEL: Record<string, string> = {
  caja_bancos: 'Caja y bancos',
  cuentas_por_cobrar: 'Cuentas por cobrar',
  inventario: 'Inventario',
  activos_fijos: 'Activos fijos',
  anticipos_a_proveedores: 'Anticipos a proveedores',
  iva_a_favor: 'IVA a favor',
  cuentas_por_pagar: 'Cuentas por pagar',
  anticipos_de_clientes: 'Anticipos de clientes',
  deuda_financiera: 'Deuda financiera',
  prestaciones_por_pagar: 'Prestaciones por pagar',
};
const RUBRO_ORDER = Object.keys(RUBRO_LABEL);

/** PDF firmable del cierre de año: reconciliación app (sugerido) vs contador (real). */
export function generateYearClosingPdf(closing: YearClosing, company: CompanyInfo): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 16;
  let y = margin;

  // Header
  doc.setFillColor(...BRAND);
  doc.roundedRect(margin, y, 8, 8, 1.2, 1.2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('A', margin + 4, y + 5.5, { align: 'center' });
  doc.setTextColor(...INK);
  doc.setFontSize(14);
  doc.text(`Cierre de año ${closing.fiscal_year}`, margin + 12, y + 5.5);
  y += 14;

  // Empresa
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(company.company_name || 'Mi empresa', margin, y);
  y += 4.5;
  const meta: string[] = [];
  if (company.company_nit) meta.push(`NIT ${company.company_nit}`);
  if (company.company_city) meta.push(company.company_city);
  if (meta.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(meta.join(' · '), margin, y);
    y += 4;
  }
  y += 4;

  // Patrimonio: sugerido vs real vs diferencia (3 cuadros)
  const boxW = (pageW - 2 * margin - 6) / 3;
  const boxH = 18;
  const drawBox = (x: number, label: string, value: string, color: [number, number, number]) => {
    doc.setDrawColor(220, 222, 224);
    doc.roundedRect(x, y, boxW, boxH, 1.2, 1.2, 'S');
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(label.toUpperCase(), x + 3, y + 5);
    doc.setTextColor(...color);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(value, x + 3, y + 13);
  };
  const diffColor: [number, number, number] =
    Math.abs(closing.total_diferencia) < 1 ? BRAND : closing.total_diferencia > 0 ? [180, 130, 0] : [180, 60, 60];
  drawBox(margin, 'Patrimonio app', formatCurrency(closing.total_sugerido), INK);
  drawBox(margin + boxW + 3, 'Patrimonio contador', formatCurrency(closing.total_real), INK);
  drawBox(margin + (boxW + 3) * 2, 'Diferencia', formatCurrency(closing.total_diferencia), diffColor);
  y += boxH + 8;

  // Tabla por rubro
  const colReal = pageW - margin - 2;
  const colDif = colReal - 38;
  const colSug = colDif - 38;
  doc.setFillColor(...PANEL);
  doc.rect(margin, y, pageW - 2 * margin, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text('Rubro', margin + 2, y + 4);
  doc.text('Sugerido (app)', colSug, y + 4, { align: 'right' });
  doc.text('Real (contador)', colReal, y + 4, { align: 'right' });
  doc.text('Diferencia', colDif, y + 4, { align: 'right' });
  y += 6;

  const totalLines = closing.lines.filter((l) => !l.responsible_id && l.responsible_name == null);
  const byRubroTotal = new Map(totalLines.map((l) => [l.rubro, l]));
  // Fallback: si no hay líneas "total" guardadas, agregamos por rubro.
  const aggregate = (rubro: string) => {
    const ls = closing.lines.filter((l) => l.rubro === rubro);
    return {
      suggested_amount: ls.reduce((s, l) => s + l.suggested_amount, 0),
      real_amount: ls.reduce((s, l) => s + l.real_amount, 0),
      difference: ls.reduce((s, l) => s + l.difference, 0),
    };
  };

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  for (const rubro of RUBRO_ORDER) {
    const has = closing.lines.some((l) => l.rubro === rubro);
    if (!has) continue;
    if (y > 250) { addAluminiaFooter(doc, { addToAllPages: false }); doc.addPage(); y = margin; }
    const row = byRubroTotal.get(rubro) ?? aggregate(rubro);
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.text(RUBRO_LABEL[rubro] ?? rubro, margin + 2, y + 3.5);
    doc.setFont('helvetica', 'normal');
    doc.text(formatCurrency(row.suggested_amount), colSug, y + 3.5, { align: 'right' });
    doc.text(formatCurrency(row.real_amount), colReal, y + 3.5, { align: 'right' });
    const rowDiffColor: [number, number, number] = Math.abs(row.difference) < 1 ? MUTED : row.difference > 0 ? [180, 130, 0] : [180, 60, 60];
    doc.setTextColor(rowDiffColor[0], rowDiffColor[1], rowDiffColor[2]);
    doc.text(formatCurrency(row.difference), colDif, y + 3.5, { align: 'right' });
    y += 5;
    // Terceros del rubro
    const terceros = closing.lines.filter((l) => l.rubro === rubro && (l.responsible_id || l.responsible_name));
    for (const t of terceros) {
      if (y > 255) { addAluminiaFooter(doc, { addToAllPages: false }); doc.addPage(); y = margin; }
      doc.setTextColor(...MUTED);
      doc.setFontSize(6.8);
      doc.text(`   ${t.responsible_name ?? '(sin tercero)'}`, margin + 2, y + 3);
      doc.text(formatCurrency(t.suggested_amount), colSug, y + 3, { align: 'right' });
      doc.text(formatCurrency(t.real_amount), colReal, y + 3, { align: 'right' });
      doc.text(formatCurrency(t.difference), colDif, y + 3, { align: 'right' });
      doc.setFontSize(7.5);
      y += 4;
    }
    doc.setDrawColor(235, 236, 238);
    doc.line(margin, y, pageW - margin, y);
    y += 1;
  }

  // Notas
  if (closing.notes && closing.notes.trim()) {
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text('Notas:', margin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    const noteLines = doc.splitTextToSize(closing.notes, pageW - 2 * margin);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 4;
  }

  // Firma
  y += 12;
  if (y > 240) { doc.addPage(); y = margin; }
  doc.setDrawColor(180, 180, 180);
  doc.line(margin, y + 14, margin + 70, y + 14);
  doc.setTextColor(...MUTED);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Firma del contador / responsable', margin, y + 18);

  addAluminiaFooter(doc, { addToAllPages: true });
  return doc;
}
