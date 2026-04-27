// Checklist del trial — 6 pasos para configurar AluminIA al 100%.
//
// Cambio importante respecto a la versión anterior: el estado de cada item
// se calcula DINÁMICAMENTE desde las tablas (count queries livianas), no
// desde un flag persistido. Esto resuelve el bug que reportó el cliente:
// "subí el extracto pero el item sigue en pendiente". Ahora si tenés 1+
// extracto procesado, el item se marca solo. Si los borrás todos, vuelve
// a aparecer pendiente. Es la única manera de mantener consistencia sin
// triggers en backend.
//
// El único item que sigue siendo flag local es "Revisar DIAN" — ese mide
// una visita del usuario a /financial-health, no un dato persistente.

import { useEffect, useState } from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, Circle, Upload, FileText, Link2, BarChart3,
  Sparkles, ArrowRight, Plug, Wallet, Loader2,
} from 'lucide-react';

interface ChecklistState {
  statement_uploaded: boolean;
  invoice_uploaded: boolean;
  invoice_matched: boolean;
  siigo_connected: boolean;
  initial_state_set: boolean;
  dian_reviewed: boolean;
}

const ITEMS: Array<{
  key: keyof ChecklistState;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  link: string;
  hint: string;
}> = [
  {
    key: 'statement_uploaded',
    label: 'Subir un extracto bancario',
    icon: Upload,
    link: '/statement-upload',
    hint: 'Empezá por acá: subí un PDF y AluminIA extrae todas las transacciones.',
  },
  {
    key: 'invoice_uploaded',
    label: 'Subir una factura',
    icon: FileText,
    link: '/invoices/venta',
    hint: 'Sube una factura de venta o compra para que se cruce con tus movimientos.',
  },
  {
    key: 'invoice_matched',
    label: 'Asociar factura a movimiento',
    icon: Link2,
    link: '/transactions',
    hint: 'Vinculá un pago bancario con la factura correspondiente.',
  },
  {
    key: 'siigo_connected',
    label: 'Conectar Siigo',
    icon: Plug,
    link: '/settings',
    hint: 'Sincronizá tus facturas DIAN automáticamente desde Siigo.',
  },
  {
    key: 'initial_state_set',
    label: 'Configurar estado financiero inicial',
    icon: Wallet,
    link: '/onboarding',
    hint: 'Carga tu saldo inicial, CxC y CxP para que los reportes sean exactos.',
  },
  {
    key: 'dian_reviewed',
    label: 'Revisar las cuentas con la DIAN',
    icon: BarChart3,
    link: '/financial-health',
    hint: 'Mira tu score de salud financiera y qué corregir antes de una visita.',
  },
];

export default function TrialChecklist() {
  const { user } = useAuth();
  const { isTrialing, loading: subLoading, isAdmin, isFounder } = useSubscription();
  const [state, setState] = useState<ChecklistState | null>(null);

  useEffect(() => {
    if (!user || subLoading || !isTrialing || isAdmin || isFounder) return;
    let active = true;
    (async () => {
      const result = await computeChecklist(user.id);
      if (active) setState(result);
    })();
    return () => { active = false; };
  }, [user?.id, subLoading, isTrialing, isAdmin, isFounder]);

  if (subLoading || !isTrialing || isAdmin || isFounder) return null;
  if (!state) {
    return (
      <Card className="border-accent/30 bg-accent/5">
        <CardContent className="py-6 flex items-center justify-center text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Cargando checklist…</span>
        </CardContent>
      </Card>
    );
  }

  const completedCount = Object.values(state).filter(Boolean).length;
  const total = ITEMS.length;
  const allComplete = completedCount === total;
  const progressPct = Math.round((completedCount / total) * 100);

  return (
    <Card className="border-accent/30 bg-accent/5 animate-fade-in">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" />
            <CardTitle className="text-base">
              {allComplete
                ? '¡Estás usando AluminIA al 100%!'
                : 'Para aprovechar tu prueba al máximo:'}
            </CardTitle>
          </div>
          <div className="text-xs font-medium text-muted-foreground tabular-nums">
            {completedCount}/{total} ({progressPct}%)
          </div>
        </div>
        {/* Barra de progreso */}
        <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-2">
          <div
            className="h-full bg-success transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {allComplete ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Activa tu plan Empresarial para continuar con todas las funciones.
            </p>
            <Link to="/pricing">
              <Button className="gap-1">
                Activar Plan Empresarial
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {ITEMS.map(({ key, label, icon: Icon, link, hint }) => {
              const done = state[key];
              return (
                <Link
                  key={key}
                  to={link}
                  className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                    done
                      ? 'border-success/30 bg-success/5'
                      : 'border-border hover:border-accent/50 hover:bg-accent/5'
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 flex-shrink-0 ${done ? 'text-success' : 'text-muted-foreground'}`} />
                      <span className={`text-sm font-medium ${done ? 'text-success line-through' : 'text-foreground'}`}>
                        {label}
                      </span>
                    </div>
                    {!done && (
                      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                        {hint}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Cálculo dinámico ----------

async function computeChecklist(userId: string): Promise<ChecklistState> {
  // Todas las queries en paralelo. Cada una es un count liviano por user_id
  // con limit 1 (excepto las que necesitan filtros). Ningún COUNT exacto —
  // solo necesitamos saber si hay AL MENOS UNO.
  const [
    stmtRes,
    invRes,
    matchedTxRes,
    siigoRes,
    initialRes,
  ] = await Promise.all([
    // 1. Extracto procesado con transacciones
    supabase
      .from('bank_statements')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('processed', true)
      .is('deleted_at', null)
      .limit(1),
    // 2. Al menos una factura
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .limit(1),
    // 3. Al menos una transacción vinculada a factura
    supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null)
      .not('invoice_id', 'is', null)
      .limit(1),
    // 4. Siigo conectado (existe credencial)
    supabase
      .from('user_siigo_credentials' as any)
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .limit(1),
    // 5. Estado financiero inicial configurado (al menos 1 detalle)
    supabase
      .from('initial_state_details' as any)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .limit(1),
  ]);

  const stmtCount = stmtRes.count ?? 0;
  const invCount = invRes.count ?? 0;
  const matchedTxCount = matchedTxRes.count ?? 0;
  const siigoCount = siigoRes.count ?? 0;
  const initialCount = initialRes.count ?? 0;

  // dian_reviewed: flag local en localStorage. Marcarlo cuando el user
  // visita /financial-health (lo hacemos en VisitaDIAN.tsx). No hay un
  // dato canónico en DB para esto.
  const dianReviewed = localStorage.getItem(`aluminia_dian_reviewed_${userId}`) === '1';

  return {
    statement_uploaded: stmtCount > 0,
    invoice_uploaded: invCount > 0,
    invoice_matched: matchedTxCount > 0,
    siigo_connected: siigoCount > 0,
    initial_state_set: initialCount > 0,
    dian_reviewed: dianReviewed,
  };
}
