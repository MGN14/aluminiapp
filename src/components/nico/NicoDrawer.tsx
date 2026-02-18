import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Send, X, Trash2, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useNico, NicoPageContext } from '@/hooks/useNicoContext';
import nicoAvatar from '@/assets/nico-avatar.png';

type Msg = { role: 'user' | 'assistant'; content: string; id?: string };

const PAGE_SUGGESTIONS: Record<string, string[]> = {
  dashboard: [
    '¿Cuánto gasté este mes?',
    '¿Cuál es mi utilidad neta?',
    '¿Cómo voy frente al mes anterior?',
  ],
  transactions: [
    '¿Cuál es mi gasto más grande?',
    '¿Cuánto sumé en ingresos este período?',
    '¿Hay algún movimiento inusual?',
  ],
  reports: [
    '¿Cómo está mi EBITDA este mes?',
    '¿Cómo voy frente al año pasado?',
    '¿Cuánto debo provisionar para impuestos?',
  ],
  export: [
    '¿Qué período debería exportar?',
    '¿Qué categorías tienen más movimiento?',
    '¿Hay gastos sin categorizar?',
  ],
  default: [
    '¿Cuánto gasté este mes?',
    '¿Cuál fue mi proveedor más costoso?',
    '¿Cuánto debo provisionar para impuestos?',
  ],
};

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

  const suggestions = PAGE_SUGGESTIONS[pageContext.page] ?? PAGE_SUGGESTIONS.default;

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
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden"
        onClick={closeNico}
      />

      {/* Drawer */}
      <div className="fixed bottom-0 right-0 z-50 flex flex-col h-[90vh] md:h-screen w-full md:w-[400px] bg-card border-l border-border shadow-2xl animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full overflow-hidden border border-border bg-muted">
              <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Nico</div>
              <div className="text-xs text-success flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                Activo · Analizando tus datos
              </div>
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

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/10">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4 py-8 text-center">
              <div className="w-12 h-12 rounded-2xl bg-success/10 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-success" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">Pregúntale a Nico</p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Analiza tus ingresos, gastos y tendencias con preguntas en lenguaje natural.
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-left text-xs px-3 py-2.5 rounded-xl border border-border bg-card hover:border-success/50 hover:bg-success/5 text-muted-foreground hover:text-foreground transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={msg.id ?? i}
              className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full overflow-hidden border border-border bg-muted mr-2 flex-shrink-0 mt-0.5">
                  <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[82%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap',
                  msg.role === 'user'
                    ? 'bg-success text-white rounded-br-sm'
                    : 'bg-card text-foreground border border-border rounded-bl-sm'
                )}
              >
                {msg.content}
                {msg.role === 'assistant' && i === messages.length - 1 && isLoading && (
                  <span className="inline-block w-1.5 h-4 bg-success/60 ml-1 animate-pulse rounded-sm" />
                )}
              </div>
            </div>
          ))}

          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex items-start gap-2">
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

        {/* Quick suggestions when chat has messages */}
        {messages.length > 0 && !isLoading && (
          <div className="px-4 pt-2 pb-1 flex gap-2 flex-wrap bg-card border-t border-border flex-shrink-0">
            {suggestions.slice(0, 2).map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs px-3 py-1.5 rounded-full border border-border bg-muted hover:border-success/50 hover:bg-success/5 text-muted-foreground hover:text-foreground transition-all whitespace-nowrap"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="px-4 py-3 border-t border-border bg-card flex-shrink-0"
        >
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregúntale a Nico..."
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
