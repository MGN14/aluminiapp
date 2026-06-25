import { useState, useRef, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { useScannerGun } from '@/hooks/useScannerGun';
import { parseScan, encodeLabelPayload, type ScannedLabel } from '@/lib/qrLabel';
import { beep } from '@/lib/scanFeedback';
import { Check, RadioTower } from 'lucide-react';

// QR de prueba (en pantalla) para validar la pistola sin imprimir nada.
const DEMOS = [
  { label: 'Etiqueta completa (LPN)', payload: encodeLabelPayload('SA325B', 40, 'A1', 'SA325B-0042') },
  { label: 'Sin serial', payload: encodeLabelPayload('744-100', 6, 'B4') },
  { label: 'Solo referencia + cantidad', payload: encodeLabelPayload('8025-300', 12) },
];

export default function ProbarPistolaPanel() {
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<{ raw: string; parsed: ScannedLabel | null } | null>(null);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);

  const onScan = useCallback((raw: string) => {
    setCount(c => c + 1);
    setLast({ raw, parsed: parseScan(raw) });
    setFlash(true);
    beep('ok');
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 800);
  }, []);
  useScannerGun({ onScan, enabled: true });

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Apuntá la pistola a un QR <strong>de esta pantalla</strong> y dispará. Si la lectura aparece abajo, lee y “teclea” en la app — sin imprimir nada.
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

      {/* QR de prueba */}
      <div>
        <div className="text-sm font-semibold mb-2">Escaneá cualquiera de estos (en la pantalla):</div>
        <div className="grid sm:grid-cols-3 gap-3">
          {DEMOS.map(d => <QrBox key={d.payload} payload={d.payload} label={d.label} />)}
        </div>
      </div>

      <div className="text-xs text-muted-foreground bg-slate-50 border rounded-xl p-3 leading-relaxed">
        <strong>¿No aparece nada al escanear?</strong> La pistola tiene que estar en modo <strong>Bluetooth HID</strong> (se conecta como un teclado). Si pita pero no escribe acá, está en otro modo — revisá su manual para pasarla a HID.
        <br /><strong>¿Lee y aparece la referencia/cantidad?</strong> 🎯 Andamos — comprá la impresora y los rollos.
      </div>
    </div>
  );
}

function QrBox({ payload, label }: { payload: string; label: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let active = true;
    QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
      .then(s => { if (active) setSvg(s); })
      .catch(() => { if (active) setSvg(''); });
    return () => { active = false; };
  }, [payload]);
  return (
    <div className="bg-white border rounded-2xl p-4 flex flex-col items-center gap-2">
      <div className="h-44 w-44 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="text-sm font-semibold text-center">{label}</div>
      <div className="text-[10px] font-mono text-muted-foreground break-all text-center">{payload}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground w-28 flex-shrink-0">{k}</span>
      <span className="font-semibold min-w-0">{v}</span>
    </div>
  );
}
