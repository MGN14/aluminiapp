// Centro de migración — "Montá tu negocio en AluminIA".
//
// El wizard de onboarding configura lo FISCAL; esta página migra los DATOS.
// Cada paso responde tres preguntas: qué necesitás, de dónde lo sacás, y
// DÓNDE SE SUBE (botón directo al lugar exacto). El progreso se deriva de
// los datos reales (useMigrationStatus) — nunca hay un check manual: si
// subiste el extracto, el paso se tacha solo.

import { Link, useNavigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Rocket, CheckCircle2, Circle, Building2, Wallet, Plug, Package,
  FileText, Landmark, Users, Scale, ArrowRight, Loader2,
} from 'lucide-react';
import { useMigrationStatus, migrationProgress, type MigrationStatus } from '@/hooks/useMigrationStatus';

interface StepDef {
  key: keyof MigrationStatus;
  optional?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  /** Qué es y por qué importa — 1 línea. */
  why: string;
  /** De dónde sacás la información (contador, Siigo, app del banco…). */
  need: string;
  /** A dónde lleva el CTA — el lugar EXACTO donde se sube. */
  link: string;
  cta: string;
  /** Dato real para mostrar cuando está hecho. */
  doneDetail?: (s: MigrationStatus) => string;
}

const STEPS: StepDef[] = [
  {
    key: 'fiscal_done',
    icon: Building2,
    title: 'Contale a la app quién sos',
    why: 'NIT, régimen y actividad definen qué impuestos calculamos y qué reportes ves.',
    need: 'Tu RUT a mano (o el NIT de la empresa). Son 5 preguntas, 3 minutos.',
    link: '/onboarding',
    cta: 'Completar perfil fiscal',
  },
  {
    key: 'initial_done',
    icon: Wallet,
    title: 'La foto de arranque: saldos iniciales',
    why: 'Todo cuelga de acá: la fecha de corte y con qué arrancás (bancos, quién te debe, a quién le debés).',
    need: 'Pedile al contador los saldos a la fecha de corte: bancos, cartera por cliente, deudas por proveedor, anticipos. Si no tenés contador, con el extracto del banco alcanza para empezar.',
    link: '/settings#estado-inicial',
    cta: 'Cargar saldos iniciales',
    doneDetail: (s) => `${s.initial_details} saldos cargados`,
  },
  {
    key: 'siigo_done',
    optional: true,
    icon: Plug,
    title: 'Conectá Siigo (si lo usás)',
    why: 'Con Siigo conectado, facturas y productos entran solos — te ahorrás los dos pasos siguientes.',
    need: 'Usuario API y access key de Siigo: en Siigo Nube → Configuración → Credenciales API.',
    link: '/settings#siigo',
    cta: 'Conectar Siigo',
  },
  {
    key: 'products_done',
    icon: Package,
    title: 'Tus productos e inventario',
    why: 'El maestro de referencias: sin él no hay remisiones, stock ni costeo.',
    need: 'Con Siigo conectado se sincronizan solos. Sin Siigo: creá tu primera remisión de COMPRA con el Excel de tu proveedor — las referencias nuevas se crean solas al guardarla.',
    link: '/inventarios',
    cta: 'Ir a Inventario',
    doneDetail: (s) => `${s.products_count} productos en el maestro`,
  },
  {
    key: 'invoices_done',
    icon: FileText,
    title: 'Tus facturas',
    why: 'Ventas y compras: de acá salen cartera, IVA y el P&G.',
    need: 'Con Siigo: se sincronizan solas. Sin Siigo: subí el XML o PDF de tus facturas electrónicas (el que llega al correo de facturación).',
    link: '/invoices/venta',
    cta: 'Subir facturas',
    doneDetail: (s) => (s.invoices_count > 0 ? `${s.invoices_count} facturas` : 'Siigo las trae solo'),
  },
  {
    key: 'bank_done',
    icon: Landmark,
    title: 'El extracto del banco',
    why: 'Los movimientos reales de plata: con esto la conciliación cruza pagos con facturas.',
    need: 'Descargá el extracto en PDF o CSV desde la app o portal del banco (Bancolombia y Davivienda soportados). Uno por mes, desde tu fecha de corte.',
    link: '/statement-upload',
    cta: 'Subir extracto',
    doneDetail: (s) => `${s.statements_count} extractos · ${s.transactions_count} movimientos`,
  },
  {
    key: 'team_done',
    optional: true,
    icon: Users,
    title: 'Invitá a tu equipo',
    why: 'Tu contador o la persona de bodega ven lo que les toca, sin compartir tu clave.',
    need: 'Solo el email de cada persona. Los permisos se definen por módulo.',
    link: '/colaboradores',
    cta: 'Invitar colaborador',
  },
];

