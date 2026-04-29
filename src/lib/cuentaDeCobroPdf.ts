import jsPDF from 'jspdf';
import { numberToSpanishWords } from './numberToSpanishWords';

export type CuentaDeCobroVariant = 'cuenta_de_cobro' | 'comprobante_pago';

export interface CuentaDeCobroData {
  variant: CuentaDeCobroVariant;
  // Letterhead opcional (background full-page). Si esta presente,
  // el header de empresa NO se imprime (lo provee la hoja membretada).
  letterheadDataUri?: string;
  letterheadFormat?: 'PNG' | 'JPEG';
  letterheadTopMarginMm?: number;
  letterheadBottomMarginMm?: number;
  // Contratante (empresa del usuario)
  empresaNombre: string;
  empresaNit: string;
  empresaDireccion?: string;
  empresaCiudad?: string;
  // Prestador (a quien se le hace la cuenta de cobro / pago)
  prestadorNombre: string;
  prestadorTipoDocumento: 'CC' | 'CE' | 'PA' | 'NIT';
  prestadorDocumento: string;
  prestadorCiudad?: string;
  prestadorTelefono?: string;
  // Documento
  numeroConsecutivo: string;
  fecha: string; // formateada "29 de abril de 2026"
  ciudadEmision: string;
  concepto: string;
  monto: number;
  retencion?: number;
  incluyePrestacionesSociales: boolean;
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
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function setFill(doc: jsPDF, c: [number, number, number]) {
  doc.setFillColor(c[0], c[1], c[2]);
}
function setStroke(doc: jsPDF, c: [number, number, number]) {
  doc.setDrawColor(c[0], c[1], c[2]);
}
function setText(doc: jsPDF, c: [number, number, number]) {
  doc.setTextColor(c[0], c[1], c[2]);
}

export function generateCuentaDeCobroPdf(data: CuentaDeCobroData): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 24;
  const isCdc = data.variant === 'cuenta_de_cobro';
  const hasLetterhead = !!data.letterheadDataUri;

  // ============= LETTERHEAD BACKGROUND (si aplica) =============
  if (hasLetterhead) {
    try {
      doc.addImage(
        data.letterheadDataUri!,
        data.letterheadFormat ?? 'PNG',
        0,
        0,
        pageW,
        pageH,
        undefined,
        'FAST'
      );
    } catch (e) {
      console.error('Error adding letterhead background:', e);
    }
  }

  const topMargin = hasLetterhead ? data.letterheadTopMarginMm ?? 35 : 24;
  let y = topMargin;

  // ============= ENCABEZADO EMPRESA (solo si no hay letterhead) =============
  if (!hasLetterhead) {
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(data.empresaNombre.toUpperCase(), marginX, y);
    y += 4.5;

    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const headerInfo = [
      `NIT ${data.empresaNit}`,
      data.empresaDireccion,
      data.empresaCiudad,
    ].filter(Boolean).join('  ·  ');
    doc.text(headerInfo, marginX, y);
  }

  // Numero consecutivo y fecha (derecha) — siempre, en la zona del topMargin
  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`No. ${data.numeroConsecutivo}`, pageW - marginX, topMargin, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  setText(doc, COLORS.muted);
  doc.setFontSize(8.5);
  doc.text(`${data.ciudadEmision}, ${data.fecha}`, pageW - marginX, topMargin + 4.5, { align: 'right' });

  if (!hasLetterhead) {
    // Linea horizontal divisora bajo el header empresa
    y += 8;
    setStroke(doc, COLORS.rule);
    doc.setLineWidth(0.3);
    doc.line(marginX, y, pageW - marginX, y);
  } else {
    // Con letterhead, simplemente dejamos espacio antes del titulo
    y += 8;
  }

  // ============= TITULO =============
  y += 14;
  setText(doc, COLORS.ink);
  doc.setFont('times', 'bold');
  doc.setFontSize(20);
  doc.text(isCdc ? 'CUENTA DE COBRO' : 'COMPROBANTE DE PAGO', pageW / 2, y, { align: 'center' });

  // Linea decorativa corta bajo titulo
  y += 3;
  const titleRuleW = 28;
  setStroke(doc, COLORS.brand);
  doc.setLineWidth(0.6);
  doc.line(pageW / 2 - titleRuleW / 2, y, pageW / 2 + titleRuleW / 2, y);

