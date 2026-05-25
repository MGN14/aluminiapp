import { useState } from 'react';
import { useMatchStats } from '@/hooks/useMatchStats';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useReconciliationRules, ReconciliationRule } from '@/hooks/useReconciliationRules';
import CrearReglaModal from '@/components/nico/CrearReglaModal';
import { Pencil, Trash2, Zap, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

function formatCOP(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n);
}

export default function NicoReglas() {
  const { rules, isLoading, toggleRule, deleteRule, applyRulesToAllUserTransactions, applyPendingRulesViaRPC } = useReconciliationRules();
  // Stats de auto-matches (últimos 30 días) — leídos de transaction_match_log
  const matchStats = useMatchStats();
  const [editRule, setEditRule] = useState<ReconciliationRule | undefined>();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ReconciliationRule | undefined>();
  const [applyingAll, setApplyingAll] = useState(false);
  const [applyProgress, setApplyProgress] = useState<{ current: number; total: number } | null>(null);
  const [lastResult, setLastResult] = useState<{ total: number; categorized: number; skipped: number; errors: number } | null>(null);

  const activeRulesCount = rules.filter(r => r.active && r.category_id).length;

  const handleApplyAll = async () => {
    if (activeRulesCount === 0) {
      toast.info('No hay reglas activas con categoría asignada.');
      return;
    }
    setApplyingAll(true);
    setLastResult(null);
    setApplyProgress({ current: 0, total: 0 });
    try {
      // RPC en DB: 10-50x más rápido que iterar en JS, y respeta la misma
      // lógica que el trigger AFTER INSERT (consistencia 1:1).
      const stats = await applyPendingRulesViaRPC(5000);
      setLastResult({
        total: stats.processed,
        categorized: stats.matched,
        skipped: stats.processed - stats.matched,
        errors: 0,
      });
    } catch (e: any) {
      // Fallback al método legacy en TS por si el RPC no existe (DB sin migration)
      console.warn('RPC apply_pending_rules_for_user falló, usando fallback TS:', e?.message);
      try {
        const result = await applyRulesToAllUserTransactions((current, total) => {
          setApplyProgress({ current, total });
        });
        setLastResult(result);
      } catch (e2: any) {
        toast.error('Error aplicando reglas: ' + (e2?.message ?? 'intenta de nuevo'));
      }
    } finally {
      setApplyingAll(false);
      setApplyProgress(null);
    }
  };

  const handleToggle = async (rule: ReconciliationRule, active: boolean) => {
    try {
      await toggleRule.mutateAsync({ id: rule.id, active });
    } catch (e: any) {
      toast.error('No pude actualizar el estado: ' + (e?.message ?? 'Intenta de nuevo'));
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteRule.mutateAsync(confirmDelete.id);
      toast.success('Regla eliminada');
      setConfirmDelete(undefined);
    } catch (e: any) {
      toast.error('No pude eliminar la regla: ' + (e?.message ?? 'Intenta de nuevo'));
    }
  };

  const openEdit = (rule: ReconciliationRule) => {
    setEditRule(rule);
    setEditOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">Aún no tenés reglas configuradas</p>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          Las reglas se crean desde la pestaña <strong>Patrones</strong>, sobre las sugerencias de alta confianza que detecta Nico.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stats de auto-matching (últimos 30 días) */}
      {matchStats.data && matchStats.data.total_last_30d > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="p-2 rounded border border-success/30 bg-success/5">
            <p className="text-muted-foreground">🤖 Auto al INSERT</p>
            <p className="font-bold font-mono">{matchStats.data.by_source.trigger}</p>
          </div>
          <div className="p-2 rounded border border-primary/30 bg-primary/5">
            <p className="text-muted-foreground">📥 Al subir CSV</p>
            <p className="font-bold font-mono">{matchStats.data.by_source.manual}</p>
          </div>
          <div className="p-2 rounded border border-warning/30 bg-warning/5">
            <p className="text-muted-foreground">🔁 Cron retroactivo</p>
            <p className="font-bold font-mono">{matchStats.data.by_source.retro_cron}</p>
          </div>
          <div className="p-2 rounded border border-border bg-card">
            <p className="text-muted-foreground">✋ Botón manual</p>
            <p className="font-bold font-mono">{matchStats.data.by_source.frontend}</p>
          </div>
          <div className="col-span-2 sm:col-span-4 text-[11px] text-muted-foreground italic">
            <strong>{matchStats.data.total_last_30d}</strong> auto-matches en los últimos 30 días
            {matchStats.data.last_match_at && (
              <> · último: {new Date(matchStats.data.last_match_at).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Zap className="h-3.5 w-3.5 text-success" />
          <span>
            <strong>{rules.length}</strong> regla{rules.length > 1 ? 's' : ''} configurada{rules.length > 1 ? 's' : ''} —{' '}
            {rules.filter(r => r.active).length} activa{rules.filter(r => r.active).length === 1 ? '' : 's'}
          </span>
        </div>
        <Button
          onClick={handleApplyAll}
          disabled={applyingAll || activeRulesCount === 0}
          size="sm"
          variant="outline"
          className="gap-2"
          title="Aplica tus reglas activas a las transacciones sin categoría ya existentes (incluye movimientos de meses anteriores o migrados)."
        >
          {applyingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Aplicar a transacciones existentes
        </Button>
      </div>

      {applyingAll && applyProgress && applyProgress.total > 0 && (
        <div className="space-y-1">
          <Progress value={Math.round((applyProgress.current / applyProgress.total) * 100)} className="h-2" />
          <p className="text-[11px] text-muted-foreground text-center">
            {applyProgress.current} / {applyProgress.total} transacciones
          </p>
        </div>
      )}

      {lastResult && !applyingAll && (
        <div className="text-xs bg-muted/40 border border-border rounded-md p-3 space-y-0.5">
          <p className="font-medium text-foreground">Última ejecución</p>
          <p className="text-muted-foreground">
            {lastResult.total} sin categoría revisadas · <span className="text-success">{lastResult.categorized} categorizadas</span>
            {' · '}
            {lastResult.skipped} sin match
            {lastResult.errors > 0 && <span className="text-destructive"> · {lastResult.errors} errores</span>}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {rules.map(rule => (
          <div
            key={rule.id}
            className={`rounded-xl border p-4 transition-colors ${
              rule.active ? 'border-border bg-card' : 'border-border bg-muted/30 opacity-70'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                {/* Header */}
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="text-sm font-semibold text-foreground">{rule.name}</span>
                  <Badge
                    variant="outline"
                    className={
                      rule.tx_type === 'ingreso'
                        ? 'border-success/40 text-success text-[10px]'
                        : 'border-orange-400/40 text-orange-500 text-[10px]'
                    }
                  >
                    {rule.tx_type}
                  </Badge>
                  {rule.keyword_is_regex && (
                    <Badge variant="outline" className="border-primary/40 text-primary text-[10px]" title="Esta regla usa regex avanzado">
                      regex
                    </Badge>
                  )}
                  {rule.match_count > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      Aplicada {rule.match_count} {rule.match_count === 1 ? 'vez' : 'veces'}
                    </span>
                  )}
                </div>

                {/* Description */}
                {rule.description && (
                  <p className="text-xs text-muted-foreground mb-1.5">{rule.description}</p>
                )}

                {/* Detail line */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {(rule.keyword || rule.pattern_ref) && (
                    <span>
                      Detecta:{' '}
                      <span className="font-mono text-foreground">
                        {rule.keyword || rule.pattern_ref}
                      </span>
                    </span>
                  )}
                  {rule.category_name && (
                    <span>
                      Categoría: <span className="text-foreground">{rule.category_name}</span>
                    </span>
                  )}
                  {rule.responsible_name && (
                    <span>
                      Beneficiario: <span className="text-foreground">{rule.responsible_name}</span>
                    </span>
                  )}
                  {(rule.amount_min != null || rule.amount_max != null) && (
                    <span>
                      Monto:{' '}
                      <span className="text-foreground">
                        {rule.amount_min != null ? formatCOP(rule.amount_min) : '—'} a{' '}
                        {rule.amount_max != null ? formatCOP(rule.amount_max) : '—'}
                      </span>
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <Switch
                  checked={rule.active}
                  onCheckedChange={(v) => handleToggle(rule, v)}
                  aria-label="Activar regla"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => openEdit(rule)}
                  aria-label="Editar regla"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(rule)}
                  aria-label="Eliminar regla"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Edit modal (reuses CrearReglaModal in edit mode) */}
      <CrearReglaModal
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          setEditRule(undefined);
        }}
        editRule={editRule}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta regla?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.name && (
                <>
                  Vas a eliminar <strong>{confirmDelete.name}</strong>. Nico dejará de aplicarla
                  automáticamente. Esta acción no se puede deshacer.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
