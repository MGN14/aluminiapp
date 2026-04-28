// Checklist del trial — 10 pasos para configurar AluminIA al 100%.
//
// Cambios desde la v anterior:
//   - 6 → 10 items (agregamos venta/compra separadas, ReteICA, categorización
//     5+, colaborador).
//   - Estado se calcula dinámicamente desde tablas (queries livianas con
//     count head:true). Nada de flags persistidos que se desincronicen.
//   - Items COMPLETADOS desaparecen de la lista. Solo se muestran pendientes.
//     Cuando llega al 100%, el card entero se oculta (return null).
//   - Banner de progreso muestra "Te faltan X pasos" en vez de "X/N".

import { useEffect, useState } from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import {
  Circle, Upload, FileText, FileInput, Link2, BarChart3,
  Sparkles, Plug, Wallet, Loader2, Tags, Percent, Users,
} from 'lucide-react';

interface ChecklistState {
  statement_uploaded: boolean;
  invoice_venta_uploaded: boolean;
  invoice_compra_uploaded: boolean;
  invoice_matched: boolean;
  siigo_connected: boolean;
  initial_state_set: boolean;
  reteica_configured: boolean;
  transactions_categorized: boolean;
  collaborator_added: boolean;
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
    key: 'invoice_venta_uploaded',
    label: 'Subir una factura de venta',
    icon: FileText,
    link: '/invoices/venta',
    hint: 'Carga una factura que emitiste a un cliente para cruzarla con cobros.',
  },
  {
    key: 'invoice_compra_uploaded',
    label: 'Subir una factura de compra',
    icon: FileInput,
    link: '/invoices/compra',
    hint: 'Carga una factura de proveedor para que AluminIA registre tus gastos.',
  },
  {
    key: 'invoice_matched',
    label: 'Asociar factura a movimiento',
    icon: Link2,
    link: '/transactions',
    hint: 'Vinculá un pago bancario con la factura correspondiente.',
  },
  {
    key: 'transactions_categorized',
    label: 'Categorizar 5 transacciones',
    icon: Tags,
    link: '/transactions',
    hint: 'Asigná categoría y responsable para que los reportes sean exactos.',
  },
  {
    key: 'siigo_connected',
    label: 'Conectar Siigo',
    icon: Plug,
    link: '/settings',
    hint: 'Sincronizá facturas DIAN automáticamente desde Siigo.',
  },
  {
    key: 'initial_state_set',
    label: 'Configurar estado financiero inicial',
    icon: Wallet,
    link: '/onboarding',
    hint: 'Carga tu saldo inicial, CxC y CxP para que los reportes sean exactos.',
  },
  {
    key: 'reteica_configured',
    label: 'Configurar tarifa ReteICA',
    icon: Percent,
    link: '/settings',
    hint: 'Define tu tarifa según el municipio para calcular bien las retenciones.',
  },
  {
    key: 'collaborator_added',
    label: 'Agregar un colaborador',
    icon: Users,
    link: '/colaboradores',
    hint: 'Sumá a tu contador o equipo para que vean los datos sin compartir clave.',
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
  const pendingItems = ITEMS.filter((i) => !state[i.key]);
  const allComplete = completedCount === total;
  const progressPct = Math.round((completedCount / total) * 100);

  // Cuando llega al 100%, todo el checklist desaparece. El usuario ya está
  // configurado, no tiene sentido seguir mostrándolo.
  if (allComplete) return null;

  return (
    <Card className="border-accent/30 bg-accent/5 animate-fade-in">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" />
            <CardTitle className="text-base">
              Para aprovechar tu prueba al máximo:
            </CardTitle>
          </div>
          <div className="text-xs font-medium text-muted-foreground tabular-nums">
            {completedCount}/{total} ({progressPct}%) · te faltan {pendingItems.length}
          </div>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-2">
          <div
            className="h-full bg-success transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-2">
          {pendingItems.map(({ key, label, icon: Icon, link, hint }) => (
            <Link
              key={key}
              to={link}
              className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-accent/50 hover:bg-accent/5 transition-colors"
            >
              <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{label}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                  {hint}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Cálculo dinámico ----------

async function computeChecklist(userId: string): Promise<ChecklistState> {
  const [
    stmtRes,
    invVentaRes,
    invCompraRes,
    matchedTxRes,
    siigoRes,
    initialRes,
    profileRes,
    categorizedTxRes,
    collabRes,
  ] = await Promise.all([
    // 1. Extracto bancario procesado
    supabase
      .from('bank_statements')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('processed', true)
      .is('deleted_at', null)
      .limit(1),
    // 2. Factura de venta
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'venta')
      .limit(1),
    // 3. Factura de compra
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'compra')
      .limit(1),
    // 4. Transacción vinculada a factura
    supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null)
      .not('invoice_id', 'is', null)
      .limit(1),
    // 5. Siigo conectado
    supabase
      .from('user_siigo_credentials' as any)
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .limit(1),
    // 6. Estado inicial configurado
    supabase
      .from('initial_state_details' as any)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .limit(1),
    // 7. ReteICA configurado (rate > 0)
    supabase
      .from('profiles')
      .select('reteica_rate')
      .eq('user_id', userId)
      .maybeSingle(),
    // 8. Categorizar 5+ transacciones (count exact con head para no traer rows)
    supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null)
      .not('category_id', 'is', null),
    // 9. Colaborador agregado
    supabase
      .from('collaborators')
      .select('id', { count: 'exact', head: true })
      .eq('owner_user_id', userId)
      .limit(1),
  ]);

  const stmtCount = stmtRes.count ?? 0;
  const invVentaCount = invVentaRes.count ?? 0;
  const invCompraCount = invCompraRes.count ?? 0;
  const matchedTxCount = matchedTxRes.count ?? 0;
  const siigoCount = siigoRes.count ?? 0;
  const initialCount = initialRes.count ?? 0;
  const reteicaRate = Number((profileRes.data as any)?.reteica_rate ?? 0);
  const categorizedCount = categorizedTxRes.count ?? 0;
  const collabCount = collabRes.count ?? 0;

  const dianReviewed = localStorage.getItem(`aluminia_dian_reviewed_${userId}`) === '1';

  // Si Siigo está conectado, las facturas se sincronizan automáticamente —
  // pedirle al usuario "subir factura de venta/compra" deja de tener sentido.
  // Damos por completados ambos checks aunque la sincronización todavía no
  // haya corrido (la conexión es la acción del usuario, el resto es automático).
  const siigoConnected = siigoCount > 0;

  return {
    statement_uploaded: stmtCount > 0,
    invoice_venta_uploaded: invVentaCount > 0 || siigoConnected,
    invoice_compra_uploaded: invCompraCount > 0 || siigoConnected,
    invoice_matched: matchedTxCount > 0,
    siigo_connected: siigoConnected,
    initial_state_set: initialCount > 0,
    reteica_configured: reteicaRate > 0,
    transactions_categorized: categorizedCount >= 5,
    collaborator_added: collabCount > 0,
    dian_reviewed: dianReviewed,
  };
}
