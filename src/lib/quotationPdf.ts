import jsPDF from 'jspdf';
import { addAluminiaFooter } from './pdfBranding';

export interface QuotationPdfData {
  // Letterhead opcional (background full-page). Si está presente, el header
  // de empresa NO se imprime — lo provee la hoja membretada.
  letterheadDataUri?: string;
  letterheadFormat?: 'PNG' | 'JPEG';
  letterheadTopMarginMm?: number;
  letterheadBottomMarginMm?: number;
  // Empresa (vendedor)
  empresaNombre: string;
  empresaNit: string | null;
  empresaDireccion?: string | null;
  empresaCiudad?: string | null;
  empresaTelefono?: string | null;
  empresaEmail?: string | null;
  // Cliente
  clienteNombre: string;
  clienteNit?: string | null;
  clienteDireccion?: string | null;
  clienteEmail?: string | null;
  clienteTelefono?: string | null;
  // Documento
  quoteNumber: string;
  issueDate: string; // ISO YYYY-MM-DD
  validUntil: string; // ISO YYYY-MM-DD
  ciudadEmision?: string;
  // Items
  items: Array<{
    description?: string | null;
    system: string;
    color: string;
    width_m: number;
    height_m: number;
    quantity: number;
    area_m2: number;
    price_per_m2: number;
    line_subtotal: number;
  }>;
  // Totales
  subtotalBase: number;
  laborPct: number;
  laborAmount: number;
  profitPct: number;
  profitAmount: number;
  total: number;
  // Términos
  notes?: string | null;
}

const COLORS = {
  ink: [33, 37, 41] as [number, number, number],
  muted: [110, 110, 115] as [number, number, number],
  rule: [225, 225, 230] as [number, number, number],
  panel: [248, 249, 251] as [number, number, number],
  panelBorder: [220, 222, 228] as [number, number, number],
  brand: [60, 100, 80] as [number, number, number],
  tableHead: [240, 242, 245] as [number, number, number],
  tableHeadBorder: [200, 204, 210] as [number, number, number],
  zebraRow: [251, 252, 253] as [number, number, number],
};

function setFill(doc: jsPDF, c: [number, number, number]) {
  doc.setFillColor(c[0], c[1], c[2]);
}
function setStroke(doc: jsPDF, c: [number, number, number]) {
  doc.setDrawColor(c[0], c[1], c[2]);
}
function setText(doc: jsPDF, c: [number, number, number]) {
  doc.setTextColor(c[0], c[1], c[2]);
}

function fmtMoney(n: number, opts?: { decimals?: boolean }): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  }).format(n);
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  const months = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  const monthName = months[parseInt(m, 10) - 1] ?? m;
  return `${parseInt(d, 10)} de ${monthName} de ${y}`;
}

