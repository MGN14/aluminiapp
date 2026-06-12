import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, FileSpreadsheet, ArrowLeft, Mail, CheckCircle2, KeyRound } from 'lucide-react';
import TurnstileWidget from '@/components/auth/TurnstileWidget';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  // Cloudflare caído: fail-open de UI (el server-side sigue mandando).
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email) {
      setError('Por favor ingresa tu correo electrónico');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Por favor ingresa un correo electrónico válido');
      return;
    }

    if (!captchaToken && !captchaUnavailable) {
      setError('Por favor completa la verificación anti-bot.');
      return;
    }

    setLoading(true);

    const normalizedEmail = email.trim().toLowerCase();

    const options: Parameters<typeof supabase.auth.resetPasswordForEmail>[1] & { captchaToken?: string } = {
      redirectTo: `${window.location.origin}/reset-password`,
    };
    if (captchaToken) options.captchaToken = captchaToken;

    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, options as any);

    setLoading(false);

    if (error) {
      setCaptchaToken(null);
      setCaptchaResetKey(k => k + 1);
      // Translate the captcha error to something actionable
      const msg = error.message.toLowerCase().includes('captcha')
        ? 'Error en la verificación anti-bot. Recargá la página e intentá de nuevo.'
        : error.message;
      setError(msg);
    } else {
      setSent(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-lg gradient-brand flex items-center justify-center">
            <FileSpreadsheet className="w-6 h-6 text-primary-foreground" />
          </div>
          <span className="text-2xl font-bold text-foreground">AluminIA</span>
        </div>

        <Card className="border-border shadow-lg">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-semibold">
              {sent ? 'Revisa tu correo' : 'Recuperar Contraseña'}
            </CardTitle>
            <CardDescription>
              {sent
                ? 'Te hemos enviado un enlace para restablecer tu contraseña'
                : 'Ingresa tu correo y te enviaremos un enlace de recuperación'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="space-y-6">
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-primary" />
                  </div>
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  Si existe una cuenta con el correo <strong>{email}</strong>, recibirás un correo con un <strong>enlace</strong> y un <strong>código de 6 dígitos</strong>.
                </p>
                <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  <strong>¿Usas Hotmail u Outlook?</strong> Su sistema de seguridad a veces invalida el enlace automáticamente. Si el enlace no funciona, usa el código de 6 dígitos que aparece en el correo.
                </div>
                <Button
                  onClick={() => navigate('/reset-password', { state: { email: email.trim().toLowerCase() } })}
                  className="w-full h-11"
                >
                  <KeyRound className="w-4 h-4 mr-2" />
                  Ingresar código de 6 dígitos
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/login">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Volver al inicio de sesión
                  </Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Correo electrónico</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="tu@empresa.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 pl-10"
                    />
                  </div>
                </div>

                <TurnstileWidget
                  resetKey={captchaResetKey}
                  onVerify={(t) => { setCaptchaToken(t); setCaptchaUnavailable(false); }}
                  onExpire={() => setCaptchaToken(null)}
                  onError={() => setCaptchaToken(null)}
                  onUnavailable={() => setCaptchaUnavailable(true)}
                />
                {captchaUnavailable && !captchaToken && (
                  <p className="text-xs text-amber-700 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2 text-center">
                    La verificación anti-bot de Cloudflare no está disponible. Podés continuar igual.
                  </p>
                )}

                <Button type="submit" className="w-full h-11" disabled={loading || (!captchaToken && !captchaUnavailable)}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    'Enviar enlace de recuperación'
                  )}
                </Button>

                <Button asChild variant="ghost" className="w-full">
                  <Link to="/login">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Volver al inicio de sesión
                  </Link>
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
