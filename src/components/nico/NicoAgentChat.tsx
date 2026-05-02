import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Trash2, Sparkles, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import NicoLogo from './NicoLogo';
import NicoMessageContent from './NicoMessageContent';
import type { NicoPageContext } from '@/hooks/useNicoContext';
import { useSubmitNicoFeedback } from '@/hooks/useSubmitNicoFeedback';
import { cn } from '@/lib/utils';

export type AgentKey =
  | 'cfo'
  | 'contador'
  | 'visita_dian'
  | 'tesoreria'
  | 'inventario'
  | 'estrategia'
  | 'gerencial';
export type Msg = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  feedback?: number | null;
};

interface NicoAgentChatProps {
  agentKey: AgentKey;
  variant?: 'drawer' | 'page';
  initialMessage?: string;
  onMessageSent?: () => void;
  pageContext?: NicoPageContext;
  suggestions?: string[];
}

const HISTORY_LIMIT = 15;

export default function NicoAgentChat({
  agentKey,
  variant = 'page',
  initialMessage,
  onMessageSent,
  pageContext,
  suggestions = [],
}: NicoAgentChatProps) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialSent = useRef(false);
  const submitFeedback = useSubmitNicoFeedback();

  const isDrawer = variant === 'drawer';

  const refreshHistory = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('nico_messages' as never)
      .select('id, role, content, feedback, feedback_text, created_at')
      .eq('user_id', user.id)
      .eq('agent_key', agentKey)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT) as { data: Array<{ id: string; role: 'user' | 'assistant'; content: string; feedback: number | null }> | null };
    if (data) setMessages([...data].reverse());
  }, [agentKey]);

  const handleFeedback = useCallback(async (messageId: string, value: -1 | 1, text?: string) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: value } : m)));
    try {
      await submitFeedback.mutateAsync({ messageId, feedback: value, feedbackText: text ?? null });
      if (value === 1) toast.success('¡Gracias! Tu feedback ayuda a Nico a mejorar.');
      else toast.success('Anotado. Vamos a revisarlo.');
    } catch (err: any) {
      toast.error('No se pudo guardar el feedback', { description: err?.message });
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: null } : m)));
    }
  }, [submitFeedback]);

  // Load history from DB on mount (or when agent key changes)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setHistoryLoaded(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) {
        setHistoryLoaded(true);
        return;
      }
      const { data } = await supabase
        .from('nico_messages' as never)
        .select('id, role, content, feedback, feedback_text, created_at')
        .eq('user_id', user.id)
        .eq('agent_key', agentKey)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT) as { data: Array<{ id: string; role: 'user' | 'assistant'; content: string; feedback: number | null }> | null };
      if (!cancelled) {
        setMessages(data ? [...data].reverse() : []);
        setHistoryLoaded(true);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [agentKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || isLoading) return;

    const userMsg: Msg = { role: 'user', content: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

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
          body: JSON.stringify({
            agent_key: agentKey,
            messages: [{ role: 'user', content: question }],
            pageContext,
          }),
        }
      );

      if (!resp.ok || !resp.body) {
        const errData = await resp.json().catch(() => ({}));
        if (resp.status === 429) toast.error(errData.error ?? 'Límite de uso alcanzado');
        else if (resp.status === 402) toast.error(errData.error ?? 'Se requieren créditos adicionales');
        else toast.error(errData.error ?? 'Nico no está disponible en este momento');
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
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantText } : m);
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
      // Post-stream: refrescar para que el último mensaje del asistente
      // tenga su id real desde DB (necesario para el feedback 👍/👎).
      await refreshHistory();
    } catch (e) {
      console.error('Nico error:', e);
      toast.error('No se pudo conectar con Nico');
    } finally {
      setIsLoading(false);
      onMessageSent?.();
    }
  }, [agentKey, isLoading, onMessageSent, pageContext, refreshHistory]);

  // Initial-message prefill (only once per mount)
  useEffect(() => {
    if (initialMessage && !initialSent.current && historyLoaded) {
      initialSent.current = true;
      send(initialMessage);
    }
  }, [initialMessage, historyLoaded, send]);

  const clearHistory = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (!confirm('¿Borrar todo el historial de este agente? Esta acción no se puede deshacer.')) return;
    await supabase.from('nico_messages' as never).delete()
      .eq('user_id', user.id).eq('agent_key', agentKey);
    await supabase.from('nico_agent_memory' as never).delete()
      .eq('user_id', user.id).eq('agent_key', agentKey);
    setMessages([]);
  };

  return (
    <div className={`flex flex-col ${isDrawer ? 'h-full' : 'h-full min-h-[500px]'}`}>
      {/* Messages */}
      <div className={`flex-1 overflow-y-auto ${isDrawer ? 'p-4' : 'p-5'} space-y-4 bg-muted/10`}>
        {!historyLoaded && (
          <div className="flex items-center justify-center h-full">
            <div className="text-xs text-muted-foreground">Cargando conversación...</div>
          </div>
        )}

        {historyLoaded && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-8">
            <div className="w-14 h-14 rounded-2xl bg-success/10 flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-success" />
            </div>
            <div className="text-center px-4">
              <p className="text-sm font-semibold text-foreground mb-1">Pregúntame lo que necesites</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Te acuerdo todo lo que hablemos. Tu historial se mantiene entre sesiones.
              </p>
            </div>
            {suggestions.length > 0 && (
              <div className="grid grid-cols-1 gap-2 w-full max-w-md mt-2">
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
            )}
          </div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          const isLast = i === messages.length - 1;
          const showFeedback = !isUser && !!msg.id && !(isLast && isLoading);
          return (
            <div key={msg.id ?? i} className={`flex ${isUser ? 'justify-end' : 'justify-start'} items-start gap-2`}>
              {!isUser && (
                <div className="w-7 h-7 rounded-full bg-success/10 flex-shrink-0 mt-0.5 flex items-center justify-center">
                  <NicoLogo size={16} />
                </div>
              )}
              <div className={`flex flex-col gap-1.5 max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
                <div
                  className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    isUser
                      ? 'bg-success text-white rounded-br-sm'
                      : 'bg-card text-foreground border border-border rounded-bl-sm'
                  }`}
                >
                  {isUser ? (
                    msg.content
                  ) : (
                    <NicoMessageContent
                      content={msg.content}
                      isStreaming={isLast && isLoading}
                      isLastMessage={isLast}
                    />
                  )}
                </div>
                {showFeedback && (
                  <NicoFeedbackInline
                    messageId={msg.id!}
                    feedback={msg.feedback ?? null}
                    onSubmit={handleFeedback}
                  />
                )}
              </div>
            </div>
          );
        })}

        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex items-start gap-2">
            <div className="w-7 h-7 rounded-full bg-success/10 flex-shrink-0 mt-0.5 flex items-center justify-center">
              <NicoLogo size={16} />
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

      {/* Footer with clear button */}
      {messages.length > 0 && (
        <div className="flex items-center justify-end px-3 py-1.5 border-t border-border bg-card/50">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
            onClick={clearHistory}
            disabled={isLoading}
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Borrar historial
          </Button>
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className={`${isDrawer ? 'px-4 py-3' : 'px-5 py-4'} border-t border-border bg-card`}
      >
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pregúntame..."
            disabled={isLoading}
            className="flex-1 bg-muted rounded-xl px-4 py-2.5 text-base md:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-success/40 disabled:opacity-50"
          />
          <Button type="submit" size="sm" disabled={!input.trim() || isLoading} className="rounded-xl h-10 w-10 p-0">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}

interface NicoFeedbackInlineProps {
  messageId: string;
  feedback: number | null;
  onSubmit: (id: string, value: -1 | 1, text?: string) => Promise<void>;
}

function NicoFeedbackInline({ messageId, feedback, onSubmit }: NicoFeedbackInlineProps) {
  const [showTextarea, setShowTextarea] = useState(false);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isPositive = feedback === 1;
  const isNegative = feedback === -1;
  const alreadyRated = feedback !== null && feedback !== undefined;

  const handleUp = async () => {
    if (alreadyRated || submitting) return;
    setSubmitting(true);
    await onSubmit(messageId, 1);
    setSubmitting(false);
  };

  const handleDown = () => {
    if (alreadyRated || submitting) return;
    setShowTextarea(true);
  };

  const handleSendNegative = async () => {
    if (submitting) return;
    setSubmitting(true);
    await onSubmit(messageId, -1, text.trim() || undefined);
    setShowTextarea(false);
    setText('');
    setSubmitting(false);
  };

  return (
    <div className="flex flex-col gap-1.5 px-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleUp}
          disabled={alreadyRated || submitting}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            isPositive
              ? 'text-success bg-success/10'
              : 'text-muted-foreground/60 hover:text-success hover:bg-success/10 disabled:opacity-30 disabled:cursor-not-allowed',
          )}
          aria-label="Buena respuesta"
          title="Buena respuesta"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleDown}
          disabled={alreadyRated || submitting}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            isNegative
              ? 'text-destructive bg-destructive/10'
              : 'text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed',
          )}
          aria-label="Mala respuesta"
          title="Mala respuesta"
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
        {isPositive && <span className="text-[10px] text-success ml-1">¡Gracias!</span>}
        {isNegative && !showTextarea && <span className="text-[10px] text-muted-foreground ml-1">Anotado</span>}
      </div>
      {showTextarea && !alreadyRated && (
        <div className="flex flex-col gap-1.5 max-w-sm">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="¿Qué estuvo mal? (opcional)"
            rows={2}
            className="text-xs resize-none"
            autoFocus
          />
          <div className="flex gap-1.5 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => { setShowTextarea(false); setText(''); }}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              onClick={handleSendNegative}
              disabled={submitting}
            >
              {submitting ? 'Enviando…' : 'Enviar'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
