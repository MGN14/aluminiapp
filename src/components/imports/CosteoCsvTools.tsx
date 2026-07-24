import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Upload, Scale, PackageCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useImportItems, type NewImportItem } from '@/hooks/useImportItems';
import { applyImportKardex } from '@/lib/importKardexEntry';

const fmtUSD = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const fmtCOP = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

/**
 * Herramientas del costeo real del contenedor:
 * 1. Subir CSV del packing list (referencia,cantidad,peso_kg,fob_usd[,descripcion])
 *    → llena import_items de una, sin digitar.
 * 2. Diferencia REGISTRADO vs REAL: total FOB del CSV vs la mercancía
 *    registrada en el pedido — independiente de los abonos.
 * 3. Aplicar el landed cost por referencia al inventario (cost_per_unit)
 *    — cierra el loop importación → inventario → Rentabilidad.
 */
export default function CosteoCsvTools({ importId, montoTotalUsd }: {
  importId: string;
  montoTotalUsd: number | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  // effectiveItems: packing definitivo si existe, si no proforma — el FOB
  // registrado se compara contra el set que realmente costea.
  const { effectiveItems: items, landed, addItems } = useImportItems(importId);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<{ updated: number; missing: string[] } | null>(null);

  // ── 1. CSV upload ──────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    const text = await file.text();
    const sep = text.includes(';') && !text.split('\n')[0]?.includes(',') ? ';' : ',';
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    // Header opcional: si la primera línea no tiene números en col 2-4, es header
    const first = lines[0].split(sep);
    const hasHeader = first.slice(1, 4).every(c => isNaN(Number(c.replace(/[.,]/g, ''))) || c.trim() === '');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const parseNum = (s: string | undefined): number => {
      if (!s) return 0;
      let t = s.trim().replace(/[$\s]/g, '');
      // "1.234,56" (es-CO) → 1234.56 ; "1,234.56" → 1234.56
      if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
      else t = t.replace(/,/g, '');
      const n = Number(t);
      return isNaN(n) ? 0 : n;
    };

    const rows: NewImportItem[] = [];
    const errores: number[] = [];
    dataLines.forEach((line, i) => {
      const cols = line.split(sep);
      const reference = (cols[0] ?? '').trim();
      const cantidad = parseNum(cols[1]);
      const peso = parseNum(cols[2]);
      const fob = parseNum(cols[3]);
      if (!reference || cantidad <= 0 || fob <= 0) {
        errores.push(i + (hasHeader ? 2 : 1));
        return;
      }
      rows.push({
        reference,
        cantidad,
        unidad: 'kg',
        peso_kg: peso > 0 ? peso : null,
        fob_total_usd: fob,
        descripcion: (cols[4] ?? '').trim() || null,
        notas: null,
      } as NewImportItem);
    });

    if (!rows.length) {
      toast({
        title: 'CSV sin filas válidas',
        description: 'Formato esperado: referencia, cantidad, peso_kg, fob_usd, descripción (opcional). Separador coma o punto y coma.',
        variant: 'destructive',
      });
      return;
    }
    await addItems.mutateAsync(rows);
    if (errores.length) {
      toast({
        title: `${rows.length} referencias cargadas — ${errores.length} filas saltadas`,
        description: `Filas con datos incompletos: ${errores.slice(0, 8).join(', ')}${errores.length > 8 ? '…' : ''}`,
      });
    }
  };

  // ── 2. Diferencia registrado vs real ──────────────────────────────────
  const fobReal = landed?.totals.fob_total_usd ?? 0;
  const registrado = Number(montoTotalUsd ?? 0);
  const diff = fobReal - registrado;
  const diffPct = registrado > 0 ? (diff / registrado) * 100 : null;
  const hayDiff = items.length > 0 && registrado > 0 && Math.abs(diff) > 1;

  // ── 3. Aplicar el costo al inventario (respaldo del automático) ────────
  // La entrada corre SOLA al marcar 'entregado' y al aplicar el excel del
  // cierre — este botón queda para correcciones. Comparte la misma lib:
  // agrupa por familia -5, excel manda / landed fallback, idempotente.
  const aplicarAlInventario = async () => {
    if (items.length === 0) return;
    setApplying(true);
    try {
      let res = await applyImportKardex(importId);
      if (res.skipped) {
        if (!window.confirm(
          'Este contenedor YA tiene entrada en el inventario. ¿Reversarla y re-aplicar con el costo actual (excel/landed)? El promedio ponderado se recalcula.'
        )) { setApplying(false); return; }
        res = await applyImportKardex(importId, { reapply: true });
      }
      setApplied({ updated: res.applied, missing: [...res.missing, ...res.sinCosto] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-costs-map'] });
      toast({
        title: `Entrada registrada: ${res.applied} referencia(s) al kardex`,
        description: res.missing.length || res.sinCosto.length
          ? [
              res.missing.length ? `Sin producto en inventario: ${res.missing.slice(0, 5).join(', ')}${res.missing.length > 5 ? '…' : ''}` : null,
              res.sinCosto.length ? `Sin costo (ni excel ni landed): ${res.sinCosto.slice(0, 5).join(', ')}${res.sinCosto.length > 5 ? '…' : ''}` : null,
            ].filter(Boolean).join(' · ')
          : 'Stock sumado y costo promedio recalculado. Rentabilidad ya ve el costo real.',
        ...(res.missing.length || res.sinCosto.length ? { duration: 12000 } : {}),
      });
    } catch (e) {
      toast({ title: 'Error al aplicar al inventario', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-2 mb-3">
      {/* Acciones */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => fileRef.current?.click()} disabled={addItems.isPending}>
          <Upload className="h-3.5 w-3.5" />
          {addItems.isPending ? 'Cargando…' : 'Subir CSV del contenedor'}
        </Button>
        <Button
          size="sm" variant="outline" className="h-8 text-xs gap-1.5 border-success/40 text-success hover:bg-success/10"
          onClick={aplicarAlInventario}
          disabled={applying || items.length === 0}
          title="Respaldo del automático (corre solo al marcar entregado / aplicar el excel). Agrupa por familia -5; el costo del excel manda, landed como fallback."
        >
          <PackageCheck className="h-3.5 w-3.5" />
          {applying ? 'Aplicando…' : 'Aplicar costo al inventario'}
        </Button>
        <span className="text-[10px] text-muted-foreground">
          CSV: referencia, cantidad, peso_kg, fob_usd, descripción (opcional)
        </span>
      </div>

      {/* Diferencia registrado vs real — independiente de los abonos */}
      {items.length > 0 && registrado > 0 && (
        <div className={cn(
          'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
          hayDiff ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20' : 'border-success/25 bg-success/5',
        )}>
          {hayDiff
            ? <Scale className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
            : <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />}
          <span>
            <strong>Registrado vs real:</strong> mercancía registrada {fmtUSD(registrado)} · FOB del costeo {fmtUSD(fobReal)}
            {hayDiff ? (
              <> → diferencia <strong>{diff > 0 ? '+' : ''}{fmtUSD(diff)}</strong>{diffPct != null && ` (${diff > 0 ? '+' : ''}${diffPct.toFixed(1)}%)`}.
              {diff > 0 ? ' El costeo real supera lo registrado — revisá si falta actualizar la mercancía del pedido o si el proveedor facturó de más.' : ' Lo registrado supera el costeo — ¿faltan referencias en el CSV o el pedido incluye ítems no costeados?'}</>
            ) : ' — cuadran ✓'}
          </span>
        </div>
      )}

      {applied && applied.missing.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
          <span>
            Sin inventario: <span className="font-mono">{applied.missing.join(', ')}</span> — crealas en Inventarios y volvé a aplicar.
          </span>
        </div>
      )}
    </div>
  );
}
