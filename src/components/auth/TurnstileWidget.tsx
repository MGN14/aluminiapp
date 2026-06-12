import { Turnstile } from "@marsidev/react-turnstile";
import { forwardRef, useEffect, useRef } from "react";

interface Props {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  /**
   * Se dispara cuando Cloudflare está CAÍDO (el widget reporta error o no
   * resuelve dentro del timeout). El caller debe habilitar el submit sin
   * token (fail-open de UI). El enforcement real sigue siendo server-side:
   * si Supabase tiene la protección captcha activa, va a rechazar el intento
   * — este callback solo evita que el botón quede muerto para siempre
   * durante una caída de Cloudflare (caso real: outage 2026-06-12).
   */
  onUnavailable?: () => void;
  /**
   * Changing this value remounts the widget, which forces a fresh challenge
   * and a new token. Useful after a failed auth attempt to avoid reusing
   * a stale token that Cloudflare has already consumed.
   */
  resetKey?: number | string;
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

/** Si en este tiempo el challenge no resolvió (ni éxito ni error), asumimos
 *  que Cloudflare está caído/colgado. En condiciones normales el widget
 *  invisible resuelve en 1-3 segundos. */
const WATCHDOG_MS = 15_000;

/**
 * Cloudflare Turnstile widget wrapper.
 * Renders the challenge (invisible most of the time) and emits a token
 * via onVerify that must be passed to supabase.auth.* { captchaToken }.
 * Supabase's dashboard is configured with the matching secret key, so it
 * validates the token server-side before accepting the auth call.
 */
const TurnstileWidget = forwardRef<HTMLDivElement, Props>(function TurnstileWidget(
  { onVerify, onExpire, onError, onUnavailable, resetKey },
  ref,
) {
  const resolvedRef = useRef(false);
  const unavailableFiredRef = useRef(false);

  const fireUnavailable = () => {
    if (unavailableFiredRef.current) return;
    unavailableFiredRef.current = true;
    onUnavailable?.();
  };

  // Watchdog: challenge colgado (script no carga, PoP degradado) no dispara
  // onError — sin esto, el botón de login queda deshabilitado para siempre.
  useEffect(() => {
    resolvedRef.current = false;
    unavailableFiredRef.current = false;
    const t = setTimeout(() => {
      if (!resolvedRef.current) fireUnavailable();
    }, WATCHDOG_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  if (!SITE_KEY) {
    // Fail closed: if the key isn't configured, show a visible warning so
    // we notice during dev instead of silently skipping the captcha.
    return (
      <div ref={ref} className="text-xs text-destructive">
        VITE_TURNSTILE_SITE_KEY no está configurado.
      </div>
    );
  }

  return (
    <div ref={ref} className="flex justify-center">
      <Turnstile
        key={resetKey ?? "turnstile"}
        siteKey={SITE_KEY}
        onSuccess={(token) => {
          resolvedRef.current = true;
          onVerify(token);
        }}
        onExpire={onExpire}
        onError={() => {
          // Error explícito de Cloudflare → no esperamos el watchdog.
          resolvedRef.current = true;
          fireUnavailable();
          onError?.();
        }}
        options={{
          theme: "light",
          size: "normal",
        }}
      />
    </div>
  );
});

export default TurnstileWidget;
