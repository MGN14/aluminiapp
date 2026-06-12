import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Loader2,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  TrendingUp,
  FileText,
  Clock,
} from 'lucide-react';
import PasswordRequirements from '@/components/auth/PasswordRequirements';
import { evaluatePassword, translatePasswordError } from '@/lib/passwordPolicy';
import TurnstileWidget from '@/components/auth/TurnstileWidget';

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
  padding: '0 16px',
  fontSize: 15,
  fontFamily: FONT_STACK,
  color: '#1d1d1f',
  outline: 'none',
  transition: 'background 0.2s, border-color 0.2s, box-shadow 0.2s',
  WebkitFontSmoothing: 'antialiased',
};

function LeftPanel() {
  return (
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
  );
}

export default function Signup() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const { signUp, signOut, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const handleSwitchAccount = async () => {
    setSwitchingAccount(true);
    await signOut();
    setSwitchingAccount(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const evaluation = evaluatePassword(password);
    if (!evaluation.valid) {
      setError('Tu contraseña no cumple con todos los requisitos. Revisa la lista.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden. Revisá el campo de confirmación.');
      return;
    }
    if (!captchaToken) {
      setError('Por favor completa la verificación anti-bot.');
      return;
    }
    setLoading(true);
    const { error } = await signUp(email, password, fullName, captchaToken);
    if (error) {
      setCaptchaToken(null);
      setCaptchaResetKey((k) => k + 1);
      let msg = translatePasswordError(error.message);
      if (msg.includes('already registered') || msg.includes('already been registered')) {
        msg = 'Este correo ya está registrado. Intenta iniciar sesión.';
      } else if (msg.toLowerCase().includes('captcha')) {
        msg = 'La verificación anti-bot falló. Inténtalo de nuevo.';
      }
      setError(msg);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
    }
  };

  const handleResendEmail = async () => {
    setLoading(true);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
    });
    setLoading(false);
    if (!error) {
      // Could show a toast here
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setGoogleLoading(true);
    // Signup con Google = sesión persistente: pisa un 'false' viejo del
    // checkbox "Recordarme" de un login anterior (ver client.ts authStorage).
    try { localStorage.setItem('aluminia_remember_me', 'true'); } catch { /* noop */ }
    // OAuth directo contra Supabase (sin pasar por Lovable).
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
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

  // SUCCESS STATE
  if (success) {
    return (
      <div
        className="min-h-screen flex"
        style={{ fontFamily: FONT_STACK, WebkitFontSmoothing: 'antialiased' }}
      >
        <LeftPanel />
        <div
          className="flex flex-col justify-center w-full"
          style={{ background: '#ffffff', padding: '32px 24px', flex: 1 }}
        >
          <div
            className="w-full mx-auto text-center"
            style={{
              maxWidth: 420,
              animation: 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) both',
            }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background: 'oklch(0.43 0.14 155 / 0.10)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
                animation: 'popIn 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.1s both',
              }}
            >
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path
                  d="M7 16l7 7 11-14"
                  stroke="oklch(0.43 0.14 155)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    strokeDasharray: 28,
                    strokeDashoffset: 28,
                    animation: 'drawCheck 0.4s ease 0.3s forwards',
                  }}
                />
              </svg>
            </div>

            <h2
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: '#1d1d1f',
                letterSpacing: '-0.6px',
                marginBottom: 10,
              }}
            >
              ¡Revisa tu correo!
            </h2>
            <p style={{ fontSize: 14, color: '#6e6e73', lineHeight: 1.6, marginBottom: 20 }}>
              Te enviamos un enlace de confirmación a{' '}
              <strong style={{ color: '#1d1d1f' }}>{email}</strong>. Haz clic en el enlace para
              activar tu cuenta.
            </p>

            <div
              style={{
                background: '#f5f5f7',
                borderRadius: 14,
                padding: 16,
                marginBottom: 20,
                textAlign: 'left',
              }}
            >
              <p style={{ fontSize: 13, color: '#1d1d1f', fontWeight: 600, marginBottom: 8 }}>
                ¿No ves el correo?
              </p>
              <ul
                style={{
                  fontSize: 12,
                  color: '#6e6e73',
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <li>• Revisa tu carpeta de spam o promociones</li>
                <li>• Verifica que el correo esté bien escrito</li>
                <li>• Espera unos minutos y vuelve a intentar</li>
              </ul>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                onClick={handleResendEmail}
                disabled={loading}
                style={{
                  width: '100%',
                  height: 48,
                  background: '#fff',
                  color: '#1d1d1f',
                  border: '1.5px solid rgba(0,0,0,0.07)',
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: FONT_STACK,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.6 : 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reenviando...
                  </>
                ) : (
                  'Reenviar correo de verificación'
                )}
              </button>
              <Link to="/login" style={{ textDecoration: 'none' }}>
                <button
                  type="button"
                  style={{
                    width: '100%',
                    height: 44,
                    background: 'transparent',
                    color: '#6e6e73',
                    border: 'none',
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: FONT_STACK,
                    cursor: 'pointer',
                  }}
                >
                  Volver al inicio de sesión
                </button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex"
      style={{ fontFamily: FONT_STACK, WebkitFontSmoothing: 'antialiased' }}
    >
      <LeftPanel />

      <div
        className="flex flex-col justify-center w-full"
        style={{ background: '#ffffff', padding: '32px 24px', flex: 1 }}
      >
        <div
          className="w-full mx-auto"
          style={{
            maxWidth: 420,
            animation: 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) both',
          }}
        >
          {/* Logo mobile */}
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

          {user && (
            <div
              style={{
                marginBottom: 20,
                padding: 16,
                borderRadius: 14,
                border: '1px solid oklch(0.43 0.14 155 / 0.22)',
                background: 'oklch(0.43 0.14 155 / 0.06)',
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
                  onClick={() => navigate('/dashboard', { replace: true })}
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
                    opacity: switchingAccount ? 0.6 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    fontFamily: FONT_STACK,
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

          <div style={{ marginBottom: 28 }}>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: '-0.8px',
                color: '#1d1d1f',
                marginBottom: 8,
              }}
            >
              Crear Cuenta
            </h1>
            <p style={{ fontSize: 15, color: '#6e6e73', lineHeight: 1.5 }}>
              Comienza a organizar tus extractos bancarios
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Full name */}
            <div
              style={{
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s both',
                opacity: 0,
              }}
            >
              <label
                htmlFor="fullName"
                style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1d1d1f', marginBottom: 6 }}
              >
                Nombre completo
              </label>
              <input
                id="fullName"
                type="text"
                placeholder="Juan Pérez"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                style={inputBaseStyle}
                onFocus={(e) => applyInputFocus(e.currentTarget)}
                onBlur={(e) => applyInputBlur(e.currentTarget)}
              />
            </div>

            {/* Email */}
            <div
              style={{
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.11s both',
                opacity: 0,
              }}
            >
              <label
                htmlFor="email"
                style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1d1d1f', marginBottom: 6 }}
              >
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                placeholder="tu@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={inputBaseStyle}
                onFocus={(e) => applyInputFocus(e.currentTarget)}
                onBlur={(e) => applyInputBlur(e.currentTarget)}
              />
            </div>

            {/* Password */}
            <div
              style={{
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.17s both',
                opacity: 0,
              }}
            >
              <label
                htmlFor="password"
                style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1d1d1f', marginBottom: 6 }}
              >
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                placeholder="Mínimo 8 caracteres, 1 mayúscula, 1 número, 1 especial"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={inputBaseStyle}
                onFocus={(e) => applyInputFocus(e.currentTarget)}
                onBlur={(e) => applyInputBlur(e.currentTarget)}
              />
              <div style={{ marginTop: 8 }}>
                <PasswordRequirements password={password} showWhenEmpty />
              </div>
            </div>

            {/* Confirm password */}
            <div
              style={{
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.20s both',
                opacity: 0,
              }}
            >
              <label
                htmlFor="confirm-password"
                style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1d1d1f', marginBottom: 6 }}
              >
                Confirmar contraseña
              </label>
              <input
                id="confirm-password"
                type="password"
                placeholder="Repetí la contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                style={inputBaseStyle}
                onFocus={(e) => applyInputFocus(e.currentTarget)}
                onBlur={(e) => applyInputBlur(e.currentTarget)}
              />
              {confirmPassword.length > 0 && password !== confirmPassword && (
                <p style={{ marginTop: 6, fontSize: 12, color: '#dc2626' }}>
                  Las contraseñas no coinciden.
                </p>
              )}
              {confirmPassword.length > 0 && password === confirmPassword && password.length > 0 && (
                <p style={{ marginTop: 6, fontSize: 12, color: '#16a34a' }}>
                  Coinciden ✓
                </p>
              )}
            </div>

            <div
              style={{
                animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.23s both',
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
                  Creando cuenta...
                </>
              ) : (
                'Crear Cuenta'
              )}
            </button>

            <div className="flex items-center gap-3">
              <div style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.07)' }} />
              <span style={{ fontSize: 11, color: '#a1a1a6', letterSpacing: 0.3 }}>
                o continúa con
              </span>
              <div style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.07)' }} />
            </div>

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
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
              )}
              Continuar con Google
            </button>

            <p
              style={{
                textAlign: 'center',
                fontSize: 13,
                color: '#6e6e73',
                marginTop: 4,
              }}
            >
              ¿Ya tienes cuenta?{' '}
              <Link
                to="/login"
                style={{ color: 'oklch(0.43 0.14 155)', fontWeight: 600, textDecoration: 'none' }}
              >
                Iniciar sesión
              </Link>
            </p>
          </form>

          <p
            style={{
              textAlign: 'center',
              fontSize: 11,
              color: '#a1a1a6',
              marginTop: 24,
              lineHeight: 1.6,
            }}
          >
            Al crear una cuenta aceptas nuestros{' '}
            <Link to="/terms" style={{ color: 'oklch(0.43 0.14 155)', textDecoration: 'none' }}>
              Términos
            </Link>{' '}
            y{' '}
            <Link to="/privacy" style={{ color: 'oklch(0.43 0.14 155)', textDecoration: 'none' }}>
              Política de Privacidad
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
