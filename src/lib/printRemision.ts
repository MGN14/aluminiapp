// Impresión de una remisión (remito / nota de entrega) en formato carta, con
// el diálogo de impresión nativo del navegador ("aparece la impresora"). Es un
// documento de movimiento de mercancía: NO lleva precios.

export interface RemisionPrintData {
  company: { name?: string | null; nit?: string | null; address?: string | null; city?: string | null };
  number: string;
  date: string; // yyyy-mm-dd
  beneficiary: string;
  items: { reference: string; product_name: string; units: number }[];
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
}

function fmtDate(s: string): string {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return d && m && y ? `${d}/${m}/${y}` : s;
}

const CSS = `
  @page { size: letter; margin: 16mm 16mm 18mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; font-size: 11pt; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8pt; }
  .co-name { font-size: 15pt; font-weight: 800; letter-spacing: -0.3px; }
  .co-meta { font-size: 9pt; color: #444; margin-top: 2pt; line-height: 1.35; }
  .doc { text-align: right; }
  .doc-title { font-size: 13pt; font-weight: 800; letter-spacing: 1px; }
  .doc-num { font-size: 12pt; font-weight: 700; margin-top: 2pt; }
  .doc-date { font-size: 9.5pt; color: #444; margin-top: 2pt; }
  .party { margin-top: 12pt; font-size: 10.5pt; }
  .party .lbl { color: #666; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.5px; }
  .party .val { font-weight: 700; font-size: 12pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 12pt; }
  th { background: #111; color: #fff; font-size: 9pt; text-align: left; padding: 5pt 7pt; }
  th.r, td.r { text-align: right; }
  td { padding: 5pt 7pt; border-bottom: 1px solid #ddd; font-size: 10pt; }
  td.ref { font-family: 'Courier New', monospace; font-weight: 700; }
  tfoot td { border-top: 2px solid #111; border-bottom: none; font-weight: 800; font-size: 11pt; padding-top: 7pt; }
  .signs { display: flex; gap: 40pt; margin-top: 48pt; }
  .sign { flex: 1; border-top: 1px solid #111; padding-top: 4pt; font-size: 9pt; color: #444; text-align: center; }
  .foot { margin-top: 18pt; font-size: 8pt; color: #999; text-align: center; }
`;

function buildHtml(d: RemisionPrintData): string {
  const co = d.company || {};
  const totalUnits = d.items.reduce((s, i) => s + (Number(i.units) || 0), 0);
  const rows = d.items.map(i => `
    <tr>
      <td class="ref">${escapeHtml(i.reference)}</td>
      <td>${escapeHtml(i.product_name || '')}</td>
      <td class="r">${(Number(i.units) || 0).toLocaleString('es-CO')}</td>
    </tr>`).join('');

  const coMetaParts = [co.nit ? `NIT ${escapeHtml(co.nit)}` : '', escapeHtml(co.address || ''), escapeHtml(co.city || '')]
    .filter(Boolean).join(' · ');

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Remisión ${escapeHtml(d.number)}</title><style>${CSS}</style></head>
  <body>
    <div class="head">
      <div>
        <div class="co-name">${escapeHtml(co.name || 'AluminIA')}</div>
        ${coMetaParts ? `<div class="co-meta">${coMetaParts}</div>` : ''}
      </div>
      <div class="doc">
        <div class="doc-title">REMISIÓN</div>
        <div class="doc-num">N° ${escapeHtml(d.number)}</div>
        <div class="doc-date">Fecha: ${fmtDate(d.date)}</div>
      </div>
    </div>

    <div class="party">
      <div class="lbl">Despachado a</div>
      <div class="val">${escapeHtml(d.beneficiary || '—')}</div>
    </div>

    <table>
      <thead>
        <tr><th style="width:26%">Referencia</th><th>Descripción</th><th class="r" style="width:16%">Cantidad</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="2">Total unidades</td><td class="r">${totalUnits.toLocaleString('es-CO')}</td></tr>
      </tfoot>
    </table>

    <div class="signs">
      <div class="sign">Despachado por</div>
      <div class="sign">Recibido por (nombre y firma)</div>
    </div>

    <div class="foot">Documento de remisión — movimiento de mercancía. Generado con AluminIA.</div>
  </body></html>`;
}

/**
 * Escribe la remisión en una ventana ya abierta y dispara la impresión.
 * La ventana debe abrirse SINCRÓNICAMENTE en el handler del click (antes de
 * cualquier await) para no caer en el bloqueador de pop-ups.
 */
export function printRemisionToWindow(win: Window, data: RemisionPrintData): void {
  win.document.open();
  win.document.write(buildHtml(data));
  win.document.close();
  win.focus();
  setTimeout(() => { try { win.print(); } catch { /* el usuario puede Ctrl+P */ } }, 350);
}
