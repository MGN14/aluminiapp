// /admin — dashboard interno del founder. Muestra KPIs en vivo de uso de la
// app, lista de clientes, errores recientes, top usuarios Nico, etc.
//
// Acceso restringido por email hardcodeado en el componente Y en la edge
// function admin-stats. Si el caller no es founder, redirect a /dashboard.

import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, RefreshCw, Users, TrendingUp, MessageSquare, AlertTriangle, DollarSign, UserCheck } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const FOUNDER_EMAIL = 'niko14_gomez@hotmail.com';

interface AdminStats {
  ok: boolean;
  generated_at: string;
  kpis: {
    signups_total: number;
    signups_7d: number;
    signups_30d: number;
    dau_7d_avg: number;
    mau_30d: number;
    nico_queries_7d: number;
    nico_queries_30d: number;
    errors_7d: number;
    payments_ok_30d: number;
    payments_failed_30d: number;
  };
  customers: Array<{
    user_id: string;
    email: string;
    full_name: string | null;
    plan: string;
    plan_status: string;
    plan_expires_at: string | null;
    signed_up_at: string;
    last_login_at: string | null;
    days_since_login: number;
    extracto_count: number;
    invoice_count: number;
    siigo_connected: boolean;
    nico_queries_90d: number;
    errors_90d: number;
  }>;
  top_nico_users: Array<{
    user_id: string;
    email: string;
    queries_7d: number;
  }>;
  nico_by_agent: Array<{ agent: string; count: number }>;
  recent_errors: Array<{
    id: string;
    user_email: string;
    flow: string;
    error: string;
    occurred_at: string;
  }>;
  recent_signups: Array<{
    user_email: string;
    user_name: string;
    provider: string;
    occurred_at: string;
  }>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'd MMM yy, HH:mm', { locale: es });
  } catch {
    return '—';
  }
}

