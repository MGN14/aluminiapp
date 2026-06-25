import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Printer, Plus, Trash2, QrCode } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { ProductWithMetrics } from '@/hooks/useInventoryData';
import { printQrLabels, type LabelRow } from '@/lib/printQrLabels';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ProductWithMetrics[];
  /** Se llama tras imprimir (persistimos la cantidad por paquete como default). */
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

// Cola de impresión de etiquetas QR. Una etiqueta por paquete: la cantidad de
// unidades del paquete se hornea en el QR (ALU|ref|qty) para que el escaneo en
// despacho/conteo sume solo. Pre-llenamos la cantidad con units_per_package.
export default function QrLabelsModal({ open, onOpenChange, products, onSaved }: Props) {
  const { toast } = useToast();
  const [refInput, setRefInput] = useState('');
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (open) { setRefInput(''); setQueue([]); }
  }, [open]);

  const totalLabels = useMemo(
    () => queue.reduce((s, r) => s + Math.max(1, Math.floor(r.copies || 0)), 0),
    [queue],
  );

  const addRef = (raw: string) => {
    const q = raw.trim().toLowerCase();
    if (!q) return;
    const p = products.find(x => (x.reference ?? '').trim().toLowerCase() === q);
    if (!p) {
      toast({ title: 'Referencia no encontrada', description: `"${raw}" no está en el inventario.`, variant: 'destructive' });
      return;
    }
    setQueue(prev => [
      ...prev,
      {
        key: `q${keySeq++}`,
        productId: p.id,
        reference: p.reference,
        name: p.name,
        system: p.system ?? null,
        quantity: p.units_per_package && p.units_per_package > 0 ? Number(p.units_per_package) : 1,
        copies: 1,
      },
    ]);
    setRefInput('');
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

      // Persistir la cantidad usada como "estándar por paquete" para prellenar
      // la próxima impresión de esa referencia (último valor gana si se repite).
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <QrCode className="h-4 w-4" /> Imprimir etiquetas QR
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-1">
          Una etiqueta por <strong>paquete</strong>. La cantidad que pongas queda horneada
          en el QR: al escanear en despacho o conteo, suma esa cantidad sola. Imprimí en la
          Zebra de recepción (etiqueta 100×50mm).
        </p>

        {/* Agregar referencia a la cola */}
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label className="text-sm">Agregar referencia</Label>
            <Input
              value={refInput}
              onChange={e => setRefInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRef(refInput); } }}
              placeholder="Buscá la referencia y Enter para agregar..."
              list="qr-labels-refs"
              autoFocus
            />
            <datalist id="qr-labels-refs">
              {products.map(p => <option key={p.id} value={p.reference}>{p.name}</option>)}
            </datalist>
          </div>
          <Button type="button" variant="outline" onClick={() => addRef(refInput)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Agregar
          </Button>
        </div>

        {/* Cola de impresión */}
        {queue.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8 border border-dashed rounded-lg">
            Agregá referencias para imprimir sus etiquetas.
          </div>
        ) : (
          <div className="max-h-[45vh] overflow-auto rounded-lg border divide-y">
            <div className="grid grid-cols-[1fr_88px_88px_36px] gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted/40 sticky top-0">
              <span>Referencia</span>
              <span className="text-center">Unds/paq.</span>
              <span className="text-center">Etiquetas</span>
              <span />
            </div>
            {queue.map(r => (
              <div key={r.key} className="grid grid-cols-[1fr_88px_88px_36px] gap-2 px-3 py-2 items-center">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{r.reference}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.name}</div>
                </div>
                <Input
                  type="number" min={1} value={r.quantity || ''}
                  onChange={e => updateRow(r.key, { quantity: +e.target.value })}
                  className="h-8 text-center font-mono"
                  aria-label={`Unidades por paquete de ${r.reference}`}
                />
                <Input
                  type="number" min={1} value={r.copies || ''}
                  onChange={e => updateRow(r.key, { copies: +e.target.value })}
                  className="h-8 text-center font-mono"
                  aria-label={`Cantidad de etiquetas de ${r.reference}`}
                />
                <button
                  type="button" onClick={() => removeRow(r.key)}
                  className="text-muted-foreground hover:text-red-500 flex justify-center"
                  aria-label={`Quitar ${r.reference}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-sm text-muted-foreground">
            {totalLabels} etiqueta{totalLabels === 1 ? '' : 's'} en total
          </span>
          <Button type="button" onClick={handlePrint} disabled={printing || queue.length === 0} className="gap-1.5">
            <Printer className="h-4 w-4" /> {printing ? 'Preparando...' : 'Imprimir'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
