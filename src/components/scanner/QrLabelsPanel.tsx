import { useState, useEffect, useMemo } from 'react';
import QRCode from 'qrcode';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { InventoryProduct } from '@/hooks/useInventoryData';
import { encodeLabelPayload } from '@/lib/qrLabel';
import { printQrLabels, type LabelRow } from '@/lib/printQrLabels';
import { Printer, Plus, Trash2, QrCode } from 'lucide-react';

interface Props {
  products: InventoryProduct[];
  onSaved?: () => void;
}

interface QueueRow {
  key: string;
  productId: string;
  reference: string;
  name: string;
  system: string | null;
  quantity: number;
  copies: number;
}

let keySeq = 0;

export default function QrLabelsPanel({ products, onSaved }: Props) {
  const { toast } = useToast();
  const [refInput, setRefInput] = useState('');
  const [formQty, setFormQty] = useState<number>(1);
  const [formCopies, setFormCopies] = useState<number>(1);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [printing, setPrinting] = useState(false);

  // Producto resuelto desde el input (case-insensitive) → alimenta el preview.
  const selected = useMemo(() => {
    const q = refInput.trim().toLowerCase();
    if (!q) return null;
    return products.find(p => (p.reference ?? '').trim().toLowerCase() === q) ?? null;
  }, [refInput, products]);

  // Cuando se resuelve un producto, prellenar la cantidad con su estándar.
  useEffect(() => {
    if (selected) {
      setFormQty(selected.units_per_package && selected.units_per_package > 0 ? Number(selected.units_per_package) : 1);
    }
  }, [selected]);

  const totalLabels = useMemo(
    () => queue.reduce((s, r) => s + Math.max(1, Math.floor(r.copies || 0)), 0),
    [queue],
  );

  const addToQueue = () => {
    if (!selected) {
      toast({ title: 'Elegí una referencia válida', description: `"${refInput}" no está en el inventario.`, variant: 'destructive' });
      return;
    }
    setQueue(prev => [
      ...prev,
      {
        key: `q${keySeq++}`,
        productId: selected.id,
        reference: selected.reference,
        name: selected.name,
        system: selected.system ?? null,
        quantity: formQty > 0 ? formQty : 1,
        copies: Math.max(1, Math.floor(formCopies || 1)),
      },
    ]);
    setRefInput('');
    setFormQty(1);
    setFormCopies(1);
  };

  const updateRow = (key: string, patch: Partial<QueueRow>) =>
    setQueue(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (key: string) =>
    setQueue(prev => prev.filter(r => r.key !== key));

  const handlePrint = async () => {
    if (queue.length === 0) return;
    setPrinting(true);
    try {
      const rows: LabelRow[] = queue.map(r => ({
        reference: r.reference,
        name: r.name,
        system: r.system,
        quantity: r.quantity > 0 ? r.quantity : 1,
        copies: Math.max(1, Math.floor(r.copies || 1)),
      }));
      await printQrLabels(rows);

      // Guardar la cantidad usada como estándar por paquete (último valor gana).
      const byProduct = new Map<string, number>();
      for (const r of queue) byProduct.set(r.productId, r.quantity > 0 ? r.quantity : 1);
      await Promise.all(
        Array.from(byProduct.entries()).map(([id, qty]) =>
          supabase.from('inventory_products').update({ units_per_package: qty } as never).eq('id', id),
        ),
      );
      onSaved?.();
    } catch (e: any) {
      toast({ title: 'No se pudo imprimir', description: e.message ?? 'Error desconocido', variant: 'destructive' });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
      {/* Columna izquierda: agregar + cola */}
      <div className="space-y-4">
        <div className="bg-white border rounded-2xl p-4">
          <div className="text-sm font-semibold mb-3">Agregar etiqueta</div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_92px_92px] gap-2 items-end">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Referencia</label>
              <Input
                value={refInput}
                onChange={e => setRefInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && selected) { e.preventDefault(); addToQueue(); } }}
                placeholder="Buscá la referencia…"
                list="qr-panel-refs"
                className="mt-1"
              />
              <datalist id="qr-panel-refs">
                {products.map(p => <option key={p.id} value={p.reference}>{p.name}</option>)}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Unds/paq.</label>
              <Input type="number" min={1} value={formQty || ''} onChange={e => setFormQty(+e.target.value)} className="mt-1 text-center font-mono" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Etiquetas</label>
              <Input type="number" min={1} value={formCopies || ''} onChange={e => setFormCopies(+e.target.value)} className="mt-1 text-center font-mono" />
            </div>
          </div>
          {refInput.trim() && !selected && (
            <p className="text-xs text-red-500 mt-2">No existe esa referencia en el inventario.</p>
          )}
          <button
            onClick={addToQueue}
            disabled={!selected}
            className="mt-3 h-10 px-4 rounded-xl bg-[#1d1d1f] text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Agregar a la cola
          </button>
        </div>

        {/* Cola de impresión */}
        {queue.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12 border border-dashed rounded-2xl bg-white">
            La cola está vacía. Agregá referencias para imprimir sus etiquetas.
          </div>
        ) : (
          <div className="bg-white border rounded-2xl overflow-hidden">
            <div className="grid grid-cols-[1fr_84px_84px_40px] gap-2 px-4 py-2.5 text-xs font-semibold text-muted-foreground bg-muted/40 border-b">
              <span>Referencia</span>
              <span className="text-center">Unds/paq.</span>
              <span className="text-center">Etiquetas</span>
              <span />
            </div>
            <div className="divide-y">
              {queue.map(r => (
                <div key={r.key} className="grid grid-cols-[1fr_84px_84px_40px] gap-2 px-4 py-2.5 items-center">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{r.reference}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.name}</div>
                  </div>
                  <Input type="number" min={1} value={r.quantity || ''} onChange={e => updateRow(r.key, { quantity: +e.target.value })} className="h-8 text-center font-mono" aria-label={`Unidades por paquete de ${r.reference}`} />
                  <Input type="number" min={1} value={r.copies || ''} onChange={e => updateRow(r.key, { copies: +e.target.value })} className="h-8 text-center font-mono" aria-label={`Etiquetas de ${r.reference}`} />
                  <button onClick={() => removeRow(r.key)} className="text-muted-foreground hover:text-red-500 flex justify-center" aria-label={`Quitar ${r.reference}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Columna derecha: preview + imprimir (sticky) */}
      <div className="lg:sticky lg:top-4 space-y-3">
        <div className="bg-white border rounded-2xl p-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <QrCode className="h-3.5 w-3.5" /> Vista previa de la etiqueta
          </div>
          <LabelPreview
            reference={selected?.reference ?? (refInput.trim() || '—')}
            name={selected?.name ?? ''}
            system={selected?.system ?? null}
            quantity={formQty > 0 ? formQty : 1}
            placeholder={!selected}
          />
          <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
            Tamaño real: 100×50&nbsp;mm. El QR lleva <code className="text-[10px]">ALU|{selected?.reference ?? 'ref'}|{formQty > 0 ? formQty : 1}</code> — al escanear suma esa cantidad sola.
          </p>
        </div>

        <div className="bg-white border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Total a imprimir</span>
            <span className="text-lg font-extrabold tabular-nums">{totalLabels}</span>
          </div>
          <button
            onClick={handlePrint}
            disabled={printing || queue.length === 0}
            className="w-full h-11 rounded-xl bg-[#1d1d1f] text-white font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-40 hover:opacity-90"
          >
            <Printer className="h-5 w-5" /> {printing ? 'Preparando…' : 'Imprimir etiquetas'}
          </button>
          <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
            Se abre el diálogo de impresión: elegí la <strong>Zebra ZD230</strong> de recepción, tamaño 100×50&nbsp;mm.
          </p>
        </div>
      </div>
    </div>
  );
}

// Mockup de la etiqueta a escala (proporción 2:1, igual que el print real).
function LabelPreview({ reference, name, system, quantity, placeholder }: {
  reference: string; name: string; system: string | null; quantity: number; placeholder?: boolean;
}) {
  const [svg, setSvg] = useState<string>('');
  const payload = encodeLabelPayload(placeholder ? 'DEMO' : reference, quantity);

  useEffect(() => {
    let active = true;
    QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 })
      .then(s => { if (active) setSvg(s); })
      .catch(() => { if (active) setSvg(''); });
    return () => { active = false; };
  }, [payload]);

  return (
    <div className={`w-full rounded-lg border bg-white shadow-sm overflow-hidden ${placeholder ? 'opacity-60' : ''}`} style={{ aspectRatio: '2 / 1' }}>
      <div className="h-full w-full flex items-center gap-3 p-3">
        <div
          className="h-full aspect-square flex-shrink-0 [&>svg]:h-full [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <div className="font-extrabold leading-none truncate" style={{ fontSize: 22, letterSpacing: '-0.5px' }}>
            {reference}
          </div>
          {name && <div className="text-[11px] text-slate-600 truncate mt-1">{name}</div>}
          <div className="flex items-center gap-2 mt-2">
            <span className="font-extrabold" style={{ fontSize: 17 }}>x{quantity} und</span>
            {system && <span className="text-[10px] font-bold bg-slate-900 text-white px-1.5 py-0.5 rounded">{system}</span>}
          </div>
          <div className="text-[9px] text-slate-400 uppercase tracking-wider mt-1.5">AluminIA</div>
        </div>
      </div>
    </div>
  );
}
