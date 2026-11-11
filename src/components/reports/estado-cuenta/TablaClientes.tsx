/**
 * Tabla de Estado de cuenta con FILTROS (pedido de Nico 2026-11-11: "que haya
 * filtros en la tabla").
 *
 *   · Barra arriba: buscador, estado (con conteos), mora, saldo mínimo y
 *     chips rápidos (despachado sin facturar, con promesa, sin NIT).
 *   · Encabezados ordenables (clic: sentido natural → inverso → sin orden) y
 *     filtro en el encabezado de Estado (estado + mora), igual que la columna
 *     Rol de Terceros. Usa el MISMO estado que la barra.
 *   · Estado y mora van en UNA columna (te debe → días de mora; si no,
 *     anticipo o al día) para que la tabla quepa con el menú lateral abierto.
 *     Despachado y Pagos aparecen solo en pantallas anchas (2xl / xl).
 *   · Fila de totales de lo que se está viendo.
 *
 * La tabla no calcula nada de cartera: recibe filas ya construidas por
 * construirFila (modelo.ts) con los números del motor canónico.
 */
import { Fragment, useMemo, type ReactNode } from 'react';
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, ListFilter, Search, SearchX, X,
  CalendarClock, Truck, IdCard,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { parseLocalDate } from '@/lib/dateUtils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import {
  TRAMOS, aplicarFiltros, aplicarFiltrosSinEstado, contarFiltrosActivos, cumpleMora, ordenarFilas,
  siguienteOrden, totalesDe, formatCompacto, formatCurrency, FILTROS_DEFAULT,
  type EstadoFilter, type FilaEstado, type FiltrosTabla, type MoraFilter, type Orden, type SortKey,
} from './modelo';
import { Avance, Avatar, ESTADO_UI, EstadoPill, MoraPill } from './piezas';

const ESTADOS: { key: EstadoFilter; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'cxc', label: 'Te deben' },
  { key: 'anticipos', label: 'Anticipos' },
  { key: 'aldia', label: 'Al día' },
];

const OPCIONES_MORA: { key: MoraFilter; label: string }[] = [
  { key: 'todas', label: 'Cualquier mora' },
  { key: 'vencida', label: 'Con algo vencido' },
  ...TRAMOS.map((t) => ({ key: t.key as MoraFilter, label: t.label })),
];

const OPCIONES_SALDO: { valor: number; label: string }[] = [
  { valor: 0, label: 'Cualquier saldo' },
  { valor: 1_000_000, label: 'Desde $1 M' },
  { valor: 5_000_000, label: 'Desde $5 M' },
  { valor: 10_000_000, label: 'Desde $10 M' },
  { valor: 50_000_000, label: 'Desde $50 M' },
];

const COLS = 6;

interface Props {
  filas: FilaEstado[];
  cargando: boolean;
  year: number;
  filtros: FiltrosTabla;
  onFiltros: (f: FiltrosTabla) => void;
  orden: Orden | null;
  onOrden: (o: Orden | null) => void;
  abierto: string | null;
  onAbrir: (clientId: string | null) => void;
  renderPanel: (fila: FilaEstado) => ReactNode;
}

