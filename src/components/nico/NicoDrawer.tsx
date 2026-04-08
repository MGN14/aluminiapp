import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Send, X, Trash2, Sparkles, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useNico, NicoPageContext } from '@/hooks/useNicoContext';
import nicoAvatar from '@/assets/nico-avatar.png';
import NicoQuickActions from './NicoQuickActions';
import NicoMessageBubble from './NicoMessageBubble';

export type Msg = { role: 'user' | 'assistant'; content: string; id?: string };

function buildContextNote(ctx: NicoPageContext): string {
  const parts: string[] = [`Página actual: ${ctx.page}`];
  if (ctx.filters) {
    const f = ctx.filters;
    if (f.period) parts.push(`Período: ${f.period}`);
    if (f.month && f.year) parts.push(`Mes/Año: ${f.month}/${f.year}`);
    else if (f.year) parts.push(`Año: ${f.year}`);
    if (f.type) parts.push(`Tipo: ${f.type}`);
    if (f.status) parts.push(`Estado: ${f.status}`);
    if (f.dateFrom || f.dateTo) parts.push(`Rango: ${f.dateFrom ?? ''} - ${f.dateTo ?? ''}`);
    if (f.amountMin != null || f.amountMax != null)
      parts.push(`Monto: ${f.amountMin ?? 0} - ${f.amountMax ?? '∞'}`);
  }
  return parts.join(' | ');
}

const LOAD_LIMIT = 30;

export default function NicoDrawer() {
  const { isOpen, closeNico, pageContext } = useNico();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen for prefill events from CFO Insights
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.message) {
        setInput(detail.message);
        setTimeout(() => send(detail.message), 500);
      }
    };
    window.addEventListener('nico-prefill', handler);
    return () => window.removeEventListener('nico-prefill', handler);
  }, [messages, isLoading]);

  // Focus input when drawer opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 350);
    }
  }, [isOpen]);

  // Keyboard shortcut ⌘K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const { openNico: open } = useNico();
      }
    };
    // We handle this in the provider instead
  }, []);

  // Load history when drawer opens
  useEffect(() => {
    if (!isOpen || historyLoaded) return;
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('nico_messages' as never)
        .select('id, role, content')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(LOAD_LIMIT) as { data: Msg[] | null };
      if (data) setMessages([...data].reverse());
      setHistoryLoaded(true);
    };
    load();
  }, [isOpen, historyLoaded]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const saveMessage = async (role: 'user' | 'assistant', content: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('nico_messages' as never).insert({
      user_id: user.id,
      role,
      content,
      page_context: buildContextNote(pageContext),
    } as never);
  };

  const clearHistory = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('nico_messages' as never).delete().eq('user_id', user.id);
    setMessages([]);
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || isLoading) return;

    const userMsg: Msg = { role: 'user', content: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    await saveMessage('user', question);

    const contextNote = buildContextNote(pageContext);
    const allMessages = [
      ...messages,
      userMsg,
      {
        role: 'system' as const,
        content: `[Contexto del usuario en la app: ${contextNote}]`,
      },
    ];

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No autenticado');

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nico-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ messages: allMessages, pageContext }),
        }
      );

      if (!resp.ok || !resp.body) {
        const errData = await resp.json().catch(() => ({}));
        if (resp.status === 429) toast.error(errData.error ?? 'Límite de uso alcanzado');
        else if (resp.status === 402) toast.error(errData.error ?? 'Se requieren créditos adicionales');
        else toast.error('Nico no está disponible en este momento');
        setIsLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const chunk = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (chunk) {
              assistantText += chunk;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, content: assistantText } : m
                  );
                }
                return [...prev, { role: 'assistant', content: assistantText }];
              });
            }
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }
      if (assistantText) await saveMessage('assistant', assistantText);
    } catch (e) {
      console.error('Nico error:', e);
      toast.error('No se pudo conectar con Nico');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
        onClick={closeNico}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 z-50 flex flex-col h-screen w-full md:w-[420px] bg-card border-l border-border shadow-2xl animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-success/30 bg-muted shadow-sm">
                <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
              </div>
              <div>
                <div className="text-sm font-bold text-foreground flex items-center gap-1.5">
                  Nico
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-success/10 text-[10px] font-semibold text-success">
                    <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                    IA
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">Analizando tu negocio</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={clearHistory}
                  title="Borrar historial"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={closeNico}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Quick Actions */}
          <NicoQuickActions onSelect={send} disabled={isLoading} />
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4 py-8 text-center">
              <div className="w-14 h-14 rounded-2xl bg-success/10 flex items-center justify-center">
                <Sparkles className="w-7 h-7 text-success" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground mb-1">Tu copiloto financiero</p>
                <p className="text-xs text-muted-foreground max-w-[280px] leading-relaxed">
                  Pregúntame sobre ingresos, gastos, impuestos o cualquier aspecto de tu negocio. Analizo tus datos en tiempo real.
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <NicoMessageBubble
              key={msg.id ?? i}
              msg={msg}
              isLast={i === messages.length - 1}
              isLoading={isLoading}
            />
          ))}

          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full overflow-hidden border border-border bg-muted flex-shrink-0 mt-0.5">
                <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
              </div>
              <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1.5 items-center h-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-success/60 animate-bounce [animation-delay:0ms]" />
                  <div className="w-1.5 h-1.5 rounded-full bg-success/60 animate-bounce [animation-delay:150ms]" />
                  <div className="w-1.5 h-1.5 rounded-full bg-success/60 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="px-4 py-3 border-t border-border bg-card flex-shrink-0"
        >
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregúntale a Nico sobre tu negocio..."
              disabled={isLoading}
              className="flex-1 bg-muted rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-success/40 disabled:opacity-50"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!input.trim() || isLoading}
              className="rounded-xl h-10 w-10 p-0 bg-success hover:bg-success/90"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
