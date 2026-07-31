import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link2 } from 'lucide-react';
import { canonicalizeRef } from '@/lib/refFamily';

interface Props {
  /** La referencia que vino en el Excel y no cruzó. */
  desde: string;
  /** Catálogo del maestro para elegir a mano. */
  knownRefs: string[];
  onElegir: (hacia: string) => void;
}

/**
 * Unir a mano una referencia que el sugeridor no encontró.
 *
 * Sin esto quedaba un callejón sin salida: si no había sugerencia, la única
 * salida era guardar la remisión con la referencia sin cruzar (no descuenta
 * stock, ensucia cobertura) o editar el Excel a mano. Caso real: "MN91-3"
 * contra "MGN91-5" — el maestro sí lo tenía, el algoritmo no lo alcanzaba.
 *
 * Lo que se elija acá queda guardado como alias, igual que una sugerencia.
 */
export default function UnirReferenciaPopover({ desde, knownRefs, onElegir }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const resultados = useMemo(() => {
    const needle = canonicalizeRef(q);
    if (!needle) {
      // Sin búsqueda: arrancar por lo que comparte los dígitos de la referencia
      // tecleada — casi siempre lo que se busca está ahí.
      const digitos = (desde.match(/\d+/) ?? [''])[0];
      if (digitos.length >= 2) {
        const cerca = knownRefs.filter((r) => r.includes(digitos));
        if (cerca.length > 0) return cerca.slice(0, 50);
      }
      return knownRefs.slice(0, 50);
    }
    return knownRefs.filter((r) => canonicalizeRef(r).includes(needle)).slice(0, 50);
  }, [q, knownRefs, desde]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 gap-1 px-2 text-[11px]"
          title={`Elegir a mano a qué referencia del maestro corresponde ${desde}`}
        >
          <Link2 className="h-3 w-3" />
          Unir a…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <p className="text-[11px] text-muted-foreground mb-2">
          ¿A qué referencia del maestro corresponde <span className="font-mono font-semibold">{desde}</span>?
        </p>
        <Input
          autoFocus
          placeholder="Buscar referencia…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-8 text-xs"
        />
        <div className="mt-2 max-h-60 overflow-y-auto">
          {resultados.length === 0 ? (
            <p className="text-[11px] text-muted-foreground py-3 text-center">
              Sin resultados. Si el producto es nuevo, crealo en Inventario.
            </p>
          ) : (
            resultados.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  onElegir(r);
                  setOpen(false);
                  setQ('');
                }}
                className="w-full text-left px-2 py-1.5 rounded text-xs font-mono hover:bg-muted"
              >
                {r}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