export default function TablaClientes({
  filas, cargando, year, filtros, onFiltros, orden, onOrden, abierto, onAbrir, renderPanel,
}: Props) {
  const set = (patch: Partial<FiltrosTabla>) => onFiltros({ ...filtros, ...patch });

  // Conteos del selector de estado: con TODOS los demás filtros aplicados.
  const sinEstado = useMemo(() => aplicarFiltrosSinEstado(filas, filtros), [filas, filtros]);
  const conteoEstado = useMemo(() => ({
    todos: sinEstado.length,
    cxc: sinEstado.filter((r) => r.estado === 'cxc').length,
    anticipos: sinEstado.filter((r) => r.estado === 'anticipos').length,
    aldia: sinEstado.filter((r) => r.estado === 'aldia').length,
  }), [sinEstado]);

  // Conteos de los chips y de la mora: sobre todas las filas (lo que hay).
  const conteoChips = useMemo(() => ({
    sinFacturar: filas.filter((r) => r.sinFacturar > 0).length,
    promesa: filas.filter((r) => r.promesa).length,
    sinNit: filas.filter((r) => !r.nit).length,
  }), [filas]);
  const conteoMora = useMemo(() => {
    const out: Record<string, number> = {};
    for (const o of OPCIONES_MORA) out[o.key] = filas.filter((r) => cumpleMora(r, o.key)).length;
    return out;
  }, [filas]);

  const visibles = useMemo(
    () => ordenarFilas(aplicarFiltros(filas, filtros), orden, filtros.estado),
    [filas, filtros, orden],
  );
  const totales = useMemo(() => totalesDe(visibles), [visibles]);
  const activos = contarFiltrosActivos(filtros) + (filtros.estado !== 'todos' ? 1 : 0);
  const limpiar = () => onFiltros(FILTROS_DEFAULT);

  const sortProps = { orden, onOrden };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* ── Barra de filtros ─────────────────────────────────────────── */}
      <div className="p-3 sm:p-4 border-b border-border space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={filtros.q}
              onChange={(e) => set({ q: e.target.value })}
              placeholder="Buscar cliente o NIT…"
              aria-label="Buscar cliente o NIT"
              className="h-9 pl-8 pr-8"
            />
            {filtros.q && (
              <button type="button" onClick={() => set({ q: '' })} aria-label="Borrar la búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 overflow-x-auto max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="radiogroup" aria-label="Estado">
            {ESTADOS.map((e) => {
              const activo = filtros.estado === e.key;
              const n = conteoEstado[e.key as keyof typeof conteoEstado];
              return (
                <button key={e.key} type="button" role="radio" aria-checked={activo}
                  onClick={() => set({ estado: e.key })}
                  className={cn(
                    'shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
                    activo ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}>
                  {e.label} <span className="tabular-nums text-muted-foreground">{n}</span>
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="tabular-nums">{visibles.length} de {filas.length} clientes</span>
            {activos > 0 && (
              <button type="button" onClick={limpiar} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
                <X className="h-3 w-3" /> Limpiar filtros{activos > 1 ? ` (${activos})` : ''}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <MenuFiltro
            etiqueta="Mora"
            valor={OPCIONES_MORA.find((o) => o.key === filtros.mora)?.label ?? 'Cualquier mora'}
            activo={filtros.mora !== 'todas'}
          >
            <DropdownMenuLabel className="text-xs">Filtrar por mora</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={filtros.mora} onValueChange={(v) => set({ mora: v as MoraFilter })}>
              {OPCIONES_MORA.map((o) => (
                <DropdownMenuRadioItem key={o.key} value={o.key} className="text-xs">
                  {o.label}
                  <span className="ml-auto pl-3 tabular-nums text-muted-foreground">{conteoMora[o.key]}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </MenuFiltro>

          <MenuFiltro
            etiqueta="Saldo"
            valor={OPCIONES_SALDO.find((o) => o.valor === filtros.saldoMin)?.label ?? 'Cualquier saldo'}
            activo={filtros.saldoMin > 0}
          >
            <DropdownMenuLabel className="text-xs">Saldo (te debe o a favor)</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={String(filtros.saldoMin)} onValueChange={(v) => set({ saldoMin: Number(v) })}>
              {OPCIONES_SALDO.map((o) => (
                <DropdownMenuRadioItem key={o.valor} value={String(o.valor)} className="text-xs">{o.label}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </MenuFiltro>

          <Chip activo={filtros.soloSinFacturar} onClick={() => set({ soloSinFacturar: !filtros.soloSinFacturar })}
            icon={Truck} label="Despachado sin facturar" n={conteoChips.sinFacturar}
            title="Clientes a los que les despachaste más de lo que les facturaste este año" />
          <Chip activo={filtros.soloConPromesa} onClick={() => set({ soloConPromesa: !filtros.soloConPromesa })}
            icon={CalendarClock} label="Con promesa de pago" n={conteoChips.promesa}
            title="Clientes con un cobro acordado pendiente" />
          <Chip activo={filtros.soloSinNit} onClick={() => set({ soloSinNit: !filtros.soloSinNit })}
            icon={IdCard} label="Sin NIT" n={conteoChips.sinNit}
            title="Clientes sin NIT en su ficha: el export para el contador sale sin NIT" />
        </div>
      </div>

      {/* ── Tabla ────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm sm:min-w-[640px]">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr className="text-left">
              <Encabezado k="cliente" label="Cliente" className="pl-4" {...sortProps} />
              <Encabezado k="despachado" label="Despachado" alinear="right" className="hidden 2xl:table-cell"
                title="Remisiones de venta del año (no canceladas). Informativo: el saldo se calcula contra lo facturado." {...sortProps} />
              <Encabezado k="facturado" label="Facturado" alinear="right" className="hidden sm:table-cell"
                title="Facturado del año más el saldo inicial. La barra muestra cuánto de eso ya está cubierto." {...sortProps} />
              <Encabezado k="cobrado" label="Pagos y desc." alinear="right" className="hidden xl:table-cell"
                title="Banco + efectivo + anticipos + retenciones. Facturado − esto = Saldo, exacto." {...sortProps} />
              <Encabezado k="saldo" label="Saldo" alinear="right" className="hidden sm:table-cell" {...sortProps} />
              <th className="hidden sm:table-cell px-3 py-2.5 pr-4 font-medium whitespace-nowrap"
                aria-sort={orden?.key === 'mora' ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                title="Te debe: días de la factura más vencida. Si no, anticipo o al día.">
                <span className="inline-flex items-center gap-1">
                  <BotonOrden k="mora" label="Estado" {...sortProps} />
                  <FiltroEncabezado etiqueta="Filtrar por estado" activo={filtros.estado !== 'todos' || filtros.mora !== 'todas'}>
                    <DropdownMenuRadioGroup value={filtros.estado} onValueChange={(v) => set({ estado: v as EstadoFilter })}>
                      {ESTADOS.map((e) => (
                        <DropdownMenuRadioItem key={e.key} value={e.key} className="text-xs">
                          {e.label}<span className="ml-auto pl-3 tabular-nums text-muted-foreground">{conteoEstado[e.key as keyof typeof conteoEstado]}</span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs">Mora</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={filtros.mora} onValueChange={(v) => set({ mora: v as MoraFilter })}>
                      {OPCIONES_MORA.map((o) => (
                        <DropdownMenuRadioItem key={o.key} value={o.key} className="text-xs">
                          {o.label}<span className="ml-auto pl-3 tabular-nums text-muted-foreground">{conteoMora[o.key]}</span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </FiltroEncabezado>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="pl-4 pr-3 py-3"><div className="flex items-center gap-2.5"><Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-4 w-40" /></div></td>
                  <td className="px-3 py-3 hidden 2xl:table-cell"><Skeleton className="h-4 w-20 ml-auto" /></td>
                  <td className="px-3 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-24 ml-auto" /></td>
                  <td className="px-3 py-3 hidden xl:table-cell"><Skeleton className="h-4 w-24 ml-auto" /></td>
                  <td className="px-3 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-24 ml-auto" /></td>
                  <td className="px-3 py-3 pr-4 hidden sm:table-cell"><Skeleton className="h-5 w-24" /></td>
                </tr>
              ))
            ) : visibles.length === 0 ? (
              <tr>
                <td colSpan={COLS} className="py-14 text-center">
                  <SearchX className="h-8 w-8 mx-auto text-muted-foreground/50" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {filas.length === 0 ? `Sin clientes con movimiento en ${year}.` : 'Ningún cliente cumple estos filtros.'}
                  </p>
                  {activos > 0 && (
                    <Button variant="outline" size="sm" className="mt-3 h-8 text-xs" onClick={limpiar}>Limpiar filtros</Button>
                  )}
                </td>
              </tr>
            ) : (
              visibles.map((r) => (
                <FilaTabla key={r.client.client_id} fila={r} abierta={abierto === r.client.client_id}
                  onToggle={() => onAbrir(abierto === r.client.client_id ? null : r.client.client_id)}
                  panel={abierto === r.client.client_id ? renderPanel(r) : null} />
              ))
            )}
          </tbody>
          {!cargando && visibles.length > 0 && (
            <tfoot className="border-t-2 border-border bg-muted/30 text-sm">
              <tr>
                <td className="pl-4 pr-3 py-3 font-semibold">
                  Total {activos > 0 ? 'de lo filtrado' : `de ${year}`}
                  <span className="block text-xs font-normal text-muted-foreground">{totales.clientes} cliente{totales.clientes === 1 ? '' : 's'}</span>
                  {/* Celular: el saldo total va debajo (las columnas de montos se esconden) */}
                  <span className="sm:hidden mt-1 block text-xs font-normal tabular-nums">
                    {totales.teDeben > 0 && <span className={cn('font-semibold', ESTADO_UI.cxc.texto)}>Te deben {formatCurrency(totales.teDeben)}</span>}
                    {totales.aFavor > 0 && <span className={cn('block', ESTADO_UI.anticipos.texto)}>A favor {formatCurrency(totales.aFavor)}</span>}
                  </span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums hidden 2xl:table-cell">{formatCurrency(totales.despachado)}</td>
                <td className="px-3 py-3 text-right tabular-nums font-medium hidden sm:table-cell">{formatCurrency(totales.facturado)}</td>
                <td className="px-3 py-3 text-right tabular-nums hidden xl:table-cell">{formatCurrency(totales.cobrado)}</td>
                <td className="px-3 py-3 text-right tabular-nums hidden sm:table-cell">
                  {totales.teDeben > 0 && <span className={cn('block font-semibold', ESTADO_UI.cxc.texto)}>{formatCurrency(totales.teDeben)}</span>}
                  {totales.aFavor > 0 && <span className={cn('block text-xs', ESTADO_UI.anticipos.texto)}>a favor {formatCurrency(totales.aFavor)}</span>}
                  {totales.teDeben <= 0 && totales.aFavor <= 0 && <span className="text-muted-foreground">$0</span>}
                </td>
                <td className="hidden sm:table-cell" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Fila ────────────────────────────────────────────────────────────────────
function FilaTabla({ fila: r, abierta, onToggle, panel }: {
  fila: FilaEstado; abierta: boolean; onToggle: () => void; panel: ReactNode;
}) {
  const e = ESTADO_UI[r.estado];
  const c = r.client;
  return (
    <Fragment>
      <tr
        onClick={onToggle}
        className={cn(
          'group border-t border-border cursor-pointer transition-colors',
          abierta ? 'bg-muted/50' : 'hover:bg-muted/30',
        )}
      >
        <td className="relative pl-4 pr-3 py-2.5">
          <span className={cn('absolute left-0 top-0 bottom-0 w-[3px]', e.barra, !abierta && 'opacity-0 group-hover:opacity-60')} aria-hidden />
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              aria-expanded={abierta}
              aria-label={`${abierta ? 'Cerrar' : 'Abrir'} el detalle de ${c.client_name}`}
              onClick={(ev) => { ev.stopPropagation(); onToggle(); }}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {abierta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <Avatar nombre={c.client_name} estado={r.estado} />
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate max-w-[240px] xl:max-w-[320px]" title={c.client_name}>{c.client_name}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                {r.nit ? <span className="font-mono tabular-nums">{r.nit}</span> : <span className="text-amber-700 dark:text-amber-400">sin NIT</span>}
                {r.promesa && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 text-violet-800 dark:text-violet-300 px-1.5 py-px"
                    title="Cobro acordado pendiente (Acordar cobro)">
                    <CalendarClock className="h-3 w-3" />
                    {formatCompacto(r.promesa.amount)} · {format(parseLocalDate(r.promesa.due_date.slice(0, 10)), 'd MMM', { locale: es })}
                  </span>
                )}
              </p>
              {/* Celular: saldo y estado debajo del nombre (las columnas se esconden) */}
              <div className="sm:hidden mt-1.5 flex items-center gap-2 flex-wrap">
                <span className={cn('text-sm font-semibold tabular-nums', e.texto)}>{formatCurrency(c.saldo_neto)}</span>
                {r.estado === 'cxc' ? <MoraPill dias={r.mora} /> : <EstadoPill estado={r.estado} />}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap hidden 2xl:table-cell">
          {r.despachado > 1 ? formatCurrency(r.despachado) : <span className="text-muted-foreground">—</span>}
          {r.sinFacturar > 0 && (
            <span className="block text-xs font-medium text-amber-700 dark:text-amber-400">sin facturar {formatCompacto(r.sinFacturar)}</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right whitespace-nowrap hidden sm:table-cell">
          <span className="tabular-nums">{formatCurrency(r.facturado)}</span>
          {r.facturado > 0 && (
            <span className="mt-1 flex items-center gap-1.5 justify-end" title={`Cubierto el ${Math.round(r.pctCobrado * 100)} % de lo facturado`}>
              <Avance valor={r.pctCobrado} className="w-16" />
              <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">{Math.round(r.pctCobrado * 100)} %</span>
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap hidden xl:table-cell">
          {formatCurrency(r.cobrado)}
          {c.retenciones_total > 0 && <span className="block text-xs text-muted-foreground">incl. ret. {formatCompacto(c.retenciones_total)}</span>}
        </td>
        <td className="px-3 py-2.5 text-right whitespace-nowrap hidden sm:table-cell">
          <span className={cn('font-semibold tabular-nums', e.texto)}>{formatCurrency(c.saldo_neto)}</span>
          <span className="block text-xs text-muted-foreground">{e.corto}</span>
        </td>
        <td className="px-3 py-2.5 pr-4 whitespace-nowrap hidden sm:table-cell">
          {r.estado === 'cxc' ? <MoraPill dias={r.mora} /> : <EstadoPill estado={r.estado} />}
        </td>
      </tr>
      {panel && (
        <tr>
          {/* w-0 + min-w-full: el panel NO ensancha la tabla (en celular la
              empujaba fuera de la pantalla); toma el ancho de la fila y sus
              tablas internas se desplazan solas. */}
          <td colSpan={COLS} className="p-0"><div className="w-0 min-w-full">{panel}</div></td>
        </tr>
      )}
    </Fragment>
  );
}

// ── Piezas de la barra y los encabezados ───────────────────────────────────
function MenuFiltro({ etiqueta, valor, activo, children }: { etiqueta: string; valor: string; activo: boolean; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors',
            activo ? 'border-foreground/30 bg-foreground text-background' : 'border-border text-foreground hover:bg-muted',
          )}>
          <span className={activo ? 'opacity-80' : 'text-muted-foreground'}>{etiqueta}:</span>
          <span className="font-medium">{valor}</span>
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function Chip({ activo, onClick, icon: Icon, label, n, title }: {
  activo: boolean; onClick: () => void; icon: typeof Truck; label: string; n: number; title: string;
}) {
  return (
    <button type="button" aria-pressed={activo} onClick={onClick} title={title} disabled={!activo && n === 0}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-40 disabled:cursor-default',
        activo ? 'border-foreground/30 bg-foreground text-background' : 'border-border text-foreground hover:bg-muted',
      )}>
      <Icon className="h-3.5 w-3.5" /> {label}
      <span className={cn('tabular-nums', activo ? 'opacity-80' : 'text-muted-foreground')}>{n}</span>
    </button>
  );
}

function FiltroEncabezado({ etiqueta, activo, children }: { etiqueta: string; activo: boolean; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={etiqueta} title={etiqueta}
          className={cn('rounded p-0.5 hover:bg-muted transition-colors', activo ? 'text-foreground' : 'text-muted-foreground/60 hover:text-foreground')}>
          <ListFilter className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs">{etiqueta}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BotonOrden({ k, label, orden, onOrden }: { k: SortKey; label: string; orden: Orden | null; onOrden: (o: Orden | null) => void }) {
  const activo = orden?.key === k;
  const Icon = !activo ? ArrowUpDown : orden!.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button type="button" onClick={() => onOrden(siguienteOrden(orden, k))}
      className={cn('inline-flex items-center gap-1 rounded hover:text-foreground transition-colors', activo && 'text-foreground')}
      title={`Ordenar por ${label.toLowerCase()}`}>
      {label}
      <Icon className={cn('h-3 w-3', !activo && 'opacity-40')} />
    </button>
  );
}

function Encabezado({ k, label, alinear = 'left', className, title, orden, onOrden }: {
  k: SortKey; label: string; alinear?: 'left' | 'right'; className?: string; title?: string;
  orden: Orden | null; onOrden: (o: Orden | null) => void;
}) {
  const sort = orden?.key === k ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th aria-sort={sort} title={title}
      className={cn('px-3 py-2.5 font-medium whitespace-nowrap', alinear === 'right' && 'text-right', className)}>
      <span className={cn('inline-flex', alinear === 'right' && 'justify-end w-full')}>
        <BotonOrden k={k} label={label} orden={orden} onOrden={onOrden} />
      </span>
    </th>
  );
}
