/**
 * AUDITORÍA DE CONCILIACIÓN — pestaña pedida por Nico (2026-08-06):
 * "necesito ver esas alertas de diferencias, y si no hay, ver por descripción
 * cómo se está conciliando... y que desde ahí se pueda cambiar. Tengo que
 * darme cuenta de esos detalles más rápido."
 *
 * Dos secciones sobre el mismo historial:
 *   1. ALERTAS: descripciones con mayoría clara (≥75%) y movimientos que se
 *      salen (Compensar: Nómina 4 de 5, 1 en Gastos Operativos). Un clic
 *      corrige el desviado o todos de una.
 *   2. LISTADO por descripción: cómo se está conciliando cada una (categorías
 *      y beneficiarios con conteos, rango de monto) con corrección masiva.
 *
 * Las correcciones escriben directo en transactions e invalidan el cache del
 * módulo — el PyG y los reportes quedan alineados al instante.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Search, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useConciliacionHistorial } from '@/hooks/useConciliacionHistorial';
import {
  agruparPorDescripcion, detectarAlertasAuditoria,
  type AlertaAuditoria, type GrupoDescripcion, type TxHistorial,
} from '@/lib/conciliacionHistorial';
import { SearchableSelect } from './SearchableSelect';
import type { Category, Responsible } from '@/types/transaction';

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
const fmtFecha = (iso: string) => iso.slice(0, 10);

interface Props {
  categories: Category[];
  responsibles: Responsible[];
}

export default function AuditoriaConciliacion({ categories, responsibles }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { historial, isLoading, excluidas, excluir, reactivar } = useConciliacionHistorial(true);
  const [q, setQ] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);
  const [bulkCat, setBulkCat] = useState<string | null>(null);
  const [bulkResp, setBulkResp] = useState<string | null>(null);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const respName = useMemo(() => new Map(responsibles.map((r) => [r.id, r.name])), [responsibles]);
  const nombre = (campo: 'categoria' | 'beneficiario', id: string) =>
    (campo === 'categoria' ? catName.get(id) : respName.get(id)) ?? '¿?';

  const grupos = useMemo(() => (historial ? agruparPorDescripcion(historial) : []), [historial]);
  // Las "no auditar" (pagos de clientes por transferencia/Nequi: beneficiario
  // varía legítimamente) no alertan; en el listado quedan marcadas.
  const alertas = useMemo(
    () => detectarAlertasAuditoria(grupos).filter((a) => !excluidas.has(a.grupo.desc)),
    [grupos, excluidas],
  );

  const corregir = useMutation({
    mutationFn: async ({ ids, patch }: { ids: string[]; patch: { category_id?: string; responsible_id?: string } }) => {
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabase
          .from('transactions')
          .update(patch)
          .in('id', ids.slice(i, i + 200));
        if (error) throw error;
      }
      return ids.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      toast({ title: `${n} movimiento(s) corregidos`, duration: 6000 });
    },
    onError: (e) => toast({ title: 'No se pudo corregir', description: (e as Error).message, variant: 'destructive' }),
  });

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    const arr = s ? grupos.filter((g) => g.desc.includes(s) || g.muestra.toLowerCase().includes(s)) : grupos;
    return arr.slice(0, 150);
  }, [grupos, q]);

  if (isLoading || !historial) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Leyendo el historial…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── 1. Alertas: la mayoría manda, los desviados se corrigen ── */}
      {alertas.length === 0 ? (
        <div className="rounded-lg border border-success/40 bg-success/[0.05] px-4 py-3 text-sm text-success font-medium">
          ✓ Sin inconsistencias: cada descripción con historial firme se está conciliando siempre igual.
        </div>
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            {alertas.length} inconsistencia(s) — la mayoría manda, estos se salen
          </h3>
          {alertas.map((a) => (
            <AlertaCard key={`${a.grupo.desc}|${a.campo}`} alerta={a} nombre={nombre}
              corrigiendo={corregir.isPending}
              onCorregir={(ids) => corregir.mutate({
                ids,
                patch: a.campo === 'categoria' ? { category_id: a.dominanteId } : { responsible_id: a.dominanteId },
              })}
              onExcluir={() => {
                excluir.mutate(a.grupo.desc);
                toast({
                  title: `«${a.grupo.muestra}» ya no se audita`,
                  description: 'Puede venir de cualquier cliente: sin alertas, sin sugerencias por descripción y sin reglas sugeridas. Se reactiva abajo.',
                  duration: 8000,
                });
              }} />
          ))}
        </div>
      )}

      {excluidas.size > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">
            {excluidas.size} descripción(es) marcadas «no auditar» (pagos de clientes, etc.)
          </summary>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[...excluidas].map((d) => (
              <span key={d} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5">
                <span className="font-mono">{d}</span>
                <button className="text-primary hover:underline" onClick={() => reactivar.mutate(d)}>
                  reactivar
                </button>
              </span>
            ))}
          </div>
        </details>
      )}

      {/* ── 2. Cómo se está conciliando cada descripción ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-bold">Cómo se está conciliando, por descripción</h3>
          <div className="relative max-w-xs flex-1 min-w-48">
            <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar descripción…"
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-border bg-background" />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/60">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold">Descripción</th>
                <th className="px-3 py-2 font-semibold text-right">Movs</th>
                <th className="px-3 py-2 font-semibold">Categoría(s)</th>
                <th className="px-3 py-2 font-semibold">Beneficiario(s)</th>
                <th className="px-3 py-2 font-semibold text-right">Montos</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((g) => {
                const abierto = abierta === g.desc;
                return (
                  <GrupoRow key={g.desc} g={g} abierto={abierto} nombre={nombre}
                    onToggle={() => {
                      setAbierta(abierto ? null : g.desc);
                      setBulkCat(null); setBulkResp(null);
                    }}
                    bulk={abierto ? (
                      <tr className="bg-muted/20">
                        <td colSpan={5} className="px-3 py-2">
                          <div className="flex items-end gap-2 flex-wrap">
                            <div className="w-48">
                              <label className="text-[10px] text-muted-foreground block mb-0.5">Categoría para TODAS</label>
                              <SearchableSelect
                                options={categories.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))}
                                value={bulkCat} onChange={setBulkCat} placeholder="(no cambiar)" />
                            </div>
                            <div className="w-48">
                              <label className="text-[10px] text-muted-foreground block mb-0.5">Beneficiario para TODAS</label>
                              <SearchableSelect
                                options={responsibles.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }))}
                                value={bulkResp} onChange={setBulkResp} placeholder="(no cambiar)" />
                            </div>
                            <Button size="sm" className="h-8 text-xs"
                              disabled={(!bulkCat && !bulkResp) || corregir.isPending}
                              onClick={() => {
                                const patch: { category_id?: string; responsible_id?: string } = {};
                                if (bulkCat) patch.category_id = bulkCat;
                                if (bulkResp) patch.responsible_id = bulkResp;
                                const cambios = [
                                  bulkCat ? `categoría → ${catName.get(bulkCat)}` : '',
                                  bulkResp ? `beneficiario → ${respName.get(bulkResp)}` : '',
                                ].filter(Boolean).join(' y ');
                                if (window.confirm(`Aplicar ${cambios} a los ${g.txs.length} movimientos de «${g.muestra}»?\n\nEsto reclasifica también los meses ya conciliados.`)) {
                                  corregir.mutate({ ids: g.txs.map((t) => t.id!).filter(Boolean), patch });
                                }
                              }}>
                              {corregir.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Wand2 className="h-3.5 w-3.5 mr-1" /> Aplicar a las {g.txs.length}</>}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  />
                );
              })}
            </tbody>
          </table>
          {grupos.length > visibles.length && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              Mostrando {visibles.length} de {grupos.length} — usá el buscador.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Conteos({ conteos, campo, nombre }: {
  conteos: Map<string, number>;
  campo: 'categoria' | 'beneficiario';
  nombre: (campo: 'categoria' | 'beneficiario', id: string) => string;
}) {
  const arr = [...conteos.entries()].sort((a, b) => b[1] - a[1]);
  if (!arr.length) return <span className="text-muted-foreground">—</span>;
  const mixta = arr.length > 1;
  return (
    <span className={cn(mixta && 'text-amber-700 dark:text-amber-500')}>
      {arr.slice(0, 3).map(([id, n], i) => `${i > 0 ? ' · ' : ''}${nombre(campo, id)} ${n}`).join('')}
      {arr.length > 3 ? ` · +${arr.length - 3}` : ''}
    </span>
  );
}

function GrupoRow({ g, abierto, nombre, onToggle, bulk }: {
  g: GrupoDescripcion; abierto: boolean;
  nombre: (campo: 'categoria' | 'beneficiario', id: string) => string;
  onToggle: () => void; bulk: React.ReactNode;
}) {
  return (
    <>
      <tr className="border-t border-border/60 hover:bg-muted/30 cursor-pointer" onClick={onToggle}
        title="Clic para corregir en bloque">
        <td className="px-3 py-1.5">
          {abierto ? <ChevronDown className="h-3 w-3 inline mr-1" /> : <ChevronRight className="h-3 w-3 inline mr-1 text-muted-foreground" />}
          <span className="font-medium">{g.muestra}</span>
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums">{g.txs.length}</td>
        <td className="px-3 py-1.5"><Conteos conteos={g.categorias} campo="categoria" nombre={nombre} /></td>
        <td className="px-3 py-1.5"><Conteos conteos={g.responsables} campo="beneficiario" nombre={nombre} /></td>
        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
          {g.montoMax > 0 ? (g.montoMax - g.montoMin < 1 ? fmtCOP(g.montoMin) : `${fmtCOP(g.montoMin)}–${fmtCOP(g.montoMax)}`) : '—'}
        </td>
      </tr>
      {bulk}
    </>
  );
}

function AlertaCard({ alerta: a, nombre, corrigiendo, onCorregir, onExcluir }: {
  alerta: AlertaAuditoria;
  nombre: (campo: 'categoria' | 'beneficiario', id: string) => string;
  corrigiendo: boolean;
  onCorregir: (ids: string[]) => void;
  onExcluir: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const dominante = nombre(a.campo, a.dominanteId);
  const idsOutliers = a.outliers.map((t) => t.id!).filter(Boolean);
  const valorDe = (t: TxHistorial) =>
    nombre(a.campo, (a.campo === 'categoria' ? t.category_id : t.responsible_id) ?? '');
  return (
    <div className="rounded-lg border border-amber-400/40 bg-amber-50/40 dark:bg-amber-950/10 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button className="text-left min-w-0" onClick={() => setAbierto((v) => !v)}>
          <span className="font-medium">«{a.grupo.muestra}»</span>{' '}
          — {a.campo === 'categoria' ? 'categoría' : 'beneficiario'} <strong>{dominante}</strong> {a.dominanteVeces} de {a.total} veces,{' '}
          <span className="text-amber-700 dark:text-amber-500 font-semibold">{a.outliers.length} distinto(s)</span>
          {abierto ? <ChevronDown className="h-3 w-3 inline ml-1" /> : <ChevronRight className="h-3 w-3 inline ml-1" />}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-xs"
            disabled={corrigiendo || !idsOutliers.length}
            onClick={() => {
              if (window.confirm(`Pasar ${idsOutliers.length} movimiento(s) de «${a.grupo.muestra}» a ${a.campo} = ${dominante}?`)) {
                onCorregir(idsOutliers);
              }
            }}>
            {corrigiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Corregir → ${dominante}`}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
            title="Esta descripción varía legítimamente (pagos de clientes): no alertar, no sugerir, no proponer reglas."
            onClick={onExcluir}>
            No auditar
          </Button>
        </div>
      </div>
      {abierto && (
        <table className="mt-1.5 w-full">
          <tbody>
            {a.outliers.slice(0, 15).map((t) => (
              <tr key={t.id} className="border-t border-border/40">
                <td className="py-1 pr-2 text-muted-foreground tabular-nums">{fmtFecha(t.date)}</td>
                <td className="py-1 pr-2 tabular-nums">{fmtCOP(Math.abs(Number(t.amount ?? 0)))}</td>
                <td className="py-1 pr-2">hoy: <strong>{valorDe(t)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
