/**
 * CIERRE DE INVENTARIO — el "cerrar caja" del inventario por variante.
 *
 * Bodega sube el conteo → borrador con las diferencias contra el teórico →
 * el admin revisa, corrige errores de conteo y CONFIRMA → el conteo queda
 * como nueva fuente de verdad y el reporte se archiva.
 *
 * El ledger NO se borra: la historia de movimientos (lo que alimenta el
 * análisis de rotación y de cuándo montar pedido) queda intacta; el conteo
 * solo pone un ancla nueva y desde ahí vuelven a contar contenedores y
 * remisiones.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck, Upload, Loader2, Check, X, AlertTriangle, History, ChevronDown, ChevronRight,
  FileSpreadsheet, Download, Eye, User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/usePermissions';
import { readXlsxFile, isExcelFile } from '@/lib/readXlsx';
import { parseMaestra } from '@/hooks/useInventoryVariants';
import { useInventoryCount, fetchCountLines, syncTeoricoBorrador, type CountLine, type CountSession } from '@/hooks/useInventoryCount';
import { calcularLineas, totalizar, exportCountToExcel } from '@/lib/inventoryCountExport';
import CountDiffView from './CountDiffView';
import { cn } from '@/lib/utils';

const fmt = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
const hoyIso = () => new Date().toISOString().slice(0, 10);
const esNoContada = (l: CountLine) => (l.nota ?? '').includes('no vino en el archivo');

export default function InventoryCountClosing() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isAdmin } = usePermissions();
  const {
    sessions, borrador, lineasBorrador, lineasPending,
    crearBorrador, editarLinea, confirmarCierre, descartarBorrador, useLineasDe,
  } = useInventoryCount();

  const fileRef = useRef<HTMLInputElement>(null);
  const [fechaConteo, setFechaConteo] = useState(hoyIso());
  // Abierto por defecto: el dueño tiene que poder ver qué hizo bodega sin
  // salir a buscarlo (reporte de Nico 2026-08-24).
  const [verHistorial, setVerHistorial] = useState(true);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [exportando, setExportando] = useState<string | null>(null);

  // El teórico del borrador se congela al crearlo; si después cambió la fecha
  // de corte o se recuadró, quedaba comparando contra un número viejo (los
  // "$410M de faltante" del 2026-08-05). Al abrir el borrador se
  // re-sincroniza contra el stock VIVO de la fórmula, una vez por sesión.
  const sincronizado = useRef<string | null>(null);
  useEffect(() => {
    if (!borrador || lineasPending || sincronizado.current === borrador.id) return;
    sincronizado.current = borrador.id;
    syncTeoricoBorrador(borrador.id)
      .then((n) => {
        if (n > 0) {
          qc.invalidateQueries({ queryKey: ['inventory-count-lines'] });
          toast({
            title: `Teórico actualizado en ${n} referencia(s)`,
            description: 'El borrador quedó comparando contra el stock actual (la fecha de corte o el recuadre lo habían movido).',
            duration: 8000,
          });
        }
      })
      .catch(() => { /* best-effort: la tabla igual se muestra */ });
  }, [borrador, lineasPending, qc, toast]);

  // Pantalla, diálogo de confirmación y Excel salen del MISMO cálculo.
  // Lo que no vino en el archivo ya llega con contado 0 desde el borrador
  // (regla de Nico 2026-08-04: si Yolis no lo puso, no hay).
  const calc = useMemo(() => calcularLineas(lineasBorrador), [lineasBorrador]);
  const resumen = useMemo(() => ({
    ...totalizar(calc),
    noContadas: lineasBorrador.filter(esNoContada).length,
  }), [calc, lineasBorrador]);


  async function onFile(file: File) {
    try {
      if (!isExcelFile(file)) {
        toast({ title: 'Archivo no válido', description: 'Subí un Excel (.xlsx/.xls).', variant: 'destructive' });
        return;
      }
      const sheets = await readXlsxFile(file);
      let parsed = parseMaestra(sheets[0]?.rows ?? []);
      for (let i = 1; i < sheets.length && parsed.error; i++) parsed = parseMaestra(sheets[i].rows);
      if (parsed.error) {
        toast({ title: 'No pude leer el conteo', description: parsed.error, variant: 'destructive' });
        return;
      }
      const r = await crearBorrador.mutateAsync({ filas: parsed.data, fechaConteo });
      toast({
        title: 'Conteo cargado como borrador',
        description: `${parsed.data.length} referencias contadas · ${r.lineas} líneas para revisar. El inventario NO se tocó todavía.`,
        duration: 9000,
      });
    } catch (e) {
      toast({ title: 'Error subiendo el conteo', description: (e as Error).message, variant: 'destructive' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onConfirmar() {
    if (!borrador) return;
    const ok = window.confirm(
      `Confirmar el cierre de inventario del ${borrador.fecha_conteo}:\n\n` +
      `· ${resumen.conDif} referencia(s) con diferencia\n` +
      `· Faltantes: ${fmt(Math.abs(resumen.unidadesFaltan))} und (${fmtCOP(Math.abs(resumen.valorFaltan))})\n` +
      `· Sobrantes: ${fmt(resumen.unidadesSobran)} und (${fmtCOP(resumen.valorSobran)})\n` +
      (resumen.noContadas > 0 ? `· Las ${resumen.noContadas} que NO vinieron en el archivo quedan en 0 (si no se contó, no hay)\n` : '') +
      `\nEl conteo pasa a ser la fuente de verdad y la fecha de corte se mueve al ${borrador.fecha_conteo}: remisiones y contenedores POSTERIORES vuelven a mover el saldo desde ahí. La historia no se borra.\n\n¿Continuar?`,
    );
    if (!ok) return;
    try {
      const r = await confirmarCierre.mutateAsync({ sessionId: borrador.id });
      qc.invalidateQueries({ queryKey: ['inventory-variants'] });
      toast({
        title: 'Inventario cerrado',
        description: `${r.ancladas} referencias ancladas al conteo · ${r.conDiferencia} con diferencia (${fmtCOP(r.totalValor)}). El reporte quedó archivado.`,
        duration: 12000,
      });
    } catch (e) {
      toast({ title: 'No se pudo cerrar', description: (e as Error).message, variant: 'destructive' });
    }
  }

  /** Excel del borrador vivo (lo que hay en pantalla, con el mismo cálculo). */
  async function onExportarBorrador() {
    if (!borrador) return;
    setExportando('borrador');
    try {
      await exportCountToExcel({ fecha_conteo: borrador.fecha_conteo, estado: 'borrador' }, lineasBorrador);
    } catch (e) {
      toast({ title: 'No se pudo exportar', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setExportando(null);
    }
  }

  /** Excel de un cierre ya confirmado: el soporte del ajuste para el contador. */
  async function onExportarCierre(s: CountSession) {
    setExportando(s.id);
    try {
      const lineas = await fetchCountLines(s.id);
      await exportCountToExcel(s, lineas);
    } catch (e) {
      toast({ title: 'No se pudo exportar', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setExportando(null);
    }
  }

  const confirmados = sessions.filter((s) => s.estado === 'confirmado');

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-primary" /> Cierre de inventario
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              Como cerrar caja: bodega sube el conteo, la app muestra las diferencias contra lo que
              debería haber, y al confirmar (solo admin) ese conteo queda como la verdad nueva.
              <strong> No se borra la historia</strong> — el análisis de rotación por referencia sigue
              intacto; solo se pone un ancla y desde ahí vuelven a contar remisiones y contenedores.
            </p>
          </div>
          {!borrador && (
            <div className="flex items-end gap-2">
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">Fecha del conteo</label>
                <Input type="date" value={fechaConteo} max={hoyIso()}
                  onChange={(e) => setFechaConteo(e.target.value)} className="h-9 w-40 text-xs" />
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={crearBorrador.isPending}>
                {crearBorrador.isPending
                  ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Leyendo…</>
                  : <><Upload className="h-4 w-4 mr-1" /> Subir conteo de bodega</>}
              </Button>
            </div>
          )}
        </div>

        {borrador && (
          <>
            <div className="rounded-lg border border-amber-400/50 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2 text-xs flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Borrador del {borrador.fecha_conteo} — sin aplicar.</strong> El inventario sigue
                como estaba. Revisá las diferencias y confirmá para que este conteo mande.
              </span>
            </div>

            <CountDiffView
              lineas={lineasBorrador}
              cargando={lineasPending}
              onEditarLinea={(id, stock_contado) => editarLinea.mutate({ id, stock_contado })}
              acciones={
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-8 text-xs"
                    onClick={onExportarBorrador} disabled={exportando === 'borrador'}
                    title="Descarga el reporte de diferencias en Excel (con el costo de cada faltante/sobrante)">
                    {exportando === 'borrador'
                      ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Armando…</>
                      : <><FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Exportar Excel</>}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs"
                    onClick={() => { if (window.confirm('¿Descartar este borrador? El inventario no se toca.')) descartarBorrador.mutate(borrador.id); }}>
                    <X className="h-3.5 w-3.5 mr-1" /> Descartar
                  </Button>
                  <Button size="sm" className="h-8 text-xs" onClick={onConfirmar}
                    disabled={!isAdmin || confirmarCierre.isPending}
                    title={isAdmin ? 'Aplica el conteo como fuente de verdad' : 'Solo el admin puede confirmar un cierre'}>
                    {confirmarCierre.isPending
                      ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Cerrando…</>
                      : <><Check className="h-3.5 w-3.5 mr-1" /> Confirmar cierre</>}
                  </Button>
                </div>
              }
            />
            {!isAdmin && (
              <p className="text-[11px] text-muted-foreground">
                El conteo quedó guardado. Un admin tiene que revisarlo y confirmarlo para que aplique.
              </p>
            )}
          </>
        )}
      </div>

      {confirmados.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <button className="flex items-center gap-2 text-sm font-semibold"
            onClick={() => setVerHistorial((v) => !v)}>
            {verHistorial ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <History className="h-4 w-4 text-muted-foreground" />
            Cierres anteriores ({confirmados.length})
          </button>
          {verHistorial && (
            <div className="mt-3 space-y-1.5">
              {confirmados.map((s) => (
                <CierreRow
                  key={s.id}
                  sesion={s}
                  abierto={detalleId === s.id}
                  onToggle={() => setDetalleId(detalleId === s.id ? null : s.id)}
                  onExportar={() => onExportarCierre(s)}
                  exportando={exportando === s.id}
                  useLineasDe={useLineasDe}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Fila de un cierre confirmado, expandible al detalle completo de diferencias.
 *
 * Antes esto era una línea con un ícono de descarga y nada más: al confirmarse
 * un conteo, la única forma de ver qué había pasado era bajar un Excel — y el
 * dueño ni sabía que existía. Ahora el detalle se abre en la misma pantalla,
 * con la misma tabla que se usó para revisar el borrador.
 */
function CierreRow({ sesion, abierto, onToggle, onExportar, exportando, useLineasDe }: {
  sesion: CountSession;
  abierto: boolean;
  onToggle: () => void;
  onExportar: () => void;
  exportando: boolean;
  useLineasDe: (id: string | null) => { data?: CountLine[]; isPending: boolean };
}) {
  // La query solo corre cuando la fila está abierta.
  const lineasQ = useLineasDe(abierto ? sesion.id : null);
  const neto = Number(sesion.total_valor_diferencia);

  return (
    <div className="rounded-lg border border-border/60">
      <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium">Conteo del {sesion.fecha_conteo}</span>
          {sesion.confirmado_at && (
            <span className="text-muted-foreground flex items-center gap-1" title="Quién y cuándo lo confirmó">
              <User className="h-3 w-3" />
              confirmado {new Date(sesion.confirmado_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
            </span>
          )}
        </div>
        <span className="text-muted-foreground">
          {fmt(sesion.total_referencias)} refs · {fmt(sesion.total_con_diferencia)} con diferencia
        </span>
        <div className="flex items-center gap-2">
          <span className={cn('font-mono font-semibold tabular-nums',
            neto < 0 ? 'text-destructive' : 'text-success')}>
            {fmtCOP(neto)}
          </span>
          <Button size="sm" variant={abierto ? 'secondary' : 'outline'} className="h-7 px-2 text-xs gap-1"
            onClick={onToggle}
            title="Ver las diferencias de este conteo en pantalla">
            <Eye className="h-3.5 w-3.5" />
            {abierto ? 'Ocultar' : 'Ver diferencias'}
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1"
            onClick={onExportar} disabled={exportando}
            title="Descargar el reporte de este cierre en Excel">
            {exportando
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <><Download className="h-3.5 w-3.5" /> Excel</>}
          </Button>
        </div>
      </div>
      {abierto && (
        <div className="border-t border-border/60 p-3 space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Este conteo ya está aplicado: el inventario arranca de acá. Abajo, lo que bodega
            contó contra lo que la app decía que debía haber en ese momento.
          </p>
          <CountDiffView lineas={lineasQ.data ?? []} cargando={lineasQ.isPending} />
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, hint, tone, onClick, activo }: {
  label: string; value: string; hint?: string; tone?: 'red' | 'green' | 'amber';
  /** Clic = filtrar la tabla por esa categoría. */
  onClick?: () => void; activo?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      title={onClick ? (activo ? 'Clic para ver todas las diferencias' : 'Clic para ver solo estas en la tabla') : undefined}
      className={cn('rounded-lg border px-3 py-2 text-left w-full',
        onClick && 'cursor-pointer transition-colors hover:brightness-95',
        activo && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        tone === 'red' ? 'border-destructive/30 bg-destructive/[0.04]'
          : tone === 'green' ? 'border-success/30 bg-success/[0.04]'
            : tone === 'amber' ? 'border-amber-400/40 bg-amber-50/50 dark:bg-amber-950/10'
              : 'border-border bg-muted/20')}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground font-mono">{hint}</p>}
    </Tag>
  );
}