function fmtNum(n: number, decimals = 2): string {
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function generateQuotationPdf(data: QuotationPdfData): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 18;
  const hasLetterhead = !!data.letterheadDataUri;

  // ============= LETTERHEAD BACKGROUND (página 1; se aplicará a páginas extras al final) =============
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
        'FAST',
      );
    } catch (e) {
      console.error('Error adding letterhead background:', e);
    }
  }

  const topMargin = hasLetterhead ? data.letterheadTopMarginMm ?? 35 : 18;
  const bottomMargin = hasLetterhead ? data.letterheadBottomMarginMm ?? 25 : 22;
  let y = topMargin;

  // ============= ENCABEZADO EMPRESA (solo si no hay letterhead) =============
  if (!hasLetterhead) {
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(data.empresaNombre.toUpperCase(), marginX, y);
    y += 5;
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const headerInfo = [
      data.empresaNit ? `NIT ${data.empresaNit}` : null,
      data.empresaDireccion,
      data.empresaCiudad,
      data.empresaTelefono,
      data.empresaEmail,
    ]
      .filter(Boolean)
      .join('  ·  ');
    if (headerInfo) {
      const lines = doc.splitTextToSize(headerInfo, pageW - 2 * marginX - 50);
      doc.text(lines, marginX, y);
      y += lines.length * 4;
    }
  }

  // ============= TÍTULO + NÚMERO (top right) =============
  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('COTIZACIÓN', pageW - marginX, topMargin + 2, { align: 'right' });

  setText(doc, COLORS.brand);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(data.quoteNumber, pageW - marginX, topMargin + 8, { align: 'right' });

  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Emitida: ${fmtDate(data.issueDate)}`, pageW - marginX, topMargin + 13, {
    align: 'right',
  });
  doc.text(`Válida hasta: ${fmtDate(data.validUntil)}`, pageW - marginX, topMargin + 17, {
    align: 'right',
  });

  if (!hasLetterhead) {
    y = Math.max(y + 4, topMargin + 22);
    setStroke(doc, COLORS.rule);
    doc.setLineWidth(0.3);
    doc.line(marginX, y, pageW - marginX, y);
    y += 6;
  } else {
    y = topMargin + 24;
  }

  // ============= PANEL DEL CLIENTE =============
  const panelX = marginX;
  const panelW = pageW - 2 * marginX;
  const panelPad = 5;
  const clientRows: Array<[string, string]> = [['CLIENTE', data.clienteNombre]];
  if (data.clienteNit) clientRows.push(['NIT / CC', data.clienteNit]);
  if (data.clienteDireccion) clientRows.push(['DIRECCIÓN', data.clienteDireccion]);
  const contactBits = [data.clienteTelefono, data.clienteEmail].filter(Boolean) as string[];
  if (contactBits.length) clientRows.push(['CONTACTO', contactBits.join('  ·  ')]);

  const panelLineH = 5.2;
  const panelH = panelPad * 2 + clientRows.length * panelLineH;

  setFill(doc, COLORS.panel);
  setStroke(doc, COLORS.panelBorder);
  doc.setLineWidth(0.2);
  doc.roundedRect(panelX, y, panelW, panelH, 1.5, 1.5, 'FD');

  let py = y + panelPad + 3.5;
  for (const [label, value] of clientRows) {
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(label, panelX + panelPad, py);
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const valueLines = doc.splitTextToSize(value, panelW - panelPad * 2 - 30);
    doc.text(valueLines[0] ?? '', panelX + panelPad + 28, py);
    py += panelLineH;
  }
  y += panelH + 6;

  // ============= TABLA DE ITEMS =============
  // Columnas: # | Descripción / Sistema-Color | Dimensiones | Cant | m² | Precio/m² | Subtotal
  // Anchos (mm):
  const COL = {
    n: 7,
    desc: 56,
    dim: 24,
    qty: 12,
    m2: 16,
    price: 28,
    total: 31,
  };
  const tableX = marginX;
  const rowH = 9.5;
  const tableW = COL.n + COL.desc + COL.dim + COL.qty + COL.m2 + COL.price + COL.total;

  function drawTableHeader() {
    setFill(doc, COLORS.tableHead);
    setStroke(doc, COLORS.tableHeadBorder);
    doc.setLineWidth(0.15);
    doc.rect(tableX, y, tableW, 7, 'FD');

    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    let cx = tableX + 1.5;
    doc.text('#', cx, y + 4.7);
    cx += COL.n;
    doc.text('PRODUCTO', cx, y + 4.7);
    cx += COL.desc;
    doc.text('DIMENSIONES', cx, y + 4.7);
    cx += COL.dim;
    doc.text('CANT', cx + COL.qty - 2, y + 4.7, { align: 'right' });
    cx += COL.qty;
    doc.text('m²', cx + COL.m2 - 2, y + 4.7, { align: 'right' });
    cx += COL.m2;
    doc.text('PRECIO/m²', cx + COL.price - 2, y + 4.7, { align: 'right' });
    cx += COL.price;
    doc.text('SUBTOTAL', cx + COL.total - 2, y + 4.7, { align: 'right' });
    y += 7;
  }

  function ensureSpace(neededMm: number) {
    if (y + neededMm <= pageH - bottomMargin - 4) return;
    doc.addPage();
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
          'FAST',
        );
      } catch {
        /* noop */
      }
    }
    y = topMargin;
    drawTableHeader();
  }

  drawTableHeader();

  // Rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  data.items.forEach((it, idx) => {
    const productLine1 = `${it.system} · ${it.color}`;
    const productLine2 = it.description ?? '';
    const dim = `${fmtNum(it.width_m, 2)} × ${fmtNum(it.height_m, 2)} m`;

    // Calcular alto real basado en si hay descripción
    const linesNeeded = productLine2 ? 2 : 1;
    const dynRowH = Math.max(rowH, 5 + linesNeeded * 4);

    ensureSpace(dynRowH + 2);

    if (idx % 2 === 1) {
      setFill(doc, COLORS.zebraRow);
      doc.rect(tableX, y, tableW, dynRowH, 'F');
    }

    setStroke(doc, COLORS.rule);
    doc.setLineWidth(0.1);
    doc.line(tableX, y + dynRowH, tableX + tableW, y + dynRowH);

    setText(doc, COLORS.ink);
    let cx = tableX + 1.5;

    // Número
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    setText(doc, COLORS.muted);
    doc.text(String(idx + 1), cx, y + 5.5);
    cx += COL.n;

    // Producto: línea 1 negrita (sistema·color), línea 2 muted (descripción)
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(productLine1, cx, y + 4.5);
    if (productLine2) {
      setText(doc, COLORS.muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      const truncated = doc.splitTextToSize(productLine2, COL.desc - 2)[0];
      doc.text(truncated, cx, y + 8);
    }
    cx += COL.desc;

    // Dimensiones
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(dim, cx, y + 5.5);
    cx += COL.dim;

    // Cantidad
    doc.text(String(it.quantity), cx + COL.qty - 2, y + 5.5, { align: 'right' });
    cx += COL.qty;

    // m²
    doc.text(fmtNum(it.area_m2, 2), cx + COL.m2 - 2, y + 5.5, { align: 'right' });
    cx += COL.m2;

    // Precio / m²
    doc.text(fmtMoney(it.price_per_m2), cx + COL.price - 2, y + 5.5, { align: 'right' });
    cx += COL.price;

    // Subtotal
    doc.setFont('helvetica', 'bold');
    doc.text(fmtMoney(it.line_subtotal), cx + COL.total - 2, y + 5.5, { align: 'right' });

    y += dynRowH;
  });

  y += 4;

  // ============= TOTALES (panel derecha) =============
  ensureSpace(40);
  const totalsX = pageW - marginX - 80;
  const totalsW = 80;
  const totalsLineH = 5.5;
  const totalsRows: Array<[string, string, boolean]> = [
    ['Subtotal (m² × precio)', fmtMoney(data.subtotalBase), false],
    [`Mano de obra (${fmtNum(data.laborPct, 1)}%)`, fmtMoney(data.laborAmount), false],
    [`Utilidad (${fmtNum(data.profitPct, 1)}%)`, fmtMoney(data.profitAmount), false],
  ];
  for (const [label, value] of totalsRows) {
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(label, totalsX, y);
    setText(doc, COLORS.ink);
    doc.text(value, totalsX + totalsW, y, { align: 'right' });
    y += totalsLineH;
  }

  y += 1;
  setStroke(doc, COLORS.rule);
  doc.setLineWidth(0.3);
  doc.line(totalsX, y, totalsX + totalsW, y);
  y += 5;

  setFill(doc, COLORS.brand);
  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL', totalsX, y);
  setText(doc, COLORS.brand);
  doc.setFontSize(13);
  doc.text(fmtMoney(data.total), totalsX + totalsW, y, { align: 'right' });
  y += 7;

  // ============= TÉRMINOS Y CONDICIONES =============
  if (data.notes && data.notes.trim()) {
    y += 6;
    ensureSpace(20);
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('TÉRMINOS Y CONDICIONES', marginX, y);
    y += 4;
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const noteLines = doc.splitTextToSize(data.notes.trim(), pageW - 2 * marginX);
    for (const line of noteLines) {
      ensureSpace(5);
      doc.text(line, marginX, y);
      y += 4;
    }
  }

  addAluminiaFooter(doc);
  return doc;
}
