import { Turnstile } from "@marsidev/react-turnstile";
import { forwardRef } from "react";

interface Props {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  /**
   * Changing this value remounts the widget, which forces a fresh challenge
   * and a new token. Useful after a failed auth attempt to avoid reusing
   * a stale token that Cloudflare has already consumed.
   */
  resetKey?: number | string;
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

/**
 * Cloudflare Turnstile widget wrapper.
 * Renders the challenge (invisible most of the time) and emits a token
 * via onVerify that must be passed to supabase.auth.* { captchaToken }.
 * Supabase's dashboard is configured with the matching secret key, so it
 * validates the token server-side before accepting the auth call.
 */
const TurnstileWidget = forwardRef<HTMLDivElement, Props>(function TurnstileWidget(
  { onVerify, onExpire, onError, resetKey },
  ref,
) {
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
        onSuccess={onVerify}
        onExpire={onExpire}
        onError={onError}
        options={{
          theme: "light",
          size: "normal",
        }}
      />
    </div>
  );
});

export default TurnstileWidget;
