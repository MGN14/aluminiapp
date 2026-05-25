// Admin only — Campaigns de email masivas (MVP solo founder).
// Editor simple + selector de audiencia + historial.

import { useState, useEffect } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Mail, Send, Eye, AlertTriangle, Loader2, Users, History, Sparkles, ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';

type AudienceType = 'all_active_users' | 'by_plan' | 'custom_list' | 'single_test';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

interface CampaignRow {
  id: string;
  subject: string;
  audience_type: string;
  recipient_count: number | null;
  sent_count: number;
  failed_count: number;
  status: string;
  sent_at: string | null;
  created_at: string;
}

export default function Campaigns() {
  const { user } = useAuth();
  const { isAdmin, isFounder } = useSubscription();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [fromName, setFromName] = useState('AluminIA');
  const [replyTo, setReplyTo] = useState('');
  const [audienceType, setAudienceType] = useState<AudienceType>('single_test');
  const [testEmail, setTestEmail] = useState(user?.email ?? '');
  const [customEmails, setCustomEmails] = useState('');
  const [byPlanSelected, setByPlanSelected] = useState<string[]>(['empresarial']);
  const [sending, setSending] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [previewMode, setPreviewMode] = useState<'edit' | 'preview'>('edit');

  // Gate: solo admin/founder
  useEffect(() => {
    if (user && !isAdmin && !isFounder) {
      toast({ title: 'Acceso restringido', description: 'Esta página es solo para administradores', variant: 'destructive' });
      navigate('/dashboard');
    }
  }, [user, isAdmin, isFounder, navigate, toast]);

  // Load historial
  const loadCampaigns = async () => {
    const { data } = await (supabase as any)
      .from('email_campaigns')
      .select('id, subject, audience_type, recipient_count, sent_count, failed_count, status, sent_at, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    setCampaigns((data ?? []) as CampaignRow[]);
  };
  useEffect(() => { if (user) loadCampaigns(); }, [user]);

  const handleSend = async (dryRun: boolean) => {
    if (!subject.trim()) { toast({ title: 'Falta asunto', variant: 'destructive' }); return; }
    if (!bodyHtml.trim()) { toast({ title: 'Falta el cuerpo del email', variant: 'destructive' }); return; }
    if (audienceType === 'single_test' && !testEmail) { toast({ title: 'Falta email de prueba', variant: 'destructive' }); return; }
    if (audienceType === 'custom_list' && !customEmails.trim()) { toast({ title: 'Falta lista de emails', variant: 'destructive' }); return; }

    if (!dryRun && audienceType !== 'single_test') {
      const ok = window.confirm(`¿Confirmás enviar la campaña a la audiencia seleccionada? Esta acción NO se puede deshacer.`);
      if (!ok) return;
    }

    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sesión expirada');

      const audienceFilter: { plans?: string[]; emails?: string[] } = {};
      if (audienceType === 'by_plan') audienceFilter.plans = byPlanSelected;
      if (audienceType === 'custom_list') {
        audienceFilter.emails = customEmails.split(/[\n,;]+/).map(e => e.trim()).filter(e => e.length > 0);
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email-campaign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({
          subject,
          body_html: bodyHtml,
          body_text: bodyText || undefined,
          from_name: fromName,
          reply_to: replyTo || undefined,
          audience_type: audienceType,
          audience_filter: Object.keys(audienceFilter).length > 0 ? audienceFilter : undefined,
          test_email: audienceType === 'single_test' ? testEmail : undefined,
          dry_run: dryRun,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      if (dryRun) {
        toast({
          title: 'Dry run completado',
          description: `${data.recipient_count} destinatarios identificados. Muestra: ${data.sample_recipients?.join(', ')}`,
        });
      } else {
        toast({
          title: 'Campaña enviada',
          description: `${data.sent_count} enviados · ${data.failed_count} fallaron`,
        });
        // Reset form para evitar reenvíos accidentales
        if (audienceType !== 'single_test') {
          setSubject('');
          setBodyHtml('');
          setBodyText('');
        }
        await loadCampaigns();
      }
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6 text-primary" />
            Campañas de Email
            <Badge variant="outline" className="text-[10px]">
              <ShieldAlert className="h-3 w-3 mr-1" />
              Admin only
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Envíos masivos vía Resend. MVP solo founder. Probá siempre con "Envío de prueba" antes de mandar a la audiencia real.
          </p>
        </div>

        <Tabs defaultValue="compose">
          <TabsList>
            <TabsTrigger value="compose"><Send className="h-3.5 w-3.5 mr-1" />Nueva campaña</TabsTrigger>
            <TabsTrigger value="history"><History className="h-3.5 w-3.5 mr-1" />Historial ({campaigns.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="compose" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contenido del email</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Nombre del remitente</Label>
                    <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="AluminIA" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Reply-to (opcional)</Label>
                    <Input type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="contacto@aluminiapp.com" />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Asunto *</Label>
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ej: Nueva funcionalidad disponible en AluminIA" />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Cuerpo HTML *</Label>
                    <div className="flex gap-1">
                      <Button size="sm" variant={previewMode === 'edit' ? 'default' : 'outline'} className="h-6 text-[10px]" onClick={() => setPreviewMode('edit')}>Editar</Button>
                      <Button size="sm" variant={previewMode === 'preview' ? 'default' : 'outline'} className="h-6 text-[10px]" onClick={() => setPreviewMode('preview')}><Eye className="h-3 w-3 mr-1" />Vista previa</Button>
                    </div>
                  </div>
                  {previewMode === 'edit' ? (
                    <Textarea
                      value={bodyHtml}
                      onChange={(e) => setBodyHtml(e.target.value)}
                      placeholder="<h1>Hola</h1><p>Te escribimos para contarte...</p>"
                      rows={12}
                      className="font-mono text-xs"
                    />
                  ) : (
                    <div
                      className="border border-border rounded-lg p-4 bg-card max-h-[400px] overflow-y-auto prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: bodyHtml || '<p class="text-muted-foreground italic">Sin contenido todavía</p>' }}
                    />
                  )}
                </div>

                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Cuerpo texto plano (opcional, para clientes sin HTML)</summary>
                  <Textarea
                    value={bodyText}
                    onChange={(e) => setBodyText(e.target.value)}
                    placeholder="Versión texto plano del mismo mensaje..."
                    rows={6}
                    className="mt-2 text-xs"
                  />
                </details>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Destinatarios
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={audienceType} onValueChange={(v) => setAudienceType(v as AudienceType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single_test">🧪 Envío de prueba (1 email)</SelectItem>
                    <SelectItem value="custom_list">📋 Lista personalizada de emails</SelectItem>
                    <SelectItem value="by_plan">💎 Usuarios por plan</SelectItem>
                    <SelectItem value="all_active_users">🌐 Todos los usuarios activos</SelectItem>
                  </SelectContent>
                </Select>

                {audienceType === 'single_test' && (
                  <div className="space-y-1">
                    <Label className="text-xs">Email de prueba</Label>
                    <Input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="tu@email.com" />
                  </div>
                )}
                {audienceType === 'custom_list' && (
                  <div className="space-y-1">
                    <Label className="text-xs">Emails (uno por línea o separados por comas)</Label>
                    <Textarea
                      value={customEmails}
                      onChange={(e) => setCustomEmails(e.target.value)}
                      placeholder={`cliente1@gmail.com\ncliente2@empresa.com\ncliente3@hotmail.com`}
                      rows={5}
                      className="text-xs font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {customEmails.split(/[\n,;]+/).filter(e => e.trim()).length} email{customEmails.split(/[\n,;]+/).filter(e => e.trim()).length !== 1 ? 's' : ''} detectado{customEmails.split(/[\n,;]+/).filter(e => e.trim()).length !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}
                {audienceType === 'by_plan' && (
                  <div className="space-y-2">
                    <Label className="text-xs">Planes a incluir</Label>
                    <div className="flex flex-wrap gap-2">
                      {['demo', 'basico', 'pro', 'empresarial'].map(plan => (
                        <button
                          key={plan}
                          type="button"
                          onClick={() => setByPlanSelected(s => s.includes(plan) ? s.filter(p => p !== plan) : [...s, plan])}
                          className={`text-xs px-2.5 py-1 rounded border ${byPlanSelected.includes(plan) ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border'}`}
                        >
                          {plan}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {audienceType === 'all_active_users' && (
                  <div className="p-3 rounded bg-warning/10 border border-warning/30 text-xs flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold">⚠️ Envío a TODOS los usuarios activos</p>
                      <p className="text-muted-foreground mt-1">Probá primero con un email de prueba y después con "dry run" para confirmar la cantidad antes de mandar.</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => handleSend(true)} disabled={sending}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
                Dry run (contar destinatarios)
              </Button>
              <Button onClick={() => handleSend(false)} disabled={sending} className="gap-1.5">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {audienceType === 'single_test' ? 'Enviar prueba' : 'Enviar campaña'}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="history" className="space-y-2 mt-4">
            {campaigns.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Sin campañas enviadas todavía</CardContent></Card>
            ) : (
              campaigns.map(c => (
                <Card key={c.id}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{c.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.audience_type} · {new Date(c.created_at).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={
                          c.status === 'sent' ? 'border-success/40 text-success' :
                          c.status === 'failed' ? 'border-destructive/40 text-destructive' :
                          c.status === 'partial' ? 'border-warning/40 text-warning' :
                          ''
                        }>
                          {c.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {c.sent_count}/{c.recipient_count}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
