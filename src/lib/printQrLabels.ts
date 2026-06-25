import QRCode from 'qrcode';
import { encodeLabelPayload } from './qrLabel';

export interface LabelRow {
  reference: string;
  name: string;
  system?: string | null;
  /** Unidades que trae el paquete — se hornea en el QR. */
  quantity: number;
  /** Cuántas etiquetas idénticas imprimir de esta fila. */
  copies: number;
  /** Ubicación física en bodega (ej: A1). Va en el QR y visible en la etiqueta. */
  location?: string | null;
  /** Serial único del bulto (LPN). Si está, cada etiqueta es única. */
  serial?: string | null;
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;'
    : c === '<' ? '&lt;'
    : c === '>' ? '&gt;'
    : c === '"' ? '&quot;'
    : '&#39;',
  );
}

// Etiqueta 100×50mm (rollo polipropileno de la lista de compra). El QR ocupa el
// lado izquierdo; a la derecha referencia grande + nombre + cantidad + sistema.
// print-color-adjust:exact fuerza a imprimir los fondos de los chips.
const LABEL_CSS = `
  @page { size: 100mm 50mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: #fff; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; }
  .label {
    width: 100mm; height: 50mm; padding: 3mm;
    display: flex; align-items: center; gap: 3mm; overflow: hidden;
    page-break-after: always;
  }
  .label:last-child { page-break-after: auto; }
  .qr { width: 42mm; height: 42mm; flex-shrink: 0; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
  .ref { font-size: 7mm; font-weight: 800; line-height: 1.02; letter-spacing: -0.4px; word-break: break-all; }
  .name { font-size: 3.1mm; color: #222; line-height: 1.15; margin-top: 1mm; max-height: 9mm; overflow: hidden; }
  .meta { display: flex; align-items: center; gap: 2.5mm; margin-top: 2mm; }
  .qty { font-size: 5.2mm; font-weight: 800; }
  .sys { font-size: 2.9mm; font-weight: 700; background: #111; color: #fff; padding: 0.6mm 2mm; border-radius: 1.5mm; }
  .loc { font-size: 4.4mm; font-weight: 800; border: 0.5mm solid #000; padding: 0.4mm 2mm; border-radius: 1.5mm; letter-spacing: 0.3px; }
  .serial { font-size: 3mm; font-weight: 700; color: #222; margin-top: 1.2mm; font-family: 'Courier New', monospace; letter-spacing: 0.3px; }
  .brand { font-size: 2.5mm; color: #999; letter-spacing: 0.6px; margin-top: 1mm; text-transform: uppercase; }
`;

/** Genera el HTML imprimible (una etiqueta por página) con los QR ya embebidos. */
export async function buildLabelsHtml(rows: LabelRow[]): Promise<string> {
  const labels: string[] = [];
  for (const row of rows) {
    const copies = Math.max(1, Math.floor(row.copies || 1));
    const qty = row.quantity > 0 ? row.quantity : 1;
    const loc = (row.location ?? '').trim();
    const ser = (row.serial ?? '').trim();
    const payload = encodeLabelPayload(row.reference, qty, loc, ser);
    // errorCorrection M + margen 0: QR nítido y compacto para el lector.
    const svg = await QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 });
    const sys = (row.system ?? '').trim();
    const inner = `
      <div class="label">
        <div class="qr">${svg}</div>
        <div class="info">
          <div class="ref">${escapeHtml(row.reference)}</div>
          ${row.name ? `<div class="name">${escapeHtml(row.name)}</div>` : ''}
          <div class="meta">
            <span class="qty">x${qty} und</span>
            ${loc ? `<span class="loc">${escapeHtml(loc)}</span>` : ''}
            ${sys ? `<span class="sys">${escapeHtml(sys)}</span>` : ''}
          </div>
          ${ser ? `<div class="serial">${escapeHtml(ser)}</div>` : ''}
          <div class="brand">AluminIA</div>
        </div>
      </div>`;
    for (let i = 0; i < copies; i++) labels.push(inner);
  }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas QR</title><style>${LABEL_CSS}</style></head><body>${labels.join('')}</body></html>`;
}

/**
 * Abre una ventana con las etiquetas y dispara el diálogo de impresión del
 * navegador (apuntar a la Zebra ZD230 de recepción, tamaño 100×50mm).
 */
export async function printQrLabels(rows: LabelRow[]): Promise<void> {
  const html = await buildLabelsHtml(rows);
  const win = window.open('', '_blank', 'width=960,height=640');
  if (!win) {
    throw new Error('No se pudo abrir la ventana de impresión. Permití las ventanas emergentes para este sitio.');
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  // Pequeño respiro para que el navegador renderice los SVG antes de imprimir.
  setTimeout(() => {
    try { win.print(); } catch { /* el usuario puede imprimir con Ctrl+P */ }
  }, 350);
}
