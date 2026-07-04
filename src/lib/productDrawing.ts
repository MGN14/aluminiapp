import type { TemplateApertura, TemplateTipo } from '@/types/productTemplate';
import type { QuotationItem } from '@/types/quotation';

/**
 * Dibujo SVG paramétrico de producto terminado, estilo plano de taller:
 * marco, naves/hojas, vidrio, sentido de apertura (V punteada con vértice al
 * lado de las bisagras, convención DIN) o flechas de deslizamiento, y cotas.
 * Escala con las dimensiones reales ingresadas. Puro string — sirve para
 * renderizar en React (dangerouslySetInnerHTML) y para rasterizar a PNG
 * e incrustar en el PDF de la cotización.
 */

export interface ProductDrawingSpec {
  tipo: TemplateTipo;
  naves: number;
  apertura: TemplateApertura;
  widthM: number;
  heightM: number;
  showDims?: boolean;
}

const PAL = {
  frame: '#475569',
  frameFill: '#e2e8f0',
  sash: '#475569',
  glass: '#93c5fd',
  glassEdge: '#60a5fa',
  dash: '#64748b',
  dim: '#94a3b8',
  dimText: '#64748b',
};

const MAX_W = 260;
const MAX_H = 200;

function fmtM(n: number): string {
  return `${Number(n.toFixed(2))} m`;
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  attrs: string,
): string {
  return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" ${attrs}/>`;
}

