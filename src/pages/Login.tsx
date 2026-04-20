import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { lovable } from '@/integrations/lovable/index';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Loader2,
  FileSpreadsheet,
  Eye,
  EyeOff,
  Mail,
  Lock,
  LogOut,
  LayoutDashboard,
  TrendingUp,
  FileText,
  Clock,
} from 'lucide-react';
import TurnstileWidget from '@/components/auth/TurnstileWidget';
import { checkRateLimit, recordFailure, recordSuccess, formatRemaining } from '@/lib/rateLimitClient';

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif";

const applyInputFocus = (el: HTMLInputElement) => {
  el.style.background = '#fff';
  el.style.borderColor = 'oklch(0.43 0.14 155)';
  el.style.boxShadow = '0 0 0 4px oklch(0.43 0.14 155 / 0.10)';
};
const applyInputBlur = (el: HTMLInputElement) => {
  el.style.background = '#f5f5f7';
  el.style.borderColor = 'transparent';
  el.style.boxShadow = 'none';
};

const inputBaseStyle: React.CSSProperties = {
  width: '100%',
  height: 48,
  background: '#f5f5f7',
  border: '1.5px solid transparent',
  borderRadius: 12,
  padding: '0 44px 0 44px',
  fontSize: 15,
  fontFamily: FONT_STACK,
  color: '#1d1d1f',
  outline: 'none',
  transition: 'background 0.2s, border-color 0.2s, box-shadow 0.2s',
  WebkitFontSmoothing: 'antialiased',
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const { signIn, signOut, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: string })?.from || '/dashboard';

  useEffect(() => {
    if (user && !authLoading && !switchingAccount) {
      navigate(from, { replace: true });
    }
  }, [user, authLoading, switchingAccount, from, navigate]);

  const handleGoToDashboard = () => navigate(from, { replace: true });

  const handleSwitchAccount = async () => {
    setSwitchingAccount(true);
    await signOut();
    setSwitchingAccount(false);
  };

  const validateForm = (): boolean => {
    if (!email) {
      setError('Por favor ingresa tu correo electrónico');
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Por favor ingresa un correo electrónico válido');
      return false;
    }

    if (!password) {
      setError('Por favor ingresa tu contraseña');
      return false;
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validateForm()) {
      return;
    }

    if (!captchaToken) {
      setError('Por favor completa la verificación anti-bot.');
      return;
    }

    setLoading(true);

    const gate = await checkRateLimit(email);
    if (!gate.allowed) {
      setLoading(false);
      setCaptchaToken(null);
      setCaptchaResetKey((k) => k + 1);
      const when = gate.remainingSeconds ? formatRemaining(gate.remainingSeconds) : 'unos minutos';
      setError(`Demasiados intentos fallidos. Intenta de nuevo en ${when}.`);
      return;
    }

    const { error } = await signIn(email, password, captchaToken);

    if (error) {
      setCaptchaToken(null);
      setCaptchaResetKey((k) => k + 1);
      if (error.message.includes('Invalid login credentials')) {
        await recordFailure(email, 'invalid_credentials');
        setError('Correo o contraseña incorrectos');
      } else if (error.message.toLowerCase().includes('captcha')) {
        await recordFailure(email, 'captcha_failed');
        setError('La verificación anti-bot falló. Inténtalo de nuevo.');
      } else {
        await recordFailure(email, error.message.slice(0, 200));
        setError(error.message);
      }
      setLoading(false);
    } else {
      await recordSuccess(email);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setGoogleLoading(true);
    const { error } = await lovable.auth.signInWithOAuth('google', {
      redirect_uri: `${window.location.origin}/dashboard`,
    });
    if (error) {
      setError(error.message || 'Error al iniciar sesión con Google');
      setGoogleLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: '#f5f5f7', fontFamily: FONT_STACK }}
      >
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'oklch(0.43 0.14 155)' }} />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex"
      style={{ fontFamily: FONT_STACK, WebkitFontSmoothing: 'antialiased' }}
    >
      {/* LEFT PANEL (dark) */}
      <div
        className="hidden lg:flex flex-col justify-between"
        style={{
          width: '52%',
          background: '#080d08',
          position: 'relative',
          overflow: 'hidden',
          padding: '48px 52px',
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: 520,
            height: 520,
            borderRadius: '50%',
            filter: 'blur(80px)',
            opacity: 0.55,
            background: 'oklch(0.35 0.16 155)',
            top: -120,
            left: -100,
            animation: 'drift 18s linear infinite alternate',
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: 380,
            height: 380,
            borderRadius: '50%',
            filter: 'blur(80px)',
            opacity: 0.55,
            background: 'oklch(0.28 0.12 180)',
            bottom: -80,
            right: -60,
            animation: 'drift 22s linear infinite alternate',
            animationDelay: '-5s',
          }}
        />

        {/* Logo */}
        <div style={{ position: 'relative', zIndex: 1 }} className="flex items-center gap-3">
          <div
            style={{
              width: 38,
              height: 38,
              background: 'oklch(0.43 0.14 155)',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FileSpreadsheet className="w-5 h-5 text-white" />
          </div>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.3px' }}>
            AluminIA
          </span>
        </div>

        {/* Headline */}
        <div style={{ position: 'relative', zIndex: 1, marginTop: 80 }}>
          <h1
            style={{
              fontSize: 'clamp(32px,3.5vw,48px)',
              fontWeight: 700,
              letterSpacing: '-1.5px',
              lineHeight: 1.05,
              color: '#fff',
              marginBottom: 16,
            }}
          >
            Finanzas que
            <br />
            <span style={{ color: 'oklch(0.60 0.14 155)' }}>trabajan</span> para ti
          </h1>
          <p
            style={{
              fontSize: 16,
              color: 'rgba(255,255,255,0.5)',
              lineHeight: 1.6,
              maxWidth: 320,
            }}
          >
            Gestiona tus extractos, facturas y flujo de caja con inteligencia artificial nativa.
          </p>
        </div>

        {/* Métricas flotantes */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {[
            { label: 'Ingresos este mes', val: '$48.2M COP', Icon: TrendingUp },
            { label: 'Facturas procesadas', val: '1,248 automáticamente', Icon: FileText },
            { label: 'Ahorro de tiempo', val: '6h/semana promedio', Icon: Clock },
          ].map((m, i) => (
            <div
              key={m.label}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.10)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderRadius: 16,
                padding: '18px 22px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                animation: `fadeUp 0.7s cubic-bezier(0.16,1,0.3,1) ${0.4 + i * 0.15}s both`,
                opacity: 0,
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'oklch(0.43 0.14 155 / 0.18)',
                  border: '1px solid oklch(0.43 0.14 155 / 0.30)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <m.Icon style={{ width: 18, height: 18, color: 'oklch(0.60 0.14 155)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.3 }}>
                  {m.label}
                </span>
                <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{m.val}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Trust pills */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {['🔒 256-bit SSL', '✓ DIAN Cumplimiento', '☁ Datos en Colombia'].map((p) => (
            <span
              key={p}
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: 'rgba(255,255,255,0.4)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 99,
                padding: '5px 12px',
              }}
            >
              {p}
            </span>
          ))}
        </div>
      </div>

      {/* RIGHT PANEL (form) */}
      <div
        className="flex flex-col justify-center w-full"
        style={{
          background: '#ffffff',
          padding: '32px 24px',
          flex: 1,
        }}
      >
        <div
          className="w-full mx-auto"
          style={{
            maxWidth: 420,
            animation: 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) both',
          }}
        >
          {/* Logo (mobile only) */}
          <div className="flex lg:hidden items-center gap-2 mb-8">
            <div
              style={{
                width: 36,
                height: 36,
                background: 'oklch(0.43 0.14 155)',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#1d1d1f' }}>AluminIA</span>
          </div>

          {/* Already logged in banner */}
          {user && (
            <div
              style={{
                marginBottom: 24,
                padding: 16,
                borderRadius: 14,
                border: '1px solid oklch(0.43 0.14 155 / 0.22)',
                background: 'oklch(0.43 0.14 155 / 0.06)',
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) both',
              }}
            >
              <p style={{ fontSize: 13, fontWeight: 500, color: '#1d1d1f', marginBottom: 4 }}>
                Ya estás conectado como{' '}
                <span style={{ color: 'oklch(0.43 0.14 155)' }}>{user.email}</span>
              </p>
              <p style={{ fontSize: 12, color: '#6e6e73', marginBottom: 12 }}>
                Puedes ir a tu dashboard o iniciar sesión con otra cuenta.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleGoToDashboard}
                  style={{
                    flex: 1,
                    height: 38,
                    background: '#1d1d1f',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    fontFamily: FONT_STACK,
                  }}
                >
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  Ir al Dashboard
                </button>
                <button
                  type="button"
                  onClick={handleSwitchAccount}
                  disabled={switchingAccount}
                  style={{
                    flex: 1,
                    height: 38,
                    background: '#fff',
                    color: '#1d1d1f',
                    border: '1.5px solid rgba(0,0,0,0.07)',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: switchingAccount ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    fontFamily: FONT_STACK,
                    opacity: switchingAccount ? 0.6 : 1,
                  }}
                >
                  {switchingAccount ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LogOut className="h-3.5 w-3.5" />
                  )}
                  Cambiar cuenta
                </button>
              </div>
            </div>
          )}

          {/* Header */}
          <div
            style={{
              marginBottom: 28,
              animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s both',
              opacity: 0,
            }}
          >
            <h1
              style={{
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: '-0.8px',
                color: '#1d1d1f',
                marginBottom: 8,
              }}
            >
              Iniciar Sesión
            </h1>
            <p style={{ fontSize: 15, color: '#6e6e73', lineHeight: 1.5 }}>
              Ingresa a tu cuenta para gestionar tus finanzas empresariales
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
              <div
                style={{
                  animation: 'fieldIn 0.3s cubic-bezier(0.16,1,0.3,1) both',
                }}
              >
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </div>
            )}

            {/* Email */}
            <div
              style={{
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.12s both',
                opacity: 0,
              }}
            >
              <label
                htmlFor="email"
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#1d1d1f',
                  marginBottom: 6,
                }}
              >
                Correo electrónico
              </label>
              <div style={{ position: 'relative' }}>
                <Mail
                  style={{
                    position: 'absolute',
                    left: 16,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 16,
                    height: 16,
                    color: '#a1a1a6',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  id="email"
                  type="email"
                  placeholder="tu@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  style={inputBaseStyle}
                  onFocus={(e) => applyInputFocus(e.currentTarget)}
                  onBlur={(e) => applyInputBlur(e.currentTarget)}
                />
              </div>
            </div>

            {/* Password */}
            <div
              style={{
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.18s both',
                opacity: 0,
              }}
            >
              <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                <label
                  htmlFor="password"
                  style={{ fontSize: 13, fontWeight: 500, color: '#1d1d1f' }}
                >
                  Contraseña
                </label>
                <Link
                  to="/forgot-password"
                  style={{
                    fontSize: 12,
                    color: 'oklch(0.43 0.14 155)',
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <div style={{ position: 'relative' }}>
                <Lock
                  style={{
                    position: 'absolute',
                    left: 16,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 16,
                    height: 16,
                    color: '#a1a1a6',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  style={inputBaseStyle}
                  onFocus={(e) => applyInputFocus(e.currentTarget)}
                  onBlur={(e) => applyInputBlur(e.currentTarget)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: '#a1a1a6',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember */}
            <div
              className="flex items-center gap-2"
              style={{
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.24s both',
                opacity: 0,
              }}
            >
              <input
                id="remember"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{
                  width: 16,
                  height: 16,
                  accentColor: 'oklch(0.43 0.14 155)',
                  cursor: 'pointer',
                }}
              />
              <label
                htmlFor="remember"
                style={{ fontSize: 13, color: '#6e6e73', cursor: 'pointer' }}
              >
                Recordarme
              </label>
            </div>

            {/* Turnstile */}
            <div
              style={{
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.30s both',
                opacity: 0,
              }}
            >
              <TurnstileWidget
                resetKey={captchaResetKey}
                onVerify={setCaptchaToken}
                onExpire={() => setCaptchaToken(null)}
                onError={() => setCaptchaToken(null)}
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !captchaToken}
              style={{
                width: '100%',
                height: 50,
                background: '#1d1d1f',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 600,
                fontFamily: FONT_STACK,
                cursor: loading || !captchaToken ? 'not-allowed' : 'pointer',
                opacity: loading || !captchaToken ? 0.55 : 1,
                transition: 'transform 0.15s, background 0.15s, box-shadow 0.15s',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.36s both',
              }}
              onMouseEnter={(e) => {
                if (loading || !captchaToken) return;
                e.currentTarget.style.transform = 'scale(1.01)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.18)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Ingresando...
                </>
              ) : (
                'Iniciar Sesión'
              )}
            </button>

            {/* Divider */}
            <div
              className="flex items-center gap-3"
              style={{
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.42s both',
                opacity: 0,
              }}
            >
              <div style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.07)' }} />
              <span style={{ fontSize: 11, color: '#a1a1a6', letterSpacing: 0.3 }}>
                o continúa con
              </span>
              <div style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.07)' }} />
            </div>

            {/* Google */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading || loading}
              style={{
                width: '100%',
                height: 50,
                background: '#fff',
                color: '#1d1d1f',
                border: '1.5px solid rgba(0,0,0,0.07)',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: FONT_STACK,
                cursor: googleLoading || loading ? 'not-allowed' : 'pointer',
                opacity: googleLoading || loading ? 0.55 : 1,
                transition: 'border-color 0.15s, box-shadow 0.15s',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.48s both',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(0,0,0,0.14)';
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(0,0,0,0.07)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {googleLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
              )}
              Continuar con Google
            </button>

            {/* Register */}
            <p
              style={{
                textAlign: 'center',
                fontSize: 13,
                color: '#6e6e73',
                marginTop: 4,
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.54s both',
                opacity: 0,
              }}
            >
              ¿No tienes una cuenta?{' '}
              <Link
                to="/signup"
                style={{
                  color: 'oklch(0.43 0.14 155)',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                Regístrate gratis
              </Link>
            </p>
          </form>

          {/* Terms */}
          <p
            style={{
              textAlign: 'center',
              fontSize: 11,
              color: '#a1a1a6',
              marginTop: 24,
              lineHeight: 1.6,
            }}
          >
            Al iniciar sesión aceptas nuestros{' '}
            <Link
              to="/terms"
              style={{ color: 'oklch(0.43 0.14 155)', textDecoration: 'none' }}
            >
              Términos
            </Link>{' '}
            y{' '}
            <Link
              to="/privacy"
              style={{ color: 'oklch(0.43 0.14 155)', textDecoration: 'none' }}
            >
              Política de Privacidad
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
