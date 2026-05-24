import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useImportPayments, fetchTrmForDate, type ImportPaymentTipo } from '@/hooks/useImportPayments';
import { Trash2, Plus, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface Props {
  importId: string;
}

const TIPO_LABEL: Record<ImportPaymentTipo, string> = {
  anticipo: 'Anticipo',
  parcial: 'Abono parcial',
  saldo_final: 'Saldo final',
  otro: 'Otro',
};

const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCop = (n: number) =>
  n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
const fmtTrm = (n: number) =>
  n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const todayIso = () => new Date().toISOString().split('T')[0];

export default function ImportPaymentsSection({ importId }: Props) {
  const { payments, isLoading, liquidation, create, remove } = useImportPayments(importId);

  const [showForm, setShowForm] = useState(false);
  const [fecha, setFecha] = useState(todayIso());
  const [amountUsd, setAmountUsd] = useState<number | ''>('');
  const [trm, setTrm] = useState<number | ''>('');
  const [tipo, setTipo] = useState<ImportPaymentTipo>('parcial');
  const [notes, setNotes] = useState('');
  const [autoTrmLoading, setAutoTrmLoading] = useState(false);
  const [trmSource, setTrmSource] = useState<'auto' | 'manual'>('auto');

  // Auto-fetch TRM cuando cambia la fecha (solo si trmSource es auto)
  useEffect(() => {
    if (!showForm || trmSource !== 'auto' || !fecha) return;
    let cancelled = false;
    (async () => {
      setAutoTrmLoading(true);
      const v = await fetchTrmForDate(fecha);
      if (!cancelled && v) setTrm(v);
      if (!cancelled) setAutoTrmLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fecha, showForm, trmSource]);

  const resetForm = () => {
    setFecha(todayIso());
    setAmountUsd('');
    setTrm('');
    setTipo('parcial');
    setNotes('');
    setTrmSource('auto');
  };

  const handleAdd = async () => {
    if (amountUsd === '' || +amountUsd <= 0) return;
    if (trm === '' || +trm <= 0) return;
    await create.mutateAsync({
      fecha,
      amount_usd: +amountUsd,
      trm: +trm,
      tipo,
      notes: notes.trim() || null,
    });
    resetForm();
    setShowForm(false);
  };

  const handleRemove = async (id: string) => {
    const ok = window.confirm('¿Eliminar este abono? El saldo USD se recalcula.');
    if (!ok) return;
    await remove.mutateAsync(id);
  };

  const liq = liquidation;

  return (
    <div className="space-y-3 border border-border rounded-lg p-4 bg-muted/20">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-semibold">Abonos a esta importación</Label>
          <p className="text-xs text-muted-foreground">
            Cada abono guarda la TRM del día. Al liquidar te calculamos el costo real en COP y la TRM promedio.
          </p>
        </div>
        {liq?.liquidada && (
          <Badge variant="default" className="bg-success/15 text-success border-success/30 hover:bg-success/20">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Liquidada
          </Badge>
        )}
      </div>

      {/* Resumen de liquidación */}
      {liq && (liq.abonos_count > 0 || (liq.monto_total_usd ?? 0) > 0) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="p-2 rounded bg-card border border-border">
            <p className="text-muted-foreground">Total facturado</p>
            <p className="font-mono font-semibold">USD ${fmtUsd(liq.monto_total_usd ?? 0)}</p>
          </div>
          <div className="p-2 rounded bg-card border border-border">
            <p className="text-muted-foreground">Pagado USD</p>
            <p className="font-mono font-semibold">USD ${fmtUsd(liq.total_pagado_usd)}</p>
          </div>
          <div className="p-2 rounded bg-card border border-border">
            <p className="text-muted-foreground">Costo real COP</p>
            <p className="font-mono font-semibold">$ {fmtCop(liq.total_pagado_cop)}</p>
          </div>
          <div className="p-2 rounded bg-card border border-border">
            <p className="text-muted-foreground">
              {liq.liquidada ? 'TRM promedio (final)' : 'TRM promedio (parcial)'}
            </p>
            <p className="font-mono font-semibold">
              {liq.trm_promedio_ponderada ? `$ ${fmtTrm(liq.trm_promedio_ponderada)}` : '—'}
            </p>
          </div>
        </div>
      )}

      {/* Lista de abonos */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Cargando abonos…
        </div>
      ) : payments.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2 px-3 rounded bg-card/50 border border-dashed border-border">
          Sin abonos registrados todavía.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left py-1.5 pr-2 font-medium">Fecha</th>
                <th className="text-left py-1.5 pr-2 font-medium">Tipo</th>
                <th className="text-right py-1.5 pr-2 font-medium">USD</th>
                <th className="text-right py-1.5 pr-2 font-medium">TRM</th>
                <th className="text-right py-1.5 pr-2 font-medium">COP</th>
                <th className="text-left py-1.5 pr-2 font-medium">Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-1.5 pr-2 font-mono">{p.fecha}</td>
                  <td className="py-1.5 pr-2">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{TIPO_LABEL[p.tipo]}</Badge>
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono">${fmtUsd(p.amount_usd)}</td>
                  <td className="py-1.5 pr-2 text-right font-mono text-muted-foreground">{fmtTrm(p.trm)}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">${fmtCop(p.amount_cop)}</td>
                  <td className="py-1.5 pr-2 text-muted-foreground truncate max-w-[160px]">{p.notes || '—'}</td>
                  <td className="py-1.5 pr-2 text-right">
                    <button
                      onClick={() => handleRemove(p.id)}
                      className="text-destructive hover:bg-destructive/10 p-1 rounded"
                      title="Eliminar abono"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form de nuevo abono */}
      {!showForm ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => { setShowForm(true); resetForm(); }}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-1" />
          Registrar nuevo abono
        </Button>
      ) : (
        <div className="space-y-2 p-3 rounded border border-primary/30 bg-card">
          <p className="text-xs font-semibold">Nuevo abono</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Fecha</Label>
              <Input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                max={todayIso()}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as ImportPaymentTipo)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TIPO_LABEL) as ImportPaymentTipo[]).map((t) => (
                    <SelectItem key={t} value={t}>{TIPO_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Monto USD *</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={amountUsd}
                onChange={(e) => setAmountUsd(e.target.value === '' ? '' : +e.target.value)}
                placeholder="0.00"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] flex items-center gap-1">
                TRM (COP/USD) *
                {autoTrmLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              </Label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={trm}
                  onChange={(e) => {
                    setTrm(e.target.value === '' ? '' : +e.target.value);
                    setTrmSource('manual');
                  }}
                  placeholder="4150.00"
                  className="h-8 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={async () => {
                    setTrmSource('auto');
                    setAutoTrmLoading(true);
                    const v = await fetchTrmForDate(fecha);
                    if (v) setTrm(v);
                    else alert('No hay TRM cargada para esa fecha. Ingresala manualmente.');
                    setAutoTrmLoading(false);
                  }}
                  className="px-2 rounded border border-input hover:bg-muted"
                  title="Auto-fill TRM del día"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Notas (opcional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Transferencia Bancolombia ref 12345"
              className="h-8 text-xs"
            />
          </div>
          {amountUsd !== '' && trm !== '' && +amountUsd > 0 && +trm > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-3 w-3" />
              Este abono moverá <span className="font-mono font-semibold text-foreground">$ {fmtCop(+amountUsd * +trm)} COP</span> de tu banco.
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setShowForm(false); resetForm(); }}>
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleAdd}
              disabled={create.isPending || amountUsd === '' || trm === '' || +amountUsd <= 0 || +trm <= 0}
            >
              {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Guardar abono'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
