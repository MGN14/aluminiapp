import jsPDF from 'jspdf';

// Verde brand AluminIA (oklch(0.43 0.14 155) aprox en RGB)
const BRAND_COLOR: [number, number, number] = [54, 105, 78];
const BRAND_URL = 'https://aluminiapp.co';

/**
 * Footer "Generado con AluminIA · aluminiapp.co" centrado en el pie de página.
 * - Logo cuadrado verde con "A" blanca + texto a la derecha
 * - El área completa es un hyperlink al login de AluminIA
 * - Sutil (texto en gris claro), no compite con el contenido del documento
 *
 * Usar al final de la generación, antes de return doc.
 * Si addToAllPages=true (default), se aplica a todas las páginas existentes.
 */
export function addAluminiaFooter(doc: jsPDF, opts?: { addToAllPages?: boolean }) {
  const addToAll = opts?.addToAllPages ?? true;
  const total = doc.getNumberOfPages();
  const startPage = addToAll ? 1 : doc.getCurrentPageInfo().pageNumber;
  const endPage = addToAll ? total : startPage;

  for (let i = startPage; i <= endPage; i++) {
    doc.setPage(i);
    drawFooter(doc);
  }
}

function drawFooter(doc: jsPDF) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const baselineY = pageH - 7;
  const text = 'Generado con AluminIA · aluminiapp.co';

  // Medir ancho del texto para centrar logo+texto
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  const textW = doc.getTextWidth(text);
  const logoSize = 3.2;
  const gap = 1.5;
  const totalW = logoSize + gap + textW;
  const startX = (pageW - totalW) / 2;

  // Logo: cuadrado redondeado verde brand con "A" blanca
  doc.setFillColor(BRAND_COLOR[0], BRAND_COLOR[1], BRAND_COLOR[2]);
  doc.roundedRect(startX, baselineY - logoSize + 0.4, logoSize, logoSize, 0.5, 0.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.text('A', startX + logoSize / 2, baselineY - 0.6, { align: 'center' });

  // Texto en gris claro
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(140, 140, 145);
  doc.text(text, startX + logoSize + gap, baselineY);

  // Hyperlink: área que cubre logo + texto
  doc.link(startX, baselineY - logoSize, totalW, logoSize + 1, { url: BRAND_URL });
}
