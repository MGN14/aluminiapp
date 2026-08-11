/**
 * FICHA 360° DE UN TERCERO (Nico, 2026-08-06: "hacer clic en cada
 * beneficiario para ver quién es — no solo los datos: cartera, ventas, qué
 * es lo que más compra").
 *
 * Todo sale del agregador src/lib/terceroProfile.ts. Las pestañas solo
 * aparecen si tienen contenido: el seguro con un único movimiento muestra
 * su movimiento y el formulario para completar NIT/contacto — no diez
 * pestañas vacías.
 */

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, Loader2, Pencil, Users, FileText, Landmark, Package, ArrowLeftRight, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchTerceroProfile, saveTercero, type Tercero } from '@/lib/terceroProfile';
import { RolChips } from '@/pages/Terceros';

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
const fmt = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

type TabKey = 'resumen' | 'cartera' | 'movimientos' | 'compra' | 'documentos';

export default function TerceroDetalle() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('resumen');
  const [editando, setEditando] = useState(false);

  const { data: p, isPending, error } = useQuery({
    queryKey: ['terceros', 'perfil', id],
    queryFn: () => fetchTerceroProfile(id!),
    enabled: !!id,
    staleTime: 60_000,
  });

  const guardar = useMutation({
    mutationFn: (patch: Partial<Tercero>) => saveTercero(id!, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['terceros'] });
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      setEditando(false);
      toast({ title: 'Datos guardados' });
    },
    onError: (e) => toast({ title: 'No se pudo guardar', description: (e as Error).message, variant: 'destructive' }),
  });

  // Pestañas: solo las que tienen contenido (más Resumen, siempre).
  const tabs = useMemo(() => {
    if (!p) return [];
    const out: { key: TabKey; label: string; icon: typeof FileText }[] = [
      { key: 'resumen', label: 'Resumen', icon: Users },
    ];
    if (p.pendienteCobrar > 0 || p.facturasVenta.length) out.push({ key: 'cartera', label: `Cartera (${p.facturasVenta.length})`, icon: Landmark });
    if (p.movimientos.length) out.push({ key: 'movimientos', label: `Movimientos (${p.movimientos.length})`, icon: ArrowLeftRight });
    if (p.topReferencias.length) out.push({ key: 'compra', label: 'Qué compra', icon: Package });
    if (p.totalDocumentos > 0) out.push({ key: 'documentos', label: `Documentos (${p.totalDocumentos})`, icon: FileText });
    return out;
  }, [p]);

  if (isPending) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando ficha…
        </div>
      </AppLayout>
    );
  }
  if (error || !p) {
    return (
      <AppLayout>
        <div className="text-center py-24 text-muted-foreground text-sm">
          No encontré este tercero. <button className="text-primary underline" onClick={() => navigate('/terceros')}>Volver</button>
        </div>
      </AppLayout>
    );
  }

  const t = p.tercero;
  const contacto = [t.email, t.phone ?? t.telefono, t.ciudad].filter(Boolean).join(' · ');
  const sinDatos = !t.nit || !(t.email || t.phone || t.telefono);
  const cupoExcedido = t.cupo_credito != null && t.cupo_credito > 0 && p.pendienteCobrar > t.cupo_credito;

  return (
    <AppLayout>
      <div className="max-w-full mx-auto space-y-4 px-4">
        <button className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          onClick={() => navigate('/terceros')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Terceros
        </button>

        {/* Cabecera */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight flex items-center gap-3">
              {t.name}
              <RolChips roles={p.roles} />
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t.razon_social && t.razon_social !== t.name ? `${t.razon_social} · ` : ''}
              {t.nit ? `NIT ${t.nit}${t.dv != null ? `-${t.dv}` : ''}` : 'Sin NIT'}
              {contacto ? ` · ${contacto}` : ''}
            </p>
            {p.alias.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                También aparece como: {p.alias.slice(0, 4).join(', ')}{p.alias.length > 4 ? '…' : ''}
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Editar datos
          </Button>
        </div>

        {sinDatos && (
          <div className="rounded-lg border border-amber-400/40 bg-amber-50/40 dark:bg-amber-950/10 px-3 py-2 text-xs flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            Ficha incompleta: falta {!t.nit ? 'el NIT' : ''}{!t.nit && !(t.email || t.phone || t.telefono) ? ' y ' : ''}
            {!(t.email || t.phone || t.telefono) ? 'el contacto' : ''}.
            <button className="text-primary underline" onClick={() => setEditando(true)}>Completar ahora</button>
          </div>
        )}
        {cupoExcedido && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/[0.05] px-3 py-2 text-xs font-medium text-destructive">
            ⚠ Cupo de crédito excedido: debe {fmtCOP(p.pendienteCobrar)} y el cupo es {fmtCOP(t.cupo_credito!)}.
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Kpi label="Facturado (ventas)" value={fmtCOP(p.totalVentas)} />
          <Kpi label="Por cobrar" value={fmtCOP(p.pendienteCobrar)} tone={p.pendienteCobrar > 0 ? 'red' : undefined} />
          <Kpi label={p.totalCompras > 0 ? 'Comprado a él' : 'Neto bancario'}
            value={p.totalCompras > 0 ? fmtCOP(p.totalCompras) : fmtCOP(p.netoBancario)} />
          <Kpi label="Última actividad" value={p.ultimaActividad ?? '—'} />
        </div>

        {/* Pestañas */}
        <div className="inline-flex rounded-lg bg-muted p-1 gap-1 flex-wrap">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                tab === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {tab === 'resumen' && (
          <div className="space-y-3">
            {p.porMes.length > 0 ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-semibold mb-2">Actividad por mes</p>
                <MiniBarras porMes={p.porMes.slice(-12)} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Sin actividad registrada todavía. Cuando le factures, le compres o lo concilies, acá aparece todo.
              </p>
            )}
            {(t.notas || t.dias_credito != null || t.cupo_credito != null) && (
              <div className="rounded-xl border border-border bg-card p-4 text-xs space-y-1">
                {t.dias_credito != null && <p><strong>Plazo pactado:</strong> {t.dias_credito} días</p>}
                {t.cupo_credito != null && <p><strong>Cupo de crédito:</strong> {fmtCOP(t.cupo_credito)}</p>}
                {t.notas && <p className="whitespace-pre-wrap text-muted-foreground">{t.notas}</p>}
              </div>
            )}
          </div>
        )}

        {tab === 'cartera' && (
          <Tabla
            headers={['Factura', 'Fecha', 'Total', 'Saldo pendiente', 'Estado']}
            rows={p.facturasVenta.map((f) => [
              f.invoice_number, f.issue_date, fmtCOP(Number(f.total_amount)),
              Number(f.balance_pending ?? 0) > 0
                ? <span key="s" className="text-destructive font-medium">{fmtCOP(Number(f.balance_pending))}</span>
                : <span key="s" className="text-success">Pagada</span>,
              f.status ?? '—',
            ])}
            vacio="Sin facturas de venta."
          />
        )}

        {tab === 'movimientos' && (
          <Tabla
            headers={['Fecha', 'Descripción', 'Monto']}
            rows={p.movimientos.slice(0, 200).map((m) => [
              m.date,
              m.description ?? '—',
              <span key="m" className={cn('tabular-nums', Number(m.amount) >= 0 ? 'text-success' : 'text-destructive')}>
                {fmtCOP(Number(m.amount ?? 0))}
              </span>,
            ])}
            vacio="Sin movimientos bancarios."
            pie={p.movimientos.length > 200 ? `Mostrando 200 de ${p.movimientos.length}.` : undefined}
          />
        )}

        {tab === 'compra' && (
          <Tabla
            headers={['Referencia', 'Descripción', 'Unidades', 'Importe', 'Docs']}
            rows={p.topReferencias.map((r) => [
              <span key="r" className="font-mono font-medium">{r.reference}</span>,
              r.descripcion ?? '—', fmt(r.unidades), fmtCOP(r.importe), String(r.documentos),
            ])}
            vacio="Sin líneas de producto registradas."
          />
        )}

        {tab === 'documentos' && (
          <Tabla
            headers={['Tipo', 'Número', 'Fecha', 'Valor']}
            rows={[
              ...p.facturasVenta.map((f) => ['Factura venta', f.invoice_number, f.issue_date, fmtCOP(Number(f.total_amount))]),
              ...p.facturasCompra.map((f) => ['Factura compra', f.invoice_number, f.issue_date, fmtCOP(Number(f.total_amount))]),
              ...p.remisiones.map((r) => [
                r.remision_type === 'compra' ? 'Remisión compra' : 'Remisión venta',
                r.number, r.date, r.total_manual != null ? fmtCOP(Number(r.total_manual)) : '—',
              ]),
            ].sort((a, b) => String(b[2]).localeCompare(String(a[2])))}
            vacio="Sin documentos."
          />
        )}

        <EditarTerceroDialog key={editando ? 'open' : 'closed'} open={editando}
          tercero={t} guardando={guardar.isPending}
          onClose={() => setEditando(false)}
          onSave={(patch) => guardar.mutate(patch)} />
      </div>
    </AppLayout>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'red' }) {
  return (
    <div className={cn('rounded-lg border px-3 py-2.5',
      tone === 'red' ? 'border-destructive/30 bg-destructive/[0.04]' : 'border-border bg-card')}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-bold tabular-nums truncate">{value}</p>
    </div>
  );
}

function MiniBarras({ porMes }: { porMes: { mes: string; ventas: number; compras: number; banco: number }[] }) {
  const max = Math.max(...porMes.map((m) => Math.max(m.ventas, m.compras, Math.abs(m.banco))), 1);
  return (
    <div className="flex items-end gap-2 h-28">
      {porMes.map((m) => {
        const principal = m.ventas || m.compras || Math.abs(m.banco);
        const esVenta = m.ventas > 0;
        return (
          <div key={m.mes} className="flex-1 flex flex-col items-center gap-1 min-w-0"
            title={`${m.mes} · ventas ${fmtCOP(m.ventas)} · compras ${fmtCOP(m.compras)} · banco ${fmtCOP(m.banco)}`}>
            <div className={cn('w-full rounded-t', esVenta ? 'bg-primary/70' : 'bg-muted-foreground/40')}
              style={{ height: `${Math.max(4, (principal / max) * 96)}px` }} />
            <span className="text-[9px] text-muted-foreground truncate">{m.mes.slice(2)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Tabla({ headers, rows, vacio, pie }: {
  headers: string[]; rows: React.ReactNode[][]; vacio: string; pie?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-xs">
        <thead className="bg-muted/60">
          <tr className="text-left">{headers.map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} className="px-3 py-10 text-center text-muted-foreground">{vacio}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60 hover:bg-muted/30">
              {r.map((c, j) => <td key={j} className="px-3 py-1.5">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {pie && <p className="px-3 py-2 text-[11px] text-muted-foreground">{pie}</p>}
    </div>
  );
}

function EditarTerceroDialog({ open, tercero: t, guardando, onClose, onSave }: {
  open: boolean; tercero: Tercero; guardando: boolean;
  onClose: () => void; onSave: (patch: Partial<Tercero>) => void;
}) {
  const [f, setF] = useState({
    name: t.name, razon_social: t.razon_social ?? '', nit: t.nit ?? '',
    dv: t.dv != null ? String(t.dv) : '', tipo_persona: t.tipo_persona ?? '',
    regimen: t.regimen ?? '', email: t.email ?? '', phone: t.phone ?? t.telefono ?? '',
    address: t.address ?? '', ciudad: t.ciudad ?? '',
    dias_credito: t.dias_credito != null ? String(t.dias_credito) : '',
    cupo_credito: t.cupo_credito != null ? String(t.cupo_credito) : '',
    notas: t.notas ?? '',
  });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Datos de {t.name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2">
            <Label>Nombre comercial</Label>
            <Input value={f.name} onChange={(e) => set('name')(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Razón social (si difiere)</Label>
            <Input value={f.razon_social} onChange={(e) => set('razon_social')(e.target.value)} />
          </div>
          <div>
            <Label>NIT / documento</Label>
            <Input value={f.nit} onChange={(e) => set('nit')(e.target.value)} placeholder="900123456" />
          </div>
          <div>
            <Label>DV</Label>
            <Input value={f.dv} onChange={(e) => set('dv')(e.target.value)} placeholder="7" maxLength={1} />
          </div>
          <div>
            <Label>Tipo de persona</Label>
            <Select value={f.tipo_persona || undefined} onValueChange={set('tipo_persona')}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="natural">Natural</SelectItem>
                <SelectItem value="juridica">Jurídica</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Régimen</Label>
            <Select value={f.regimen || undefined} onValueChange={set('regimen')}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="comun">Común</SelectItem>
                <SelectItem value="simple">Simple</SelectItem>
                <SelectItem value="no_responsable_iva">No responsable de IVA</SelectItem>
                <SelectItem value="gran_contribuyente">Gran contribuyente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={f.email} onChange={(e) => set('email')(e.target.value)} />
          </div>
          <div>
            <Label>Teléfono</Label>
            <Input value={f.phone} onChange={(e) => set('phone')(e.target.value)} />
          </div>
          <div>
            <Label>Dirección</Label>
            <Input value={f.address} onChange={(e) => set('address')(e.target.value)} />
          </div>
          <div>
            <Label>Ciudad</Label>
            <Input value={f.ciudad} onChange={(e) => set('ciudad')(e.target.value)} />
          </div>
          <div>
            <Label>Días de crédito</Label>
            <Input type="number" value={f.dias_credito} onChange={(e) => set('dias_credito')(e.target.value)} placeholder="30" />
          </div>
          <div>
            <Label>Cupo de crédito</Label>
            <Input type="number" value={f.cupo_credito} onChange={(e) => set('cupo_credito')(e.target.value)} placeholder="50000000" />
          </div>
          <div className="col-span-2">
            <Label>Notas</Label>
            <Input value={f.notas} onChange={(e) => set('notas')(e.target.value)} placeholder="Ej: seguro PYME de la bodega, vence en julio" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={guardando}>Cancelar</Button>
          <Button disabled={guardando || !f.name.trim()}
            onClick={() => onSave({
              name: f.name.trim(),
              razon_social: f.razon_social.trim() || null,
              nit: f.nit.trim() || null,
              dv: f.dv !== '' && /^\d$/.test(f.dv) ? Number(f.dv) : null,
              tipo_persona: f.tipo_persona || null,
              regimen: f.regimen || null,
              email: f.email.trim() || null,
              phone: f.phone.trim() || null,
              address: f.address.trim() || null,
              ciudad: f.ciudad.trim() || null,
              dias_credito: f.dias_credito !== '' ? Math.max(0, Number(f.dias_credito)) : null,
              cupo_credito: f.cupo_credito !== '' ? Math.max(0, Number(f.cupo_credito)) : null,
              notas: f.notas.trim() || null,
            })}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
