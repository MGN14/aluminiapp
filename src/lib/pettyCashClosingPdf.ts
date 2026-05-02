import jsPDF from 'jspdf';
import { addAluminiaFooter } from './pdfBranding';
import { parseLocalDate } from './dateUtils';
import { formatCurrency } from './formatters';
import type { PettyCashClosing } from '@/hooks/usePettyCashClosings';
import type { PettyCashRow } from '@/hooks/usePettyCashMovements';

interface CompanyInfo {
  company_name?: string | null;
  company_nit?: string | null;
  company_city?: string | null;
}

const BRAND: [number, number, number] = [54, 105, 78];
const INK: [number, number, number] = [29, 29, 31];
const MUTED: [number, number, number] = [110, 110, 115];
const PANEL: [number, number, number] = [245, 246, 247];

function fmtDate(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function fmtDateShort(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

/**
 * Genera un PDF firmable del cierre de caja menor.
 * Incluye: encabezado, datos de la empresa, período, resumen de saldos,
 * tabla de movimientos cerrados, espacio para firma, footer AluminIA.
 */
export function generatePettyCashClosingPdf(
  closing: PettyCashClosing,
  movements: PettyCashRow[],
  company: CompanyInfo,
): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 16;
  let y = margin;

  // ── Header con logo brand
  doc.setFillColor(BRAND[0], BRAND[1], BRAND[2]);
  doc.roundedRect(margin, y, 8, 8, 1.2, 1.2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('A', margin + 4, y + 5.5, { align: 'center' });

  // Título
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Cierre de caja menor', margin + 12, y + 5.5);

  y += 14;

  // ── Empresa
  const companyName = company.company_name || 'Mi empresa';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(companyName, margin, y);
  y += 4.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  const meta: string[] = [];
  if (company.company_nit) meta.push(`NIT ${company.company_nit}`);
  if (company.company_city) meta.push(company.company_city);
  if (meta.length > 0) {
    doc.text(meta.join(' · '), margin, y);
    y += 4;
  }
  y += 4;

  // ── Período
  doc.setFillColor(PANEL[0], PANEL[1], PANEL[2]);
  doc.roundedRect(margin, y, pageW - 2 * margin, 14, 1.5, 1.5, 'F');
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('PERÍODO CERRADO', margin + 4, y + 5);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(
    `${fmtDate(closing.period_start)} — ${fmtDate(closing.period_end)}`,
    margin + 4,
    y + 11,
  );
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    `Cerrado el ${fmtDateShort(closing.closed_at.slice(0, 10))}`,
    pageW - margin - 4,
    y + 11,
    { align: 'right' },
  );
  y += 18;

  // ── Resumen de saldos (3 cuadros)
  const boxW = (pageW - 2 * margin - 6) / 3;
  const boxH = 18;
  const drawBox = (x: number, label: string, value: string, color: [number, number, number]) => {
    doc.setDrawColor(220, 222, 224);
    doc.roundedRect(x, y, boxW, boxH, 1.2, 1.2, 'S');
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(label.toUpperCase(), x + 3, y + 5);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(value, x + 3, y + 13);
  };
  drawBox(margin, 'Saldo computado', formatCurrency(closing.computed_balance), INK);
  drawBox(margin + boxW + 3, 'Saldo declarado', formatCurrency(closing.declared_balance), INK);
  const diffColor: [number, number, number] =
    Math.abs(closing.difference) < 1 ? BRAND : closing.difference > 0 ? [180, 130, 0] : [180, 60, 60];
  drawBox(margin + (boxW + 3) * 2, 'Diferencia', formatCurrency(closing.difference), diffColor);
  y += boxH + 6;

  // Etiqueta de la diferencia
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const diffLabel =
    Math.abs(closing.difference) < 1
      ? 'Caja cuadra perfecto.'
      : closing.difference > 0
        ? 'Sobrante: hay más plata física que la registrada (revisar ingresos no cargados).'
        : 'Faltante: falta plata vs lo registrado (revisar gastos no cargados o error de conteo).';
  doc.text(diffLabel, margin, y);
  y += 8;

  // ── Notas
  if (closing.notes && closing.notes.trim()) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text('Notas:', margin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const noteLines = doc.splitTextToSize(closing.notes, pageW - 2 * margin);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 4 + 4;
  }

  // ── Tabla de movimientos
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(`Movimientos del período (${movements.length})`, margin, y);
  y += 5;

  // Header
  doc.setFillColor(PANEL[0], PANEL[1], PANEL[2]);
  doc.rect(margin, y, pageW - 2 * margin, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text('Fecha', margin + 2, y + 4);
  doc.text('Concepto', margin + 22, y + 4);
  doc.text('Beneficiario', margin + 78, y + 4);
  doc.text('Categoría', margin + 124, y + 4);
  doc.text('Monto', pageW - margin - 2, y + 4, { align: 'right' });
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(INK[0], INK[1], INK[2]);

  for (const m of movements) {
    if (y > 250) {
      addAluminiaFooter(doc, { addToAllPages: false });
      doc.addPage();
      y = margin;
    }
    const concept = doc.splitTextToSize(m.concept || '—', 54)[0];
    const beneficiario = doc.splitTextToSize(m.responsible_name || '—', 44)[0];
    const cat = doc.splitTextToSize(m.category_name || '—', 38)[0];
    doc.text(fmtDateShort(m.date), margin + 2, y + 3);
    doc.text(String(concept), margin + 22, y + 3);
    doc.text(String(beneficiario), margin + 78, y + 3);
    doc.text(String(cat), margin + 124, y + 3);
    doc.text(formatCurrency(m.amount), pageW - margin - 2, y + 3, { align: 'right' });
    y += 4.5;
    doc.setDrawColor(235, 236, 238);
    doc.line(margin, y, pageW - margin, y);
    y += 0.5;
  }

  // Total
  y += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  const totalEgresos = movements.reduce((s, m) => s + m.amount, 0);
  doc.text('Total egresos', margin, y);
  doc.text(formatCurrency(totalEgresos), pageW - margin - 2, y, { align: 'right' });
  y += 12;

  // ── Firma
  if (y > 235) { doc.addPage(); y = margin; }
  doc.setDrawColor(180, 180, 180);
  doc.line(margin, y + 14, margin + 70, y + 14);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Firma del responsable', margin, y + 18);

  addAluminiaFooter(doc, { addToAllPages: true });
  return doc;
}