export default function Migracion() {
  const navigate = useNavigate();
  const statusQ = useMigrationStatus();
  const s = statusQ.data;

  const progress = s ? migrationProgress(s) : null;
  const allDone = progress?.done === progress?.total && !!progress;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <Rocket className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Montá tu negocio en AluminIA</h1>
            <p className="text-sm text-muted-foreground">
              Paso a paso, cada botón te deja parado exactamente donde se sube cada cosa.
            </p>
          </div>
        </div>

        {statusQ.isLoading || !s ? (
          <div className="py-16 text-center text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Mirando qué tenés cargado…
          </div>
        ) : (
          <>
            {/* Progreso de obligatorios */}
            <Card className={cn(allDone && 'border-success/40 bg-success/5')}>
              <CardContent className="py-4 px-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    {allDone ? '🎉 Migración completa — tu negocio ya vive acá' : 'Tu progreso'}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {progress!.done}/{progress!.total} pasos clave
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-success transition-all duration-500" style={{ width: `${progress!.pct}%` }} />
                </div>
              </CardContent>
            </Card>

            {/* Pasos */}
            <div className="space-y-3">
              {STEPS.map((step, i) => {
                const done = s[step.key] === true;
                const Icon = step.icon;
                return (
                  <Card key={step.key} className={cn('transition-colors', done && 'bg-muted/30')}>
                    <CardContent className="py-4 px-5">
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 mt-0.5">
                          {done ? (
                            <CheckCircle2 className="h-5 w-5 text-success" />
                          ) : (
                            <Circle className="h-5 w-5 text-muted-foreground/40" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Icon className={cn('h-4 w-4', done ? 'text-muted-foreground' : 'text-primary')} />
                            <span className={cn('font-medium text-sm', done && 'line-through text-muted-foreground')}>
                              {i + 1}. {step.title}
                            </span>
                            {step.optional && <Badge variant="outline" className="text-[9px]">opcional</Badge>}
                            {done && step.doneDetail && (
                              <Badge variant="secondary" className="text-[9px]">{step.doneDetail(s)}</Badge>
                            )}
                          </div>
                          {!done && (
                            <>
                              <p className="text-xs text-muted-foreground mt-1">{step.why}</p>
                              <div className="mt-2 rounded-md bg-accent/10 border border-accent/20 px-3 py-2">
                                <span className="text-[10px] uppercase font-medium text-accent-foreground/70 block mb-0.5">
                                  Qué necesitás
                                </span>
                                <p className="text-xs">{step.need}</p>
                              </div>
                            </>
                          )}
                        </div>
                        <div className="shrink-0">
                          {done ? (
                            <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => navigate(step.link)}>
                              Revisar
                            </Button>
                          ) : (
                            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => navigate(step.link)}>
                              {step.cta} <ArrowRight className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Cierre: verificar que cuadre */}
            {allDone && (
              <Card className="border-primary/30">
                <CardContent className="py-4 px-5 flex items-start gap-3">
                  <Scale className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Último chequeo: que cuadre</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Compará el Balance General contra lo que dice tu contador (o tu cuaderno).
                      Si algo no cuadra, casi siempre es un saldo inicial — se corrige en Configuración.
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="h-8 text-xs" asChild>
                    <Link to="/reportes/balance-general">Ver Balance</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
