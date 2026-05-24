// Generador de PDF para Comprobante de Ingreso (Recibo de Caja).
// Documento que se entrega al cliente cuando RECIBES un pago.
// Soporta dos modos: con letterhead empresa o formato limpio.

import jsPDF from 'jspdf';
import { numberToSpanishWords } from './numberToSpanishWords';
import { addAluminiaFooter } from './pdfBranding';

export interface ComprobanteIngresoData {
  // Toggle: con o sin formato empresa
  useLetterhead: boolean;
  letterheadDataUri?: string;
  letterheadFormat?: 'PNG' | 'JPEG';
  letterheadTopMarginMm?: number;
  letterheadBottomMarginMm?: number;
  // Empresa que recibe el pago (solo si NO usa letterhead)
  empresaNombre?: string;
  empresaNit?: string;
  empresaDireccion?: string;
  empresaCiudad?: string;
  // Pagador (cliente que paga)
  pagadorNombre: string;
  pagadorTipoDocumento?: 'CC' | 'CE' | 'PA' | 'NIT';
  pagadorDocumento?: string;
  pagadorDireccion?: string;
  pagadorCiudad?: string;
  pagadorTelefono?: string;
  // Documento
  numeroConsecutivo: string;
  fecha: string; // formateada "29 de abril de 2026"
  ciudadEmision: string;
  // Pago
  monto: number;
  concepto: string;
  metodoPago?: string; // "Efectivo" | "Transferencia" | "Cheque" | ...
  referenciaDoc?: string; // ej "Factura FV-001"
  notas?: string;
}

const TIPO_DOC_LABEL: Record<string, string> = {
  CC: 'Cédula de Ciudadanía',
  CE: 'Cédula de Extranjería',
  PA: 'Pasaporte',
  NIT: 'NIT',
};

