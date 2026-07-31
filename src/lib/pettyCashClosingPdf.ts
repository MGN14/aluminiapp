import jsPDF from 'jspdf';
import { addAluminiaFooter } from './pdfBranding';
import { parseLocalDate } from './dateUtils';
import { formatCurrency } from './formatters';
import { accountLabel } from './pettyCashAccounts';
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

// Fecha compacta "dd/MM/yyyy" para la tabla de movimientos: la columna Fecha
// solo tiene ~20mm y "14 de may de 2026" se desborda sobre Concepto (tapaba la
// primera letra). Numérica entra holgada y queda inequívoca.
function fmtDateCompact(iso: string): string {
  const d = parseLocalDate(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// Recorta a una sola línea del ancho dado. El "…" avisa que el texto sigue: sin
// él un beneficiario cortado se lee como si ese fuera su nombre completo.
function clip(doc: jsPDF, text: string | null | undefined, widthMm: number): string {
  const raw = (text || '').trim();
  if (!raw) return '—';
  const lines = doc.splitTextToSize(raw, widthMm) as string[];
  if (lines.length <= 1) return lines[0] ?? raw;
  return `${doc.splitTextToSize(raw, widthMm - 2)[0]}…`;
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
  // Un cierre reabierto todavía puede cambiar: el PDF tiene que decirlo, si no
  // circula un documento firmable con cifras que después se mueven.
  const esBorrador = closing.status === 'en_edicion';
  doc.text(esBorrador ? 'BORRADOR — PERÍODO EN EDICIÓN' : 'PERÍODO CERRADO', margin + 4, y + 5);
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
    esBorrador
      ? 'Sin cerrar: las cifras pueden cambiar'
      : `Cerrado el ${fmtDateShort(closing.closed_at.slice(0, 10))}`,
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

  // ── Cuadre POR CUENTA. Con más de una cuenta (efectivo + Nequi) la
  // diferencia total no dice nada: puede dar cero con un sobrante en una y un
  // faltante igual en la otra. Lo que se revisa es cada cuenta contra su
  // fuente, así que el PDF firmable tiene que mostrarlas separadas.
  const cuentasCierre = Object.entries(closing.saldos ?? {}).filter(
    ([, s]) => s && (s.computado !== 0 || s.declarado !== 0),
  );
  if (cuentasCierre.length > 1) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text('CUENTA', margin + 2, y + 3);
    doc.text('COMPUTADO', margin + 70, y + 3, { align: 'right' });
    doc.text('DECLARADO', margin + 110, y + 3, { align: 'right' });
    doc.text('DIFERENCIA', margin + 150, y + 3, { align: 'right' });
    y += 5;
    doc.setDrawColor(225, 227, 229);
    doc.line(margin, y, pageW - margin, y);
    y += 3.5;

    for (const [cuenta, s] of cuentasCierre) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(INK[0], INK[1], INK[2]);
      doc.text(accountLabel(cuenta), margin + 2, y);
      doc.text(formatCurrency(s.computado), margin + 70, y, { align: 'right' });
      doc.text(formatCurrency(s.declarado), margin + 110, y, { align: 'right' });
      const cuadra = Math.abs(s.diferencia) < 1;
      if (cuadra) doc.setTextColor(BRAND[0], BRAND[1], BRAND[2]);
      else doc.setTextColor(170, 60, 60);
      doc.setFont('helvetica', 'bold');
      doc.text(formatCurrency(s.diferencia), margin + 150, y, { align: 'right' });
      y += 5;
    }
    y += 3;
  }

  // Etiqueta de la diferencia
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const cuentasDescuadradas = cuentasCierre.filter(([, s]) => Math.abs(s.diferencia) >= 1);
  const diffLabel =
    // Con varias cuentas el total puede dar cero y aun asi haber un sobrante en
    // una y un faltante igual en la otra. Mandan las cuentas, no el total.
    cuentasDescuadradas.length > 0 && cuentasCierre.length > 1
      ? `Revisar: ${cuentasDescuadradas.map(([c, s]) => `${accountLabel(c)} ${s.diferencia > 0 ? 'sobra' : 'falta'} ${formatCurrency(Math.abs(s.diferencia))}`).join(' · ')}.`
    : Math.abs(closing.difference) < 1
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
  const ingresos = movements.filter((m) => m.kind === 'ingreso_efectivo');
  const totalIngresos = ingresos.reduce((s, m) => s + m.amount, 0);
  const totalEgresos = movements
    .filter((m) => m.kind !== 'ingreso_efectivo')
    .reduce((s, m) => s + m.amount, 0);
  const variasCuentas = new Set(movements.map((m) => m.cuenta)).size > 1;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(`Movimientos del período (${movements.length})`, margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(
    `${ingresos.length} ingreso${ingresos.length === 1 ? '' : 's'} · ` +
      `${movements.length - ingresos.length} egreso${movements.length - ingresos.length === 1 ? '' : 's'}`,
    pageW - margin - 2,
    y,
    { align: 'right' },
  );
  y += 5;

  // Posición de cada columna, relativa al margen. La de Monto va alineada a la
  // derecha desde el borde. Tipo entra justo antes para que se lea junto al valor.
  // Con varias cuentas la Cuenta se gana su propia columna y el resto se corre.
  // Meterla pegada a la fecha la montaba encima de Concepto.
  const cFecha = margin + 2;
  const cCuenta = margin + 20;
  const cConcepto = margin + (variasCuentas ? 34 : 22);
  const cBeneficiario = margin + (variasCuentas ? 80 : 76);
  const cCategoria = margin + 118;
  const cTipo = margin + 148;
  const wConcepto = variasCuentas ? 44 : 50;
  const wBeneficiario = variasCuentas ? 36 : 38;

  const drawTableHeader = () => {
    doc.setFillColor(PANEL[0], PANEL[1], PANEL[2]);
    doc.rect(margin, y, pageW - 2 * margin, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text('Fecha', cFecha, y + 4);
    if (variasCuentas) doc.text('Cuenta', cCuenta, y + 4);
    doc.text('Concepto', cConcepto, y + 4);
    doc.text('Beneficiario', cBeneficiario, y + 4);
    doc.text('Categoría', cCategoria, y + 4);
    doc.text('Tipo', cTipo, y + 4);
    doc.text('Monto', pageW - margin - 2, y + 4, { align: 'right' });
    y += 6;
  };
  drawTableHeader();

  for (const m of movements) {
    if (y > 250) {
      addAluminiaFooter(doc, { addToAllPages: false });
      doc.addPage();
      y = margin;
      drawTableHeader();
    }

    const isIngreso = m.kind === 'ingreso_efectivo';

    // Fondo verde muy tenue en los ingresos: de un vistazo se ve qué entró.
    if (isIngreso) {
      doc.setFillColor(236, 245, 240);
      doc.rect(margin, y - 0.5, pageW - 2 * margin, 5, 'F');
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(fmtDateCompact(m.date), cFecha, y + 3);
    if (variasCuentas) doc.text(clip(doc, accountLabel(m.cuenta), 13), cCuenta, y + 3);
    doc.text(clip(doc, m.concept, wConcepto), cConcepto, y + 3);
    doc.text(clip(doc, m.responsible_name, wBeneficiario), cBeneficiario, y + 3);
    doc.text(clip(doc, m.category_name, 27), cCategoria, y + 3);

    // Tipo y monto comparten color y signo. El signo es lo que sobrevive a una
    // impresión en blanco y negro, por eso va además del texto.
    if (isIngreso) doc.setTextColor(BRAND[0], BRAND[1], BRAND[2]);
    else doc.setTextColor(170, 60, 60);
    doc.setFont('helvetica', 'bold');
    doc.text(isIngreso ? 'Ingreso' : 'Egreso', cTipo, y + 3);
    doc.text(
      `${isIngreso ? '+' : '-'} ${formatCurrency(m.amount)}`,
      pageW - margin - 2,
      y + 3,
      { align: 'right' },
    );

    y += 4.5;
    doc.setDrawColor(235, 236, 238);
    doc.line(margin, y, pageW - margin, y);
    y += 0.5;
  }

  // ── Totales: ingresos y egresos por separado, y el neto que debe coincidir
  // con el saldo computado de arriba.
  y += 3;
  const drawTotal = (label: string, value: string, color: [number, number, number], bold: boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 9 : 8.5);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(label, margin, y);
    doc.text(value, pageW - margin - 2, y, { align: 'right' });
    y += bold ? 6 : 5;
  };
  drawTotal('Total ingresos', `+ ${formatCurrency(totalIngresos)}`, BRAND, false);
  drawTotal('Total egresos', `- ${formatCurrency(totalEgresos)}`, [170, 60, 60], false);
  doc.setDrawColor(200, 202, 205);
  doc.line(margin, y - 3, pageW - margin, y - 3);
  y += 1;
  drawTotal('Saldo neto del período', formatCurrency(totalIngresos - totalEgresos), INK, true);
  y += 6;

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