function line(x1: number, y1: number, x2: number, y2: number, attrs: string): string {
  return `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" ${attrs}/>`;
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Triángulo de punta de flecha apuntando en dir. */
function arrowHead(x: number, y: number, dir: 'left' | 'right' | 'up' | 'down', color: string): string {
  const s = 4.5;
  let pts = '';
  if (dir === 'right') pts = `${r1(x)},${r1(y)} ${r1(x - s)},${r1(y - s / 1.6)} ${r1(x - s)},${r1(y + s / 1.6)}`;
  if (dir === 'left') pts = `${r1(x)},${r1(y)} ${r1(x + s)},${r1(y - s / 1.6)} ${r1(x + s)},${r1(y + s / 1.6)}`;
  if (dir === 'up') pts = `${r1(x)},${r1(y)} ${r1(x - s / 1.6)},${r1(y + s)} ${r1(x + s / 1.6)},${r1(y + s)}`;
  if (dir === 'down') pts = `${r1(x)},${r1(y)} ${r1(x - s / 1.6)},${r1(y - s)} ${r1(x + s / 1.6)},${r1(y - s)}`;
  return `<polygon points="${pts}" fill="${color}"/>`;
}

/** Vidrio con leve tinte + dos líneas de reflejo. */
function glassPane(x: number, y: number, w: number, h: number): string {
  if (w <= 2 || h <= 2) return '';
  const parts = [
    rect(x, y, w, h, `fill="${PAL.glass}" fill-opacity="0.32" stroke="${PAL.glassEdge}" stroke-opacity="0.55" stroke-width="0.6"`),
  ];
  // Reflejo: dos diagonales cortas arriba a la izquierda
  const d = Math.min(w, h) * 0.35;
  if (d > 6) {
    const ox = x + w * 0.16;
    const oy = y + h * 0.14;
    parts.push(
      line(ox + d * 0.5, oy, ox, oy + d * 0.5, `stroke="${PAL.glassEdge}" stroke-opacity="0.5" stroke-width="1"`),
      line(ox + d * 0.85, oy, ox, oy + d * 0.85, `stroke="${PAL.glassEdge}" stroke-opacity="0.35" stroke-width="1"`),
    );
  }
  return parts.join('');
}

/** Flecha horizontal de deslizamiento centrada en la nave. */
function slideArrow(cx: number, cy: number, len: number, dir: 'left' | 'right'): string {
  const half = len / 2;
  const x1 = cx - half;
  const x2 = cx + half;
  const tip = dir === 'right' ? x2 : x1;
  return (
    line(x1, cy, x2, cy, `stroke="${PAL.dash}" stroke-width="1.4"`) +
    arrowHead(tip, cy, dir, PAL.dash)
  );
}

/** V punteada de apertura batiente: vértice al lado de las bisagras (DIN). */
function swingV(
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  hinge: 'izquierda' | 'derecha',
): string {
  const vertexX = hinge === 'derecha' ? sx + sw : sx;
  const farX = hinge === 'derecha' ? sx : sx + sw;
  const cy = sy + sh / 2;
  const attrs = `stroke="${PAL.dash}" stroke-width="1.1" stroke-dasharray="5 4" fill="none"`;
  return line(farX, sy, vertexX, cy, attrs) + line(farX, sy + sh, vertexX, cy, attrs);
}

export function buildProductDrawing(spec: ProductDrawingSpec): {
  svg: string;
  width: number;
  height: number;
} {
  const wM = spec.widthM > 0 ? spec.widthM : 1;
  const hM = spec.heightM > 0 ? spec.heightM : 1;
  const showDims = spec.showDims ?? true;
  const naves = Math.max(1, Math.min(6, Math.round(spec.naves) || 1));
  const isDoor = spec.tipo === 'puerta_corrediza' || spec.tipo === 'puerta_batiente';

  const scale = Math.min(MAX_W / wM, MAX_H / hM);
  const dw = Math.max(56, wM * scale);
  const dh = Math.max(56, hM * scale);

  const pad = 2;
  const dimSpace = 30;
  const totalW = dw + pad * 2 + (showDims ? dimSpace : 0);
  const totalH = dh + pad * 2 + (showDims ? dimSpace : 0);

  const ft = Math.max(4, Math.min(10, 0.05 * Math.min(dw, dh))); // marco
  const parts: string[] = [];

  // ── Marco exterior ──
  parts.push(
    rect(0, 0, dw, dh, `fill="${PAL.frameFill}" stroke="${PAL.frame}" stroke-width="1.4"`),
    rect(ft, ft, dw - 2 * ft, dh - 2 * ft, `fill="none" stroke="${PAL.frame}" stroke-width="0.9"`),
  );

  const x0 = ft;
  const y0 = ft;
  const iw = dw - 2 * ft;
  const ih = dh - 2 * ft;

  if (spec.tipo === 'ventana_fija') {
    const b = Math.max(2, ft * 0.5);
    parts.push(glassPane(x0 + b, y0 + b, iw - 2 * b, ih - 2 * b));
  } else if (spec.tipo === 'ventana_corrediza' || spec.tipo === 'puerta_corrediza') {
    const panelW = iw / naves;
    const inset = 2;
    const stile = Math.max(3, ft * 0.8);
    const bottomRail = isDoor ? stile * 2.4 : stile;
    for (let i = 0; i < naves; i++) {
      const px = x0 + i * panelW;
      const sx = px + inset;
      const sy = y0 + inset;
      const sw = panelW - 2 * inset;
      const sh = ih - 2 * inset;
      parts.push(rect(sx, sy, sw, sh, `fill="none" stroke="${PAL.sash}" stroke-width="1"`));
      parts.push(glassPane(sx + stile, sy + stile, sw - 2 * stile, sh - stile - bottomRail));
      // Flechas: mitad izquierda desliza →, mitad derecha ← (se cruzan al centro)
      const dir: 'left' | 'right' = i < naves / 2 ? 'right' : 'left';
      const cy = y0 + ih / 2;
      parts.push(slideArrow(px + panelW / 2, cy, Math.min(sw * 0.5, 44), dir));
      // Manija vertical en puertas (contra el traslapo central)
      if (isDoor && naves >= 2 && (i === Math.ceil(naves / 2) - 1 || i === Math.ceil(naves / 2))) {
        const hx = i < naves / 2 ? sx + sw - stile - 3.5 : sx + stile + 3.5;
        parts.push(line(hx, cy - 11, hx, cy + 11, `stroke="${PAL.sash}" stroke-width="2.4" stroke-linecap="round"`));
      }
    }
  } else {
    // ventana_batiente | puerta_batiente
    const panelW = iw / naves;
    const inset = 2;
    const stile = Math.max(3, ft * 0.8);
    const bottomRail = isDoor ? stile * 2.4 : stile;
    for (let i = 0; i < naves; i++) {
      const px = x0 + i * panelW;
      const sx = px + inset;
      const sy = y0 + inset;
      const sw = panelW - 2 * inset;
      const sh = ih - 2 * inset;
      // Bisagras: 1 hoja usa la apertura elegida; 2+ hojas abren desde afuera (francesa)
      const hinge: 'izquierda' | 'derecha' =
        naves === 1 ? spec.apertura : i < naves / 2 ? 'izquierda' : 'derecha';
      parts.push(rect(sx, sy, sw, sh, `fill="none" stroke="${PAL.sash}" stroke-width="1"`));
      parts.push(glassPane(sx + stile, sy + stile, sw - 2 * stile, sh - stile - bottomRail));
      parts.push(swingV(sx + stile, sy + stile, sw - 2 * stile, sh - stile - bottomRail, hinge));
      if (isDoor) {
        const hx = hinge === 'derecha' ? sx + stile + 4.5 : sx + sw - stile - 4.5;
        parts.push(`<circle cx="${r1(hx)}" cy="${r1(sy + sh / 2)}" r="2.4" fill="${PAL.sash}"/>`);
      }
    }
  }

  // ── Cotas ──
  if (showDims) {
    const dAttrs = `stroke="${PAL.dim}" stroke-width="0.8"`;
    // Ancho (abajo)
    const by = dh + 12;
    parts.push(
      line(0, dh + 3, 0, by + 4, dAttrs),
      line(dw, dh + 3, dw, by + 4, dAttrs),
      line(0, by, dw, by, dAttrs),
      arrowHead(0, by, 'left', PAL.dim),
      arrowHead(dw, by, 'right', PAL.dim),
      `<text x="${r1(dw / 2)}" y="${r1(by + 12)}" text-anchor="middle" font-size="11" fill="${PAL.dimText}">${fmtM(wM)}</text>`,
    );
    // Alto (derecha)
    const rx = dw + 12;
    parts.push(
      line(dw + 3, 0, rx + 4, 0, dAttrs),
      line(dw + 3, dh, rx + 4, dh, dAttrs),
      line(rx, 0, rx, dh, dAttrs),
      arrowHead(rx, 0, 'up', PAL.dim),
      arrowHead(rx, dh, 'down', PAL.dim),
      `<text transform="translate(${r1(rx + 12)},${r1(dh / 2)}) rotate(-90)" text-anchor="middle" font-size="11" fill="${PAL.dimText}">${fmtM(hM)}</text>`,
    );
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r1(totalW)} ${r1(totalH)}" ` +
    `width="${r1(totalW)}" height="${r1(totalH)}" role="img" ` +
    `font-family="ui-sans-serif, system-ui, sans-serif">` +
    `<g transform="translate(${pad},${pad})">${parts.join('')}</g></svg>`;

  return { svg, width: totalW, height: totalH };
}

/**
 * Rasteriza el dibujo a PNG dataURL con fondo blanco (para jsPDF), ajustado
 * "contain" dentro de un canvas 4:3. Devuelve null si falla (best-effort).
 */
export async function productDrawingPng(
  spec: ProductDrawingSpec,
  pxW = 360,
  pxH = 270,
): Promise<string | null> {
  try {
    const { svg } = buildProductDrawing({ ...spec, showDims: false });
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('svg load failed'));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pxW, pxH);
    const iw = img.width || pxW;
    const ih = img.height || pxH;
    const s = Math.min((pxW - 12) / iw, (pxH - 12) / ih);
    const dw = iw * s;
    const dh = ih * s;
    ctx.drawImage(img, (pxW - dw) / 2, (pxH - dh) / 2, dw, dh);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * Mapea items de cotización al formato del PDF, rasterizando el esquema de
 * las líneas que vienen de plantilla (template_snapshot). Compartido por
 * QuoteDetailModal (descargar) y SendQuoteDialog (email/WhatsApp).
 */
export async function quotationItemsForPdf(items: QuotationItem[]) {
  return Promise.all(
    items.map(async (it) => ({
      description: it.description ?? null,
      system: it.system,
      color: it.color,
      width_m: Number(it.width_m),
      height_m: Number(it.height_m),
      quantity: Number(it.quantity),
      area_m2: Number(it.area_m2),
      price_per_m2: Number(it.price_per_m2),
      line_subtotal: Number(it.line_subtotal),
      drawingPng: it.template_snapshot
        ? await productDrawingPng({
            tipo: it.template_snapshot.tipo,
            naves: it.template_snapshot.naves,
            apertura: it.template_snapshot.apertura,
            widthM: Number(it.width_m),
            heightM: Number(it.height_m),
          })
        : null,
    })),
  );
}
