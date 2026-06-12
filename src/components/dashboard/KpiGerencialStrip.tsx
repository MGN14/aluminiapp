import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, Gauge, Timer, RefreshCcw, Target, TrendingUp } from 'lucide-react';
import { useInformeBancoData, type SemaforoColor } from '@/hooks/useInformeBancoData';
import { usePermissions } from '@/hooks/usePermissions';
import { useDataOwner } from '@/hooks/useDataOwner';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * KPIs de decisión que ya se calculaban en useInformeBancoData pero solo se
 * veían en /informe-banco (un módulo cuyo propósito es pedir crédito). Acá
 * se promueven al dashboard del lunes: margen, DSO, rotación y break-even.
 */

function fmtShort(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

const SEMAFORO_DOT: Record<SemaforoColor, string> = {
  green: 'bg-success',
  yellow: 'bg-amber-500',
  red: 'bg-destructive',
};

function semaforoMargen(pct: number): SemaforoColor {
  if (pct >= 10) return 'green';
  if (pct >= 5) return 'yellow';
  return 'red';
}
function semaforoDSO(d: number | null): SemaforoColor {
  if (d === null) return 'yellow';
  if (d < 45) return 'green';
  if (d <= 90) return 'yellow';
  return 'red';
}
function semaforoYoY(pct: number | null): SemaforoColor {
  if (pct === null) return 'yellow';
  if (pct > 5) return 'green';
  if (pct >= 0) return 'yellow';
  return 'red';
}

interface KpiDef {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  semaforo: SemaforoColor;
}

function StripContent() {
  const { data, isLoading } = useInformeBancoData();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i} className="border-0 shadow-sm"><CardContent className="p-4"><Skeleton className="h-3 w-16 mb-2" /><Skeleton className="h-6 w-20" /></CardContent></Card>
        ))}
      </div>
    );
  }
  if (!data) return null;

  const kpis: KpiDef[] = [
    {
      icon: Gauge,
      label: 'Margen operativo',
      value: `${data.margenOperativoPct.toFixed(1)}%`,
      hint: `Año ${data.thisYear} (banco)`,
      semaforo: semaforoMargen(data.margenOperativoPct),
    },
    {
      icon: TrendingUp,
      label: 'Crecimiento YoY',
      value: data.crecimientoYoYPct === null ? '—' : `${data.crecimientoYoYPct >= 0 ? '+' : ''}${data.crecimientoYoYPct.toFixed(1)}%`,
      hint: `Ingresos vs ${data.thisYear - 1}`,
      semaforo: semaforoYoY(data.crecimientoYoYPct),
    },
    {
      icon: Timer,
      label: 'Días de cartera (DSO)',
      value: data.dsoDays === null ? '—' : `${data.dsoDays}d`,
      hint: 'Cuánto tardás en cobrar',
      semaforo: semaforoDSO(data.dsoDays),
    },
    {
      icon: RefreshCcw,
      label: 'Rotación inventario',
      value: data.rotacionInventario > 0 ? `${data.rotacionInventario.toFixed(1)}×` : '—',
      hint: data.diasInventario ? `~${data.diasInventario} días en bodega` : 'Sin inventario valorizado',
      semaforo: data.rotacionInventario >= 4 ? 'green' : data.rotacionInventario >= 2 ? 'yellow' : 'red',
    },
    {
      icon: Target,
      label: 'Punto de equilibrio',
      value: data.puntoEquilibrioMensual > 0 ? `${fmtShort(data.puntoEquilibrioMensual)}/mes` : '—',
      hint: data.promedioVentasMensual > 0
        ? `Vendés ${fmtShort(data.promedioVentasMensual)}/mes prom.`
        : 'Necesita ingresos del año',
      semaforo: data.puntoEquilibrioMensual > 0 && data.promedioVentasMensual >= data.puntoEquilibrioMensual ? 'green' : 'red',
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          KPIs gerenciales
        </p>
        <Link
          to="/informe-banco"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        >
          Ver informe completo <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium text-muted-foreground leading-tight">{k.label}</p>
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${SEMAFORO_DOT[k.semaforo]}`} />
                  <p className="text-lg font-bold text-foreground tabular-nums leading-none">{k.value}</p>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">{k.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function KpiGerencialStrip() {
  const { hasModule, loading } = usePermissions();
  const { isCollaborator, loading: ownerLoading } = useDataOwner();
  // Mismo permiso que el módulo de origen de estas métricas. Colaboradores
  // excluidos: useInformeBancoData consulta con el user_id propio (no el del
  // owner), así que verían ceros y semáforos rojos falsos.
  if (loading || ownerLoading || isCollaborator || !hasModule('informe_banco')) return null;
  return <StripContent />;
}
