import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, FileSpreadsheet, Lock, CheckCircle2, AlertCircle, Eye, EyeOff, Mail, KeyRound } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import PasswordRequirements from '@/components/auth/PasswordRequirements';
import { evaluatePassword, translatePasswordError } from '@/lib/passwordPolicy';

/**
 * Password reset page — supports 3 verification paths to survive email providers
 * that pre-fetch one-time links (Hotmail/Outlook Safe Links, corporate ATP, etc):
 *
 *  1. `?token_hash=xxx&type=recovery` query param — Supabase SPA-safe format.
 *     The token is only verified when our JS runs `verifyOtp({ token_hash })`,
 *     so Safe Links HTTP pre-fetches don't consume it. Requires email template
 *     linking to `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`.
 *
 *  2. `#access_token=xxx&type=recovery` URL hash — legacy implicit flow where
 *     Supabase's /auth/v1/verify endpoint consumes the token server-side and
 *     redirects here with fresh tokens in the hash. Vulnerable to Safe Links
 *     pre-fetch (token consumed before user clicks) but kept for backwards compat.
 *
 *  3. Manual 6-digit OTP code — user copies the `{{ .Token }}` value shown in
 *     the email and types it alongside their email. Bulletproof fallback: no
 *     URL to pre-fetch. Exchanges via `verifyOtp({ email, token, type: 'recovery' })`.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();

  // Email carried from ForgotPassword page (for OTP fallback)
  const initialEmail = (location.state as { email?: string } | null)?.email ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Verification state machine
  const [phase, setPhase] = useState<'initializing' | 'sessionReady' | 'needCode' | 'linkError'>('initializing');
  const [userEmail, setUserEmail] = useState(initialEmail);
  const [otpEmail, setOtpEmail] = useState(initialEmail);
  const [otpCode, setOtpCode] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  useEffect(() => {
    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const markReady = (email: string) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      setUserEmail(email);
      setPhase('sessionReady');
    };

    const markNeedCode = () => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      setPhase('needCode');
    };

    const markLinkError = (msg?: string) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      if (msg) setError(msg);
      setPhase('linkError');
    };

    // 1. Safe-Links-proof flow: ?token_hash=xxx&type=recovery
    const searchParams = new URLSearchParams(window.location.search);
    const tokenHash = searchParams.get('token_hash');
    const typeFromQuery = searchParams.get('type');

    if (tokenHash && typeFromQuery === 'recovery') {
      supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' }).then(({ data, error }) => {
        if (error) {
          markLinkError('El enlace expiró o ya fue usado. Usa el código de 6 dígitos del correo, o solicita uno nuevo.');
        } else if (data.session?.user?.email) {
          // Clean the URL so refresh doesn't re-trigger
          window.history.replaceState({}, '', window.location.pathname);
          markReady(data.session.user.email);
        } else {
          markLinkError();
        }
      });
      // Don't fall through to other paths while this resolves
      return () => {
        resolved = true;
      };
    }

    // 2. Error in URL hash (Supabase sends this for already-expired links)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const errorDescription = hashParams.get('error_description');
    if (errorDescription) {
      let decoded = errorDescription;
      try {
        decoded = decodeURIComponent(errorDescription);
      } catch {
        // URI malformado en el hash — usar el string raw como fallback
      }
      markLinkError(decoded.replace(/\+/g, ' '));
      return;
    }

    // 3. Legacy implicit flow: Supabase fires PASSWORD_RECOVERY when it processes
    //    the #access_token=... fragment on load
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session?.user?.email) {
        markReady(session.user.email);
      }
    });

    // 4. Fallback: maybe a session already exists (processed before listener registered)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) {
        markReady(session.user.email);
      }
    });

    // 5. After 3s with no resolution, show manual code entry (Hotmail Safe Links path)
    timer = setTimeout(() => markNeedCode(), 3000);

    return () => {
      resolved = true;
      subscription.unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const email = otpEmail.trim().toLowerCase();
    const token = otpCode.trim().replace(/\s+/g, '');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Ingresa un correo electrónico válido');
      return;
    }
    if (!token || !/^\d{6}$/.test(token)) {
      setError('El código debe ser de 6 dígitos');
      return;
    }

    setVerifyingOtp(true);
    const { data, error: otpError } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'recovery',
    });
    setVerifyingOtp(false);

    if (otpError || !data.session?.user?.email) {
      setError(
        otpError?.message?.toLowerCase().includes('expired')
          ? 'El código expiró. Solicita uno nuevo.'
          : 'Código inválido. Revisa el correo y el número.'
      );
      return;
    }

    setUserEmail(data.session.user.email);
    setPhase('sessionReady');
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password || !confirmPassword) {
      setError('Por favor completa ambos campos');
      return;
    }

    const evaluation = evaluatePassword(password);
    if (!evaluation.valid) {
      setError('Tu contraseña no cumple con todos los requisitos. Revisa la lista.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      if (/expired|invalid|session/i.test(updateError.message)) {
        setPhase('linkError');
        setError('La sesión expiró. Solicita un nuevo enlace.');
      } else {
        setError(translatePasswordError(updateError.message));
      }
      return;
    }

    setSuccess(true);
    toast({
      title: 'Contraseña actualizada',
      description: 'Tu contraseña ha sido cambiada exitosamente',
    });
    setTimeout(async () => {
      await supabase.auth.signOut();
      navigate('/login');
    }, 2000);
  };

  const handleResendReset = async () => {
    const email = userEmail || otpEmail;
    if (!email) {
      navigate('/forgot-password');
      return;
    }
    setResendLoading(true);
    const { error: resendError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResendLoading(false);

    if (resendError) {
      setError(resendError.message);
    } else {
      toast({
        title: 'Correo enviado',
        description: 'Revisa tu bandeja (y Spam). El código tiene 6 dígitos.',
      });
      setPhase('needCode');
      setOtpEmail(email);
      setError('');
    }
  };

  // ------- UI -------

  if (phase === 'initializing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verificando enlace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md animate-fade-in">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-lg gradient-brand flex items-center justify-center">
            <FileSpreadsheet className="w-6 h-6 text-primary-foreground" />
          </div>
          <span className="text-2xl font-bold text-foreground">AluminIA</span>
        </div>

        <Card className="border-border shadow-lg">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-semibold">
              {success
                ? '¡Contraseña Actualizada!'
                : phase === 'linkError'
                ? 'Enlace inválido'
                : phase === 'needCode'
                ? 'Ingresa el código'
                : 'Nueva Contraseña'}
            </CardTitle>
            <CardDescription>
              {success
                ? 'Tu contraseña ha sido actualizada exitosamente'
                : phase === 'linkError'
                ? 'El enlace del correo ya fue usado o expiró'
                : phase === 'needCode'
                ? 'Copia el código de 6 dígitos del correo'
                : 'Ingresa tu nueva contraseña'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* SUCCESS */}
            {success && (
              <div className="space-y-6">
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-primary" />
                  </div>
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  Serás redirigido al inicio de sesión en unos segundos...
                </p>
              </div>
            )}

            {/* LINK ERROR — show resend option */}
            {!success && phase === 'linkError' && (
              <div className="space-y-6">
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-destructive" />
                  </div>
                </div>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <p className="text-center text-sm text-muted-foreground">
                  Algunos proveedores de correo (Hotmail, Outlook) abren automáticamente los enlaces por seguridad, lo que los invalida.
                  Usa el <strong>código de 6 dígitos</strong> del correo en lugar del enlace.
                </p>
                <Button
                  onClick={() => {
                    setPhase('needCode');
                    setError('');
                  }}
                  className="w-full h-11"
                  variant="outline"
                >
                  <KeyRound className="w-4 h-4 mr-2" />
                  Ingresar código manualmente
                </Button>
                <Button onClick={handleResendReset} className="w-full h-11" disabled={resendLoading}>
                  {resendLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    'Enviar nuevo correo'
                  )}
                </Button>
              </div>
            )}

            {/* NEED CODE — user types 6-digit OTP from email */}
            {!success && phase === 'needCode' && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                  Copia el <strong>código de 6 dígitos</strong> que aparece en el correo que te enviamos.
                  Si no lo ves, revisa <strong>Spam</strong> o el buzón de correo no deseado.
                </div>

                <div className="space-y-2">
                  <Label htmlFor="otpEmail">Correo electrónico</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="otpEmail"
                      type="email"
                      placeholder="tu@empresa.com"
                      value={otpEmail}
                      onChange={(e) => setOtpEmail(e.target.value)}
                      className="h-11 pl-10"
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="otpCode">Código de 6 dígitos</Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="otpCode"
                      type="text"
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      placeholder="123456"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      className="h-11 pl-10 tracking-widest text-lg font-mono"
                      autoComplete="one-time-code"
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full h-11" disabled={verifyingOtp}>
                  {verifyingOtp ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verificando...
                    </>
                  ) : (
                    'Verificar código'
                  )}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={handleResendReset}
                  disabled={resendLoading}
                >
                  {resendLoading ? 'Enviando...' : '¿No te llegó? Reenviar correo'}
                </Button>
              </form>
            )}

            {/* SESSION READY — user sets new password */}
            {!success && phase === 'sessionReady' && (
              <form onSubmit={handleSetPassword} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {userEmail && (
                  <p className="text-sm text-muted-foreground text-center">
                    Restableciendo contraseña para <strong>{userEmail}</strong>
                  </p>
                )}

                <div className="space-y-2">
                  <Label htmlFor="password">Nueva contraseña</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Mínimo 8 caracteres"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 pl-10 pr-10"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <PasswordRequirements password={password} showWhenEmpty />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Repite tu contraseña"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-11 pl-10 pr-10"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <Button type="submit" className="w-full h-11" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Actualizando...
                    </>
                  ) : (
                    'Restablecer Contraseña'
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
