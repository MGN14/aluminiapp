import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Delete, Check } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  description?: string;
  initial?: number;
  /** Permite coma decimal (p. ej. peso por pieza: 2,35 kg). */
  decimal?: boolean;
  onClose: () => void;
  onSubmit: (value: number) => void;
}

/**
 * Teclado numérico propio, con botones grandes. No usamos el teclado del iPad:
 * con la pistola Bluetooth conectada (es un "teclado"), iPadOS lo esconde.
 */
export default function NumPad({ open, title, description, initial, decimal = false, onClose, onSubmit }: Props) {
  // Arranca VACÍO: lo que se escribe reemplaza el número actual (que se ve
  // en gris como referencia). Si arrancara con el actual, tocar "8" sobre un
  // 3 daría 38.
  const [value, setValue] = useState('');
  useEffect(() => { if (open) setValue(''); }, [open]);

  const press = (d: string) => setValue((v) => {
    if (v.length >= 8) return v;
    if (d === ',') return v.includes(',') ? v : (v || '0') + ',';
    return v === '0' ? d : v + d;
  });
  const back = () => setValue((v) => v.slice(0, -1));
  const ok = () => {
    if (value === '') { onClose(); return; } // Listo sin escribir = no cambia nada
    const n = Number(value.replace(',', '.'));
    onSubmit(Number.isFinite(n) ? n : 0);
  };

  const key = 'h-16 rounded-2xl border border-border bg-card text-2xl font-bold tabular-nums active:scale-95 active:bg-muted transition-transform select-none';
  const inicial = initial != null ? String(initial).replace('.', ',') : '0';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg">{title}</DialogTitle>
          {description && <DialogDescription className="text-sm">{description}</DialogDescription>}
        </DialogHeader>
        <div className="rounded-2xl border border-border bg-muted/50 px-4 py-3 text-right text-4xl font-extrabold tabular-nums min-h-[64px]" aria-live="polite">
          {value || <span className="text-muted-foreground">{inicial}</span>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" className={key} onClick={() => press(d)}>{d}</button>
          ))}
          <button type="button" className={`${key} flex items-center justify-center`} onClick={back} aria-label="Borrar">
            <Delete className="h-6 w-6" />
          </button>
          <button type="button" className={key} onClick={() => press('0')}>0</button>
          {decimal ? (
            <button type="button" className={key} onClick={() => press(',')} aria-label="Coma decimal">,</button>
          ) : (
            <button
              type="button"
              className="h-16 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform select-none"
              onClick={ok}
            >
              <Check className="h-6 w-6" /> Listo
            </button>
          )}
          {decimal && (
            <button
              type="button"
              className="col-span-3 h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform select-none"
              onClick={ok}
            >
              <Check className="h-6 w-6" /> Listo
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
