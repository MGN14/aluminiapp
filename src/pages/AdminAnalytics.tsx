import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useSubscription } from '@/hooks/useSubscription';
import { TrendingUp, Users, Activity, Sparkles, DollarSign, Heart, Loader2 } from 'lucide-react';

interface KPI {
  label: string;
  value: string;
  detail?: string;
}

interface AnalyticsData {
  // Crecimiento
  signupsTotal: number;
  signups7d: number;
  signups30d: number;
  // Engagement
  dau: number;
  wau: number;
  mau: number;
  stickiness: number; // DAU/MAU
  // Activación
  totalUsers: number;
  usersWithStatement: number;
  usersWithInvoice: number;
  // Nico
  nicoQueries30d: number;
  nicoCost30d: number;
  nicoFeedbackPositiveRate: number;
  nicoQueriesByAgent: Array<{ agent: string; count: number }>;
  // Encuesta
  surveyAvgRating: number;
  surveyResponses30d: number;
  // Top páginas
  topPages: Array<{ path: string; views: number }>;
  // Top features (events)
  topEvents: Array<{ event: string; count: number }>;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-CO').format(Math.round(n));
}
function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}
function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export default function AdminAnalytics() {
  const { isFounder, loading: subLoading } = useSubscription();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (subLoading) return;
    if (!isFounder) return; // no cargamos si no es founder
    void loadAnalytics();
  }, [subLoading, isFounder]);

  // Defensa en profundidad: solo el founder (niko14_gomez@hotmail.com)
  // puede ver este panel. La RLS de app_events / nico_messages / app_feedback
  // hardcodea el email también — pero este redirect le evita ver una página
  // vacía a cualquier admin que no sea founder.
  if (!subLoading && !isFounder) {
    return <Navigate to="/dashboard" replace />;
  }

  const loadAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const day = (offset: number) => {
        const d = new Date(now);
        d.setDate(d.getDate() - offset);
        return d.toISOString();
      };
      const sinceDay = day(1);
      const since7d = day(7);
      const since30d = day(30);

      // Resultados en paralelo. Usamos head:true + count para no traer rows.
      const [
        usersTotalRes,
        signups7Res,
        signups30Res,
        dauRes,
        wauRes,
        mauRes,
        statementUsersRes,
        invoiceUsersRes,
        nicoEventsRes,
        feedbackRes,
        agentRes,
        surveyRes,
        pageViewsRes,
        topEventsRes,
      ] = await Promise.all([
        supabase.from('app_events' as never)
          .select('user_id', { count: 'exact', head: false })
          .eq('event_type', 'signup'),
        supabase.from('app_events' as never)
          .select('id', { count: 'exact', head: true })
          .eq('event_type', 'signup')
          .gte('occurred_at', since7d),
        supabase.from('app_events' as never)
          .select('id', { count: 'exact', head: true })
          .eq('event_type', 'signup')
          .gte('occurred_at', since30d),
        supabase.from('app_events' as never)
          .select('user_id')
          .gte('occurred_at', sinceDay),
        supabase.from('app_events' as never)
          .select('user_id')
          .gte('occurred_at', since7d),
        supabase.from('app_events' as never)
          .select('user_id')
          .gte('occurred_at', since30d),
        supabase.from('app_events' as never)
          .select('user_id')
          .eq('event_type', 'statement_uploaded'),
        supabase.from('app_events' as never)
          .select('user_id')
          .eq('event_type', 'invoice_confirmed'),
        supabase.from('app_events' as never)
          .select('props')
          .eq('event_type', 'nico_query')
          .gte('occurred_at', since30d),
        supabase.from('nico_messages' as never)
          .select('feedback')
          .not('feedback', 'is', null)
          .gte('feedback_at', since30d),
        supabase.from('app_events' as never)
          .select('props')
          .eq('event_type', 'nico_query')
          .gte('occurred_at', since30d),
        supabase.from('app_feedback' as never)
          .select('rating')
          .gte('submitted_at', since30d),
        supabase.from('app_events' as never)
          .select('props')
          .eq('event_type', 'page_view')
          .gte('occurred_at', since30d)
          .limit(5000),
        supabase.from('app_events' as never)
          .select('event_type')
          .gte('occurred_at', since30d)
          .limit(10000),
      ]);

      // Total users (distinct user_id de signups)
      const signupsRows = (usersTotalRes.data ?? []) as Array<{ user_id: string }>;
      const signupsTotal = new Set(signupsRows.map(r => r.user_id)).size;
      const signups7d = signups7Res.count ?? 0;
      const signups30d = signups30Res.count ?? 0;

      // DAU/WAU/MAU = distinct user_id en cada ventana
      const distinctUsers = (rows: Array<{ user_id: string }> | null) =>
        new Set((rows ?? []).map(r => r.user_id)).size;
      const dau = distinctUsers(dauRes.data as Array<{ user_id: string }> | null);
      const wau = distinctUsers(wauRes.data as Array<{ user_id: string }> | null);
      const mau = distinctUsers(mauRes.data as Array<{ user_id: string }> | null);
      const stickiness = mau > 0 ? dau / mau : 0;

      const usersWithStatement = distinctUsers(statementUsersRes.data as Array<{ user_id: string }> | null);
      const usersWithInvoice = distinctUsers(invoiceUsersRes.data as Array<{ user_id: string }> | null);

      // Nico KPIs
      const nicoEvents = (nicoEventsRes.data ?? []) as Array<{ props: { cost_usd?: number; agent_key?: string } }>;
      const nicoQueries30d = nicoEvents.length;
      const nicoCost30d = nicoEvents.reduce((s, e) => s + Number(e.props?.cost_usd ?? 0), 0);

      const fb = (feedbackRes.data ?? []) as Array<{ feedback: number }>;
      const fbPos = fb.filter(f => f.feedback === 1).length;
      const fbNeg = fb.filter(f => f.feedback === -1).length;
      const nicoFeedbackPositiveRate = (fbPos + fbNeg) > 0 ? fbPos / (fbPos + fbNeg) : 0;

      const agentEvents = (agentRes.data ?? []) as Array<{ props: { agent_key?: string } }>;
      const byAgent = new Map<string, number>();
      for (const e of agentEvents) {
        const a = e.props?.agent_key ?? 'unknown';
        byAgent.set(a, (byAgent.get(a) ?? 0) + 1);
      }
      const nicoQueriesByAgent = Array.from(byAgent.entries())
        .map(([agent, count]) => ({ agent, count }))
        .sort((a, b) => b.count - a.count);

      // Encuesta
      const survey = (surveyRes.data ?? []) as Array<{ rating: number }>;
      const surveyAvgRating = survey.length > 0
        ? survey.reduce((s, r) => s + r.rating, 0) / survey.length : 0;
      const surveyResponses30d = survey.length;

      // Top pages
      const pv = (pageViewsRes.data ?? []) as Array<{ props: { pathname?: string } }>;
      const byPath = new Map<string, number>();
      for (const e of pv) {
        const p = e.props?.pathname ?? '?';
        byPath.set(p, (byPath.get(p) ?? 0) + 1);
      }
      const topPages = Array.from(byPath.entries())
        .map(([path, views]) => ({ path, views }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 10);

      // Top events (excluyendo page_view que ya tiene su propio bloque)
      const allEvents = (topEventsRes.data ?? []) as Array<{ event_type: string }>;
      const byEvent = new Map<string, number>();
      for (const e of allEvents) {
        if (e.event_type === 'page_view') continue;
        byEvent.set(e.event_type, (byEvent.get(e.event_type) ?? 0) + 1);
      }
      const topEvents = Array.from(byEvent.entries())
        .map(([event, count]) => ({ event, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      setData({
        signupsTotal, signups7d, signups30d,
        dau, wau, mau, stickiness,
        totalUsers: signupsTotal,
        usersWithStatement, usersWithInvoice,
        nicoQueries30d, nicoCost30d, nicoFeedbackPositiveRate, nicoQueriesByAgent,
        surveyAvgRating, surveyResponses30d,
        topPages, topEvents,
      });
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando analytics');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Analytics — vista founder
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Métricas de producto, engagement y negocio. Datos agregados, sin PII.
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <Card><CardContent className="py-8 text-center text-destructive">{error}</CardContent></Card>
        )}

        {!loading && !error && data && (
          <>
            {/* CRECIMIENTO */}
            <Section icon={<TrendingUp className="h-4 w-4" />} title="Crecimiento" subtitle="Signups y nuevos usuarios">
              <KpiGrid kpis={[
                { label: 'Total usuarios', value: formatNumber(data.signupsTotal) },
                { label: 'Signups últ 7 días', value: formatNumber(data.signups7d) },
                { label: 'Signups últ 30 días', value: formatNumber(data.signups30d) },
              ]} />
            </Section>

            {/* ENGAGEMENT */}
            <Section icon={<Users className="h-4 w-4" />} title="Engagement" subtitle="Cuántos usan AluminIA y qué tan seguido">
              <KpiGrid kpis={[
                { label: 'DAU (hoy)', value: formatNumber(data.dau), detail: 'Usuarios activos en últimas 24h' },
                { label: 'WAU (7 días)', value: formatNumber(data.wau) },
                { label: 'MAU (30 días)', value: formatNumber(data.mau) },
                { label: 'Stickiness', value: formatPct(data.stickiness), detail: 'DAU/MAU — qué tan adictiva es' },
              ]} />
            </Section>

            {/* ACTIVACIÓN */}
            <Section icon={<Activity className="h-4 w-4" />} title="Activación" subtitle="¿Los nuevos usuarios llegan al primer valor?">
              <KpiGrid kpis={[
                {
                  label: 'Subieron extracto',
                  value: `${data.usersWithStatement} de ${data.totalUsers}`,
                  detail: data.totalUsers > 0 ? formatPct(data.usersWithStatement / data.totalUsers) + ' del total' : '',
                },
                {
                  label: 'Confirmaron factura',
                  value: `${data.usersWithInvoice} de ${data.totalUsers}`,
                  detail: data.totalUsers > 0 ? formatPct(data.usersWithInvoice / data.totalUsers) + ' del total' : '',
                },
              ]} />
            </Section>

            {/* NICO IA */}
            <Section icon={<Sparkles className="h-4 w-4" />} title="Nico IA" subtitle="Uso del asistente y calidad de respuestas">
              <KpiGrid kpis={[
                { label: 'Queries últ 30 días', value: formatNumber(data.nicoQueries30d) },
                { label: 'Costo total 30d', value: formatUsd(data.nicoCost30d), detail: 'En Anthropic Sonnet + Haiku' },
                {
                  label: 'Feedback positivo',
                  value: formatPct(data.nicoFeedbackPositiveRate),
                  detail: '👍 / (👍+👎) sobre respuestas calificadas',
                },
              ]} />
              {data.nicoQueriesByAgent.length > 0 && (
                <Card className="mt-3">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Uso por agente (30d)</CardTitle></CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <tbody>
                        {data.nicoQueriesByAgent.map(({ agent, count }) => (
                          <tr key={agent} className="border-b border-border last:border-0">
                            <td className="py-1.5">{agent}</td>
                            <td className="py-1.5 text-right tabular-nums">{count}</td>
                            <td className="py-1.5 text-right text-xs text-muted-foreground w-24">
                              {formatPct(count / data.nicoQueries30d)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </Section>

            {/* CALIDAD */}
            <Section icon={<Heart className="h-4 w-4" />} title="Calidad y satisfacción" subtitle="Encuesta mensual de la app">
              <KpiGrid kpis={[
                {
                  label: 'Rating promedio',
                  value: data.surveyResponses30d > 0 ? `${data.surveyAvgRating.toFixed(2)} / 5` : '—',
                  detail: data.surveyResponses30d > 0 ? `Sobre ${data.surveyResponses30d} respuestas (30d)` : 'Aún sin respuestas',
                },
              ]} />
            </Section>

            {/* TOP PÁGINAS Y EVENTOS */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Top 10 páginas (30d)</CardTitle></CardHeader>
                <CardContent>
                  {data.topPages.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sin page views registrados aún.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody>
                        {data.topPages.map(({ path, views }) => (
                          <tr key={path} className="border-b border-border last:border-0">
                            <td className="py-1.5 truncate max-w-[260px]" title={path}>{path}</td>
                            <td className="py-1.5 text-right tabular-nums">{views}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Top 10 acciones (30d)</CardTitle></CardHeader>
                <CardContent>
                  {data.topEvents.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sin eventos registrados aún.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody>
                        {data.topEvents.map(({ event, count }) => (
                          <tr key={event} className="border-b border-border last:border-0">
                            <td className="py-1.5 font-mono text-xs">{event}</td>
                            <td className="py-1.5 text-right tabular-nums">{count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </div>

            <p className="text-[10px] text-muted-foreground mt-8 text-right">
              Refrescar: recargar la página · Datos en vivo desde Supabase · Sin tracking de terceros · Sin cookies
            </p>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function Section({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <span className="text-xs text-muted-foreground">— {subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function KpiGrid({ kpis }: { kpis: KPI[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((k) => (
        <Card key={k.label} className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{k.label}</p>
            <p className="text-2xl font-bold mt-1">{k.value}</p>
            {k.detail && <p className="text-[11px] text-muted-foreground mt-1">{k.detail}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
