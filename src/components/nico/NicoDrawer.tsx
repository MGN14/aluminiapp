import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Send, X, Trash2, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
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

export default function NicoDrawer() {
  const { isOpen, closeNico, pageContext } = useNico();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const clearHistory = () => {
    setMessages([]);
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || isLoading) return;

    const userMsg: Msg = { role: 'user', content: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

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
    } catch (e) {
      console.error('Nico error:', e);
      toast.error('No se pudo conectar con Nico');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const BRAND = 'oklch(0.43 0.14 155)';
  const BRAND_DIM = 'oklch(0.43 0.14 155 / 0.10)';
  const BRAND_BORDER = 'oklch(0.43 0.14 155 / 0.22)';

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={closeNico}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 40,
          background: 'rgba(0,0,0,0.20)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      />

      {/* Drawer */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          width: 420,
          maxWidth: '100vw',
          background: '#fff',
          boxShadow: '-20px 0 60px rgba(0,0,0,0.12)',
          animation: 'slideInRight 0.38s cubic-bezier(0.16,1,0.3,1)',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif",
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 20px 14px',
            borderBottom: '1px solid rgba(0,0,0,0.07)',
            flexShrink: 0,
          }}
        >
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, oklch(0.43 0.14 155), oklch(0.55 0.16 180))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 0 3px oklch(0.43 0.14 155 / 0.15)',
                  overflow: 'hidden',
                }}
              >
                <img
                  src={nicoAvatar}
                  alt="Nico"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
                />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: '#1d1d1f',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  Nico
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 8px',
                      borderRadius: 99,
                      background: BRAND_DIM,
                      fontSize: 10,
                      fontWeight: 600,
                      color: BRAND,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: BRAND,
                        animation: 'pulse 2s ease infinite',
                      }}
                    />
                    IA
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#6e6e73', marginTop: 2 }}>
                  Analizando tu negocio
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            background: '#fff',
          }}
        >
          {messages.length === 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                gap: 16,
                padding: '32px 16px',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: BRAND_DIM,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Sparkles style={{ width: 26, height: 26, color: BRAND }} />
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#1d1d1f', marginBottom: 4 }}>
                  Tu copiloto financiero
                </p>
                <p
                  style={{
                    fontSize: 12,
                    color: '#6e6e73',
                    maxWidth: 280,
                    lineHeight: 1.6,
                  }}
                >
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
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  border: '1px solid rgba(0,0,0,0.07)',
                  background: '#f5f5f7',
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                <img
                  src={nicoAvatar}
                  alt="Nico"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
                />
              </div>
              <div
                style={{
                  background: '#f5f5f7',
                  borderRadius: '20px 20px 20px 5px',
                  padding: '14px 16px',
                  display: 'flex',
                  gap: 5,
                  alignItems: 'center',
                }}
              >
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: 'oklch(0.60 0.14 155)',
                      animation: `bounceDot 1.2s ease ${delay}ms infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          style={{
            padding: '12px 16px',
            borderTop: '1px solid rgba(0,0,0,0.07)',
            flexShrink: 0,
            background: '#fff',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#f5f5f7',
              border: '1.5px solid rgba(0,0,0,0.07)',
              borderRadius: 12,
              padding: '6px 6px 6px 14px',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregúntale a Nico sobre tu negocio..."
              disabled={isLoading}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                fontSize: 13,
                background: 'transparent',
                fontFamily: 'inherit',
                color: '#1d1d1f',
                opacity: isLoading ? 0.55 : 1,
              }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: '#1d1d1f',
                border: 'none',
                color: '#fff',
                cursor: !input.trim() || isLoading ? 'not-allowed' : 'pointer',
                opacity: !input.trim() || isLoading ? 0.55 : 1,
                transition: 'background 0.15s',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Send style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
