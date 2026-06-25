import { useState, useRef, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { useScannerGun } from '@/hooks/useScannerGun';
import { parseScan, encodeLabelPayload, type ScannedLabel } from '@/lib/qrLabel';
import { beep } from '@/lib/scanFeedback';
import { Check, RadioTower, Maximize2, X, Printer } from 'lucide-react';

// Abre el diálogo de impresión (el de siempre) con los códigos de barras de
// prueba en papel — la pistola láser los lee mejor en papel que en pantalla.
function printTestBarcodes(values: string[]) {
  const imgs = values.map(v => {
    const canvas = document.createElement('canvas');
    try { JsBarcode(canvas, v, { format: 'CODE128', width: 2, height: 90, fontSize: 18, margin: 12, displayValue: true }); }
    catch { return ''; }
    return canvas.toDataURL('image/png');
  }).filter(Boolean);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Códigos de prueba</title>
<style>@page{margin:16mm} *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111} h2{font-size:16pt;margin:0 0 4px} p{font-size:11pt;color:#555;margin:0 0 14px} .code{margin:16px 0;page-break-inside:avoid} img{display:block}</style>
</head><body>
<h2>Códigos de prueba — escanealos con la pistola</h2>
<p>Si pita y el texto aparece en la app, tu pistola sirve para el sistema.</p>
${imgs.map(src => `<div class="code"><img src="${src}" /></div>`).join('')}
</body></html>`;
  const win = window.open('', '_blank', 'width=820,height=1040');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { try { win.print(); } catch { /* el usuario puede Ctrl+P */ } }, 350);
}

// QR de prueba (en pantalla) para validar la pistola sin imprimir nada.
const DEMOS = [
  { label: 'Etiqueta completa (LPN)', payload: encodeLabelPayload('SA325B', 40, 'A1', 'SA325B-0042') },
  { label: 'Sin serial', payload: encodeLabelPayload('744-100', 6, 'B4') },
  { label: 'Solo referencia + cantidad', payload: encodeLabelPayload('8025-300', 12) },
];

// Códigos de barras 1D (Code128) para pistolas láser que NO leen QR.
const BARCODES = ['744-100', 'ALU|744-100|6', 'SA325B-0042'];

export default function ProbarPistolaPanel() {
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<{ raw: string; parsed: ScannedLabel | null } | null>(null);
  const [flash, setFlash] = useState(false);
  const [zoom, setZoom] = useState<{ kind: 'qr' | 'barcode'; value: string } | null>(null);
  const flashTimer = useRef<number | null>(null);

  const onScan = useCallback((raw: string) => {
    setCount(c => c + 1);
    setLast({ raw, parsed: parseScan(raw) });
    setFlash(true);
    beep('ok');
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 900);
  }, []);
  useScannerGun({ onScan, enabled: true });

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Apuntá la pistola a un código <strong>de esta pantalla</strong> y dispará. <strong>Tocá un código para agrandarlo a pantalla completa</strong> (máximo contraste) — así la pistola lo lee más fácil.
      </p>

      {/* Lectura en vivo */}
      <div className={`rounded-2xl border-2 px-5 py-5 transition-colors ${flash ? 'border-emerald-400 bg-emerald-50/50' : 'border-dashed border-slate-300 bg-white'}`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`h-12 w-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${flash ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
            {flash ? <Check className="h-6 w-6" /> : <RadioTower className="h-6 w-6 animate-pulse" />}
          </div>
          <div>
            <div className="text-lg font-bold">{last ? '¡Lectura recibida!' : 'Esperando escaneo…'}</div>
            <div className="text-sm text-muted-foreground">{count} escaneo{count === 1 ? '' : 's'} en esta sesión</div>
          </div>
        </div>
        {last && (
          <div className="space-y-1.5 text-sm border-t pt-3">
            <Row k="Texto crudo" v={<span className="font-mono break-all">{last.raw}</span>} />
            <Row k="Referencia" v={last.parsed?.reference ?? '—'} />
            <Row k="Cantidad" v={String(last.parsed?.quantity ?? '—')} />
            <Row k="Ubicación" v={last.parsed?.location ?? '—'} />
            <Row k="Serial" v={last.parsed?.serial ?? '—'} />
          </div>
        )}
      </div>

      {/* QR (2D) */}
      <div>
        <div className="text-sm font-semibold mb-2">QR (2D) — tocá para agrandar:</div>
        <div className="grid sm:grid-cols-3 gap-3">
          {DEMOS.map(d => (
            <CodeCard key={d.payload} label={d.label} onClick={() => setZoom({ kind: 'qr', value: d.payload })}>
              <QrImg payload={d.payload} className="h-44 w-44" />
            </CodeCard>
          ))}
        </div>
      </div>

      {/* Códigos de barras 1D */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-sm font-semibold">Códigos de barras (1D) — tu pistola lee estos:</div>
          <button
            onClick={() => printTestBarcodes(BARCODES)}
            className="h-9 px-3 rounded-xl border bg-white text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-slate-50 flex-shrink-0"
          >
            <Printer className="h-4 w-4" /> Imprimir
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">Imprimilos en papel y escanealos — el láser lee mucho mejor en papel que en pantalla.</p>
        <div className="grid sm:grid-cols-3 gap-3">
          {BARCODES.map(b => (
            <CodeCard key={b} onClick={() => setZoom({ kind: 'barcode', value: b })}>
              <div className="overflow-hidden w-full flex justify-center"><Barcode value={b} /></div>
            </CodeCard>
          ))}
        </div>
      </div>

      <div className="text-xs text-muted-foreground bg-slate-50 border rounded-xl p-3 leading-relaxed">
        <strong>¿No aparece nada al escanear?</strong> La pistola tiene que estar en modo <strong>Bluetooth HID</strong> (se conecta como un teclado). Si pita pero no escribe acá, está en otro modo — revisá su manual para pasarla a HID.
        <br /><strong>¿Lee y aparece la referencia/cantidad?</strong> 🎯 Andamos.
      </div>

      {/* Pantalla completa: código grande + máximo contraste */}
      {zoom && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center p-6">
          <button
            onClick={() => setZoom(null)}
            className="absolute top-4 right-4 h-11 px-4 rounded-xl border bg-white text-sm font-semibold inline-flex items-center gap-2 shadow-sm"
          >
            <X className="h-4 w-4" /> Cerrar
          </button>
          <div className={`mb-6 text-base font-bold px-4 py-2 rounded-xl ${flash ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {flash ? `✓ ¡Leído!  ${last?.raw ?? ''}` : 'Apuntá la pistola a este código…'}
          </div>
          {zoom.kind === 'qr'
            ? <QrImg payload={zoom.value} className="w-[min(86vw,68vh)] h-[min(86vw,68vh)]" />
            : <div className="w-full max-w-4xl flex justify-center"><Barcode value={zoom.value} big /></div>}
        </div>
      )}
    </div>
  );
}

function CodeCard({ label, onClick, children }: { label?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="bg-white border rounded-2xl p-3 flex flex-col items-center gap-2 hover:border-violet-400 hover:shadow-sm transition active:scale-[0.99] relative">
      <span className="absolute top-2 right-2 text-muted-foreground"><Maximize2 className="h-3.5 w-3.5" /></span>
      {children}
      {label && <div className="text-sm font-semibold text-center">{label}</div>}
    </button>
  );
}

function QrImg({ payload, className }: { payload: string; className?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let active = true;
    QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
      .then(s => { if (active) setSvg(s); })
      .catch(() => { if (active) setSvg(''); });
    return () => { active = false; };
  }, [payload]);
  return <div className={`[&>svg]:h-full [&>svg]:w-full ${className || ''}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Barcode({ value, big }: { value: string; big?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        width: big ? 4 : 2,
        height: big ? 220 : 64,
        fontSize: big ? 30 : 13,
        margin: big ? 16 : 6,
        displayValue: true,
      });
    } catch { /* valor no codificable */ }
  }, [value, big]);
  return <svg ref={ref} className="max-w-full h-auto" />;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground w-28 flex-shrink-0">{k}</span>
      <span className="font-semibold min-w-0">{v}</span>
    </div>
  );
}