function StatCard({ label, value, sub, icon: Icon, accent }: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof Users;
  accent?: 'success' | 'warning' | 'danger';
}) {
  const accentColor = accent === 'success' ? 'oklch(0.43 0.14 155)'
    : accent === 'warning' ? '#664d03'
    : accent === 'danger' ? '#842029'
    : '#1d1d1f';
  return (
    <div style={{
      background: '#fff',
      borderRadius: 14,
      padding: '18px 20px',
      border: '1.5px solid rgba(0,0,0,0.07)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon style={{ width: 14, height: 14, color: '#a1a1a6' }} />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.6px', textTransform: 'uppercase', color: '#a1a1a6' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.5px', color: accentColor, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isFounder = user?.email?.toLowerCase() === FOUNDER_EMAIL;

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('admin-stats', {
        body: {},
      });
      if (fnError) throw fnError;
      if (!data?.ok) throw new Error(data?.error ?? 'Error desconocido');
      setStats(data as AdminStats);
    } catch (err: any) {
      console.error('admin-stats error:', err);
      setError(err.message ?? 'No se pudieron cargar los datos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isFounder) fetchStats();
  }, [isFounder]);

  // Mientras carga la sesión, mostrar loader
  if (authLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  // Si no es founder, redirect a dashboard
  if (!isFounder) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AppLayout>
      <div className="max-w-full mx-auto space-y-5 px-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Admin · Telemetría AluminIA</h1>
            <p className="text-muted-foreground text-sm">
              {stats?.generated_at
                ? `Actualizado ${fmtDate(stats.generated_at)}`
                : 'Cargando datos...'}
            </p>
          </div>
          <Button onClick={fetchStats} disabled={loading} variant="outline" className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refrescar
          </Button>
        </div>

        {error && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="py-4 flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </CardContent>
          </Card>
        )}

        {loading && !stats && (
          <Card>
            <CardContent className="py-16 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        )}

        {stats && (
          <>
            {/* KPIs */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
            }}>
              <StatCard label="Signups totales" value={stats.kpis.signups_total} sub={`+${stats.kpis.signups_7d} esta semana`} icon={Users} accent="success" />
              <StatCard label="DAU promedio (7d)" value={stats.kpis.dau_7d_avg} sub={`MAU ${stats.kpis.mau_30d}`} icon={UserCheck} />
              <StatCard label="Nico queries (7d)" value={stats.kpis.nico_queries_7d} sub={`${stats.kpis.nico_queries_30d} en 30 días`} icon={MessageSquare} />
              <StatCard label="Pagos OK (30d)" value={stats.kpis.payments_ok_30d} icon={DollarSign} accent="success" />
              <StatCard label="Pagos fallidos (30d)" value={stats.kpis.payments_failed_30d} icon={DollarSign} accent={stats.kpis.payments_failed_30d > 0 ? 'danger' : undefined} />
              <StatCard label="Errores (7d)" value={stats.kpis.errors_7d} icon={AlertTriangle} accent={stats.kpis.errors_7d > 0 ? 'warning' : undefined} />
            </div>

            {/* Clientes */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Todos los clientes ({stats.customers.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 sm:p-6 sm:pt-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Email</TableHead>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Plan</TableHead>
                        <TableHead>Signed up</TableHead>
                        <TableHead>Último login</TableHead>
                        <TableHead className="text-right">Extractos</TableHead>
                        <TableHead className="text-right">Facturas</TableHead>
                        <TableHead>Siigo</TableHead>
                        <TableHead className="text-right">Nico (90d)</TableHead>
                        <TableHead className="text-right">Errores</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.customers.map((c) => {
                        const atRisk = c.days_since_login >= 7;
                        return (
                          <TableRow key={c.user_id} className={atRisk ? 'bg-warning/5' : ''}>
                            <TableCell className="text-sm font-medium max-w-[220px] truncate" title={c.email}>
                              {c.email}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                              {c.full_name ?? '—'}
                            </TableCell>
                            <TableCell>
                              <Badge variant={c.plan === 'empresarial' || c.plan === 'pro' ? 'default' : 'secondary'} className="text-xs">
                                {c.plan}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {fmtDate(c.signed_up_at)}
                            </TableCell>
                            <TableCell className="text-xs">
                              {c.last_login_at ? (
                                <span className={atRisk ? 'text-warning font-medium' : 'text-muted-foreground'}>
                                  {fmtDate(c.last_login_at)}
                                  {c.days_since_login >= 1 && (
                                    <span className="ml-1 text-[10px] opacity-70">
                                      ({c.days_since_login}d)
                                    </span>
                                  )}
                                </span>
                              ) : '—'}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{c.extracto_count}</TableCell>
                            <TableCell className="text-right tabular-nums">{c.invoice_count}</TableCell>
                            <TableCell>
                              {c.siigo_connected ? (
                                <Badge variant="outline" className="text-xs border-success text-success">✓</Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {c.nico_queries_90d}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {c.errors_90d > 0 ? (
                                <span className="text-destructive font-medium">{c.errors_90d}</span>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Two columns: Top Nico Users + Nico by agent */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Top usuarios Nico IA (7d)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuario</TableHead>
                        <TableHead className="text-right">Queries</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.top_nico_users.length === 0 ? (
                        <TableRow><TableCell colSpan={2} className="text-center text-sm text-muted-foreground py-6">— Sin uso esta semana —</TableCell></TableRow>
                      ) : stats.top_nico_users.map((u) => (
                        <TableRow key={u.user_id}>
                          <TableCell className="text-sm">{u.email}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{u.queries_7d}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Nico por agente (30d)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agente</TableHead>
                        <TableHead className="text-right">Queries</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.nico_by_agent.length === 0 ? (
                        <TableRow><TableCell colSpan={2} className="text-center text-sm text-muted-foreground py-6">— Sin datos —</TableCell></TableRow>
                      ) : stats.nico_by_agent.map((a) => (
                        <TableRow key={a.agent}>
                          <TableCell className="text-sm font-medium">{a.agent}</TableCell>
                          <TableCell className="text-right tabular-nums">{a.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* Recent signups */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Signups recientes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Cuándo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.recent_signups.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">— Sin signups recientes —</TableCell></TableRow>
                    ) : stats.recent_signups.map((s, i) => (
                      <TableRow key={`${s.user_email}-${i}`}>
                        <TableCell className="text-sm font-medium">{s.user_email}</TableCell>
                        <TableCell className="text-sm">{s.user_name}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{s.provider}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(s.occurred_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Recent errors */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Errores en flujos críticos (7d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Flujo</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>Cuándo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.recent_errors.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">— Sin errores esta semana 🎉 —</TableCell></TableRow>
                    ) : stats.recent_errors.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-sm">{e.user_email}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{e.flow}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[400px] truncate" title={e.error}>{e.error}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(e.occurred_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