const COLORS = {
  ink: [33, 37, 41] as [number, number, number],
  muted: [110, 110, 115] as [number, number, number],
  rule: [225, 225, 230] as [number, number, number],
  panel: [248, 249, 251] as [number, number, number],
  panelBorder: [220, 222, 228] as [number, number, number],
  brand: [60, 100, 80] as [number, number, number],
  success: [22, 131, 87] as [number, number, number],
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

const setFill = (doc: jsPDF, c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
const setStroke = (doc: jsPDF, c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);
const setText = (doc: jsPDF, c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);

export function generateComprobanteIngresoPdf(data: ComprobanteIngresoData): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 24;
  const hasLetterhead = data.useLetterhead && !!data.letterheadDataUri;

  // ============= LETTERHEAD BACKGROUND =============
  if (hasLetterhead) {
    try {
      doc.addImage(
        data.letterheadDataUri!,
        data.letterheadFormat ?? 'PNG',
        0, 0, pageW, pageH, undefined, 'FAST'
      );
    } catch (e) {
      console.error('Error adding letterhead background:', e);
    }
  }

  const topMargin = hasLetterhead ? data.letterheadTopMarginMm ?? 35 : 24;
  let y = topMargin;

  // ============= HEADER EMPRESA (si no hay letterhead y hay datos) =============
  if (!hasLetterhead && data.empresaNombre) {
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(data.empresaNombre.toUpperCase(), marginX, y);
    y += 4.5;

    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const headerInfo = [
      data.empresaNit ? `NIT ${data.empresaNit}` : null,
      data.empresaDireccion,
      data.empresaCiudad,
    ].filter(Boolean).join('  ·  ');
    if (headerInfo) doc.text(headerInfo, marginX, y);
  }

  // Numero consecutivo + fecha (derecha)
  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`No. ${data.numeroConsecutivo}`, pageW - marginX, topMargin, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  setText(doc, COLORS.muted);
  doc.setFontSize(8.5);
  doc.text(`${data.ciudadEmision}, ${data.fecha}`, pageW - marginX, topMargin + 4.5, { align: 'right' });

  if (!hasLetterhead && data.empresaNombre) {
    y += 8;
    setStroke(doc, COLORS.rule);
    doc.setLineWidth(0.3);
    doc.line(marginX, y, pageW - marginX, y);
  } else {
    y += 8;
  }

  // ============= TITULO =============
  y += 14;
  setText(doc, COLORS.ink);
  doc.setFont('times', 'bold');
  doc.setFontSize(20);
  doc.text('COMPROBANTE DE INGRESO', pageW / 2, y, { align: 'center' });

  // Línea decorativa
  y += 3;
  const titleRuleW = 28;
  setStroke(doc, COLORS.success);
  doc.setLineWidth(0.6);
  doc.line(pageW / 2 - titleRuleW / 2, y, pageW / 2 + titleRuleW / 2, y);

  // ============= INTRODUCCION =============
  y += 14;
  setText(doc, COLORS.ink);
  doc.setFont('times', 'normal');
  doc.setFontSize(10.5);
  const empresaTexto = hasLetterhead
    ? 'La empresa, ' + (data.empresaNit ? `identificada con NIT ${data.empresaNit}, ` : '')
    : data.empresaNombre
      ? `${data.empresaNombre.toUpperCase()}${data.empresaNit ? `, identificada con NIT ${data.empresaNit}` : ''}, `
      : '';
  const introBase = `${empresaTexto}declara haber RECIBIDO de:`;
  const introLines = doc.splitTextToSize(introBase, pageW - 2 * marginX);
  doc.text(introLines, marginX, y);
  y += introLines.length * 5;

  // ============= PANEL DEL PAGADOR =============
  y += 4;
  const panelX = marginX;
  const panelW = pageW - 2 * marginX;
  const panelPad = 6;
  const panelLineH = 6;
  const panelRows: Array<[string, string]> = [
    ['NOMBRE', data.pagadorNombre.toUpperCase()],
  ];
  if (data.pagadorDocumento) {
    const docLabel = data.pagadorTipoDocumento
      ? TIPO_DOC_LABEL[data.pagadorTipoDocumento]
      : 'Documento';
    panelRows.push([docLabel, `No. ${data.pagadorDocumento}`]);
  }
  if (data.pagadorCiudad) panelRows.push(['CIUDAD', data.pagadorCiudad]);
  if (data.pagadorTelefono) panelRows.push(['TELÉFONO', data.pagadorTelefono]);
  const panelH = panelPad * 2 + panelRows.length * panelLineH;

  setFill(doc, COLORS.panel);
  setStroke(doc, COLORS.panelBorder);
  doc.setLineWidth(0.2);
  doc.roundedRect(panelX, y, panelW, panelH, 1.5, 1.5, 'FD');

  let py = y + panelPad + 4;
  for (const [label, value] of panelRows) {
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(label, panelX + panelPad, py);
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(value, panelX + panelPad + 38, py);
    py += panelLineH;
  }
  y += panelH;

  // ============= MONTO DESTACADO =============
  y += 8;
  const montoPanelH = 22;
  setFill(doc, [252, 253, 254]);
  setStroke(doc, COLORS.panelBorder);
  doc.setLineWidth(0.2);
  doc.roundedRect(marginX, y, pageW - 2 * marginX, montoPanelH, 1.5, 1.5, 'FD');

  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('LA SUMA DE', pageW / 2, y + 6, { align: 'center' });

  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(fmtMoney(data.monto), pageW / 2, y + 14, { align: 'center' });

  setText(doc, COLORS.muted);
  doc.setFont('times', 'italic');
  doc.setFontSize(9);
  const valorEnLetras = `(${numberToSpanishWords(data.monto).toUpperCase()} M/CTE)`;
  const letrasLines = doc.splitTextToSize(valorEnLetras, pageW - 2 * marginX - 8);
  doc.text(letrasLines, pageW / 2, y + 19, { align: 'center' });
  y += montoPanelH;

  // ============= CONCEPTO =============
  y += 9;
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('POR CONCEPTO DE', marginX, y);
  y += 4.5;
  setText(doc, COLORS.ink);
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  const conceptoLines = doc.splitTextToSize(data.concepto, pageW - 2 * marginX);
  doc.text(conceptoLines, marginX, y);
  y += conceptoLines.length * 5.2;

  // ============= MÉTODO DE PAGO / REFERENCIA (opcional) =============
  if (data.metodoPago || data.referenciaDoc) {
    y += 5;
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const detalles: string[] = [];
    if (data.metodoPago) detalles.push(`Método de pago: ${data.metodoPago}`);
    if (data.referenciaDoc) detalles.push(`Referencia: ${data.referenciaDoc}`);
    doc.text(detalles.join('  ·  '), marginX, y);
    y += 5;
  }

  // ============= MANIFESTACIÓN =============
  y += 8;
  setStroke(doc, COLORS.rule);
  doc.setLineWidth(0.2);
  doc.line(marginX, y, pageW - marginX, y);
  y += 6;

  setText(doc, COLORS.ink);
  doc.setFont('times', 'normal');
  doc.setFontSize(9.5);
  const manifText =
    'Se expide el presente comprobante como constancia del ingreso recibido en la fecha y por el concepto descritos. Firma a satisfacción de quien recibe.';
  const manifLines = doc.splitTextToSize(manifText, pageW - 2 * marginX);
  doc.text(manifLines, marginX, y);
  y += manifLines.length * 4.5;

  // ============= FIRMAS =============
  const bottomMargin = hasLetterhead ? data.letterheadBottomMarginMm ?? 25 : 25;
  const firmaY = Math.max(y + 22, pageH - bottomMargin - 30);
  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  // Dos firmas: quien recibe (empresa) y quien paga (pagador)
  const firmaW = (pageW - 2 * marginX - 16) / 2;

  // Línea recibí
  setStroke(doc, COLORS.ink);
  doc.setLineWidth(0.4);
  doc.line(marginX, firmaY, marginX + firmaW, firmaY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Firma quien recibe', marginX, firmaY + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  setText(doc, COLORS.muted);
  if (!hasLetterhead && data.empresaNombre) {
    doc.text(data.empresaNombre, marginX, firmaY + 8);
  }

  // Línea paga
  const firmaX2 = marginX + firmaW + 16;
  setText(doc, COLORS.ink);
  setStroke(doc, COLORS.ink);
  doc.line(firmaX2, firmaY, firmaX2 + firmaW, firmaY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Firma quien paga', firmaX2, firmaY + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  setText(doc, COLORS.muted);
  doc.text(data.pagadorNombre, firmaX2, firmaY + 8);
  if (data.pagadorDocumento) {
    const docLabel = data.pagadorTipoDocumento ?? 'Doc';
    doc.text(`${docLabel} No. ${data.pagadorDocumento}`, firmaX2, firmaY + 12);
  }

  addAluminiaFooter(doc);
  return doc;
}
