import { useEffect, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Sparkles, ChevronDown, ChevronRight } from 'lucide-react';

interface PromptVersion {
  id: string;
  agent_key: string;
  version: number;
  base_prompt: string;
  changelog: string | null;
  evidence: unknown[];
  proposed_by: string;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  approved_at: string | null;
  created_at: string;
}

const AGENT_LABELS: Record<string, string> = {
  cfo: 'CFO',
  contador: 'Contador',
  visita_dian: 'Visita DIAN',
  tesoreria: 'Tesorería',
  inventario: 'Inventario',
  estrategia: 'Estrategia',
  gerencial: 'Gerencial',
};

export default function NicoPromptEvolution() {
  const { user } = useAuth();
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('nico_prompt_versions' as never)
      .select('*')
      .order('created_at', { ascending: false }) as { data: PromptVersion[] | null };
    setVersions(data ?? []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const handleApprove = async (v: PromptVersion) => {
    if (!user) return;
    const ok = window.confirm(`¿Aprobar versión ${v.version} del agente ${AGENT_LABELS[v.agent_key]}?\n\nA partir de aprobada, este será el system prompt activo. Las versiones aprobadas anteriores quedan marcadas como reemplazadas.`);
    if (!ok) return;

    // Marcar la anterior aprobada del mismo agente como superseded
    await supabase
      .from('nico_prompt_versions' as never)
      .update({ status: 'superseded' } as never)
      .eq('agent_key', v.agent_key)
      .eq('status', 'approved');

    const { error } = await supabase
      .from('nico_prompt_versions' as never)
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: user.id,
      } as never)
      .eq('id', v.id);

    if (error) {
      toast.error('No se pudo aprobar', { description: error.message });
      return;
    }
    toast.success(`Versión ${v.version} aprobada — ya está activa`);
    void load();
  };

  const handleReject = async (v: PromptVersion) => {
    const ok = window.confirm(`¿Rechazar versión ${v.version} del agente ${AGENT_LABELS[v.agent_key]}?`);
    if (!ok) return;
    const { error } = await supabase
      .from('nico_prompt_versions' as never)
      .update({ status: 'rejected' } as never)
      .eq('id', v.id);
    if (error) {
      toast.error('Error', { description: error.message });
      return;
    }
    toast.success('Propuesta rechazada');
    void load();
  };

  const filtered = versions.filter(v => tab === 'pending' ? v.status === 'pending' : v.status !== 'pending');

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-success" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Evolución del system prompt de Nico</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Cada lunes Opus 4.7 analiza el feedback de la semana y propone reglas para agregar al prompt de cada agente. Vos aprobás o rechazás.
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center bg-muted/60 rounded-lg p-0.5 w-fit">
          <button
            onClick={() => setTab('pending')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'pending' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Pendientes {versions.filter(v => v.status === 'pending').length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-success text-white text-[10px] font-bold">
                {versions.filter(v => v.status === 'pending').length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('history')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'history' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Historial
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Cargando…</p>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              {tab === 'pending'
                ? 'No hay propuestas pendientes. La próxima ejecución del cron es lunes a las 9am Bogotá.'
                : 'Todavía no hay versiones aprobadas o rechazadas.'}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(v => {
              const isExpanded = expandedId === v.id;
              const evidenceCount = Array.isArray(v.evidence) ? v.evidence.length : 0;
              return (
                <Card key={v.id}>
                  <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{AGENT_LABELS[v.agent_key] ?? v.agent_key}</CardTitle>
                        <Badge variant="outline" className="text-[10px]">v{v.version}</Badge>
                        {v.status === 'pending' && <Badge className="bg-warning/20 text-warning border-warning/40 text-[10px]">Pendiente</Badge>}
                        {v.status === 'approved' && <Badge className="bg-success/20 text-success border-success/40 text-[10px]">Aprobada</Badge>}
                        {v.status === 'rejected' && <Badge className="bg-destructive/20 text-destructive border-destructive/40 text-[10px]">Rechazada</Badge>}
                        {v.status === 'superseded' && <Badge variant="outline" className="text-[10px]">Reemplazada</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Propuesta el {new Date(v.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })} · {evidenceCount} casos analizados
                      </p>
                    </div>
                    {v.status === 'pending' && (
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => handleReject(v)}>
                          <XCircle className="h-3.5 w-3.5 mr-1" />Rechazar
                        </Button>
                        <Button size="sm" onClick={() => handleApprove(v)} className="bg-success hover:bg-success/90 text-success-foreground">
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Aprobar
                        </Button>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    {v.changelog && (
                      <div className="text-sm whitespace-pre-wrap p-3 bg-muted/40 rounded-md font-mono text-xs">
                        {v.changelog}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : v.id)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {isExpanded ? 'Ocultar' : 'Ver'} prompt completo y evidencia
                    </button>
                    {isExpanded && (
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1">SYSTEM PROMPT COMPLETO</p>
                          <pre className="text-[10px] bg-muted/40 p-3 rounded-md overflow-auto max-h-72 whitespace-pre-wrap">{v.base_prompt}</pre>
                        </div>
                        {Array.isArray(v.evidence) && v.evidence.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground mb-1">EVIDENCIA (feedback que motivó la propuesta)</p>
                            <div className="space-y-1.5 max-h-60 overflow-auto">
                              {(v.evidence as Array<{ feedback: number; question: string; comment: string | null }>).map((e, i) => (
                                <div key={i} className={`text-[11px] p-2 rounded-md ${e.feedback === 1 ? 'bg-success/10' : 'bg-destructive/10'}`}>
                                  <span className={`font-semibold ${e.feedback === 1 ? 'text-success' : 'text-destructive'}`}>
                                    {e.feedback === 1 ? '👍' : '👎'}
                                  </span>{' '}
                                  <span className="font-medium">{e.question}</span>
                                  {e.comment && <div className="text-muted-foreground italic mt-0.5">"{e.comment}"</div>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