  // ============= INTRODUCCION =============
  y += 14;
  setText(doc, COLORS.ink);
  doc.setFont('times', 'normal');
  doc.setFontSize(10.5);
  const introBase = isCdc
    ? `${data.empresaNombre.toUpperCase()}, identificada con NIT ${data.empresaNit}, debe a:`
    : `${data.empresaNombre.toUpperCase()}, identificada con NIT ${data.empresaNit}, ha pagado a:`;
  const introLines = doc.splitTextToSize(introBase, pageW - 2 * marginX);
  doc.text(introLines, marginX, y);
  y += introLines.length * 5;

  // ============= PANEL DEL PRESTADOR =============
  y += 4;
  const panelX = marginX;
  const panelW = pageW - 2 * marginX;
  const panelPad = 6;
  const panelLineH = 6;
  const panelRows: Array<[string, string]> = [
    ['NOMBRE', data.prestadorNombre.toUpperCase()],
    [TIPO_DOC_LABEL[data.prestadorTipoDocumento] ?? data.prestadorTipoDocumento, `No. ${data.prestadorDocumento}`],
  ];
  if (data.prestadorCiudad) panelRows.push(['CIUDAD', data.prestadorCiudad]);
  if (data.prestadorTelefono) panelRows.push(['TELÉFONO', data.prestadorTelefono]);
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
  doc.text(isCdc ? 'LA SUMA DE' : 'POR LA SUMA RECIBIDA DE', pageW / 2, y + 6, { align: 'center' });

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

  // ============= RETENCION (opcional) =============
  if (data.retencion && data.retencion > 0) {
    y += 5;
    const neto = data.monto - data.retencion;
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Retención en la fuente: ${fmtMoney(data.retencion)}`, marginX, y);
    y += 5;
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`Valor neto a pagar: ${fmtMoney(neto)}`, marginX, y);
    y += 4;
  }

  // ============= MANIFESTACIONES =============
  y += 8;
  setStroke(doc, COLORS.rule);
  doc.setLineWidth(0.2);
  doc.line(marginX, y, pageW - marginX, y);
  y += 6;

  setText(doc, COLORS.ink);
  doc.setFont('times', 'normal');
  doc.setFontSize(9.5);
  const manifText = isCdc
    ? 'El suscrito declara bajo la gravedad de juramento que no se encuentra obligado a expedir factura electrónica de venta, conforme a las normas tributarias vigentes y los requisitos establecidos por la DIAN.'
    : 'El suscrito declara haber recibido del contratante la suma indicada, en la fecha y por el concepto descritos. Firma como constancia del pago efectuado.';
  const manifLines = doc.splitTextToSize(manifText, pageW - 2 * marginX);
  doc.text(manifLines, marginX, y);
  y += manifLines.length * 4.5;

  if (data.incluyePrestacionesSociales) {
    y += 4;
    const prestText =
      'Asimismo, declara que se encuentra al día en el pago de aportes al Sistema de Seguridad Social en Salud y Pensión, en cumplimiento de lo establecido por el Artículo 50 de la Ley 789 de 2002 y el Decreto 1670 de 2007.';
    const prestLines = doc.splitTextToSize(prestText, pageW - 2 * marginX);
    doc.text(prestLines, marginX, y);
    y += prestLines.length * 4.5;
  }

  // ============= FIRMA =============
  // Anclamos firma cerca del pie, respetando margen inferior si hay letterhead
  const bottomMargin = hasLetterhead ? data.letterheadBottomMarginMm ?? 25 : 25;
  const firmaY = Math.max(y + 18, pageH - bottomMargin - 25);
  setText(doc, COLORS.ink);
  doc.setFont('times', 'normal');
  doc.setFontSize(10.5);
  doc.text('Atentamente,', marginX, firmaY - 18);

  // Linea para firma
  setStroke(doc, COLORS.ink);
  doc.setLineWidth(0.4);
  doc.line(marginX, firmaY, marginX + 75, firmaY);

  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(data.prestadorNombre.toUpperCase(), marginX, firmaY + 5);
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(
    `${TIPO_DOC_LABEL[data.prestadorTipoDocumento] ?? data.prestadorTipoDocumento} No. ${data.prestadorDocumento}`,
    marginX,
    firmaY + 9.5
  );

  return doc;
}
