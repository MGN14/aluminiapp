import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { lovable } from '@/integrations/lovable/index';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, FileSpreadsheet, Eye, EyeOff, Mail, Lock, LogOut, LayoutDashboard } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import SecurityFeatures from '@/components/auth/SecurityFeatures';
import TestimonialReviews from '@/components/auth/TestimonialReviews';
import TurnstileWidget from '@/components/auth/TurnstileWidget';
import { checkRateLimit, recordFailure, recordSuccess, formatRemaining } from '@/lib/rateLimitClient';

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
  const { signIn, signOut, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get the redirect destination from state, or default to dashboard
  const from = (location.state as { from?: string })?.from || '/dashboard';

  // Auto-redirect when user is authenticated (after login or already logged in)
  // Only redirect if not switching accounts
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

    // Rate-limit gate: reject if (email, ip) has exceeded the threshold.
    const gate = await checkRateLimit(email);
    if (!gate.allowed) {
      setLoading(false);
      setCaptchaToken(null);
      const when = gate.remainingSeconds ? formatRemaining(gate.remainingSeconds) : "unos minutos";
      setError(`Demasiados intentos fallidos. Intenta de nuevo en ${when}.`);
      return;
    }

    const { error } = await signIn(email, password, captchaToken);

    if (error) {
      // Force captcha reset on any failure so user can't brute-force with one token.
      setCaptchaToken(null);
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
      // Navigation will happen via the useEffect when user state updates
      // This prevents race conditions
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setGoogleLoading(true);
    const { error } = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (error) {
      setError(error.message || 'Error al iniciar sesión con Google');
      setGoogleLoading(false);
    }
  };

  // Show loader while auth is initializing to avoid flicker
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        {/* Left Column - Login Form */}
        <div className="w-full lg:w-1/2 flex flex-col justify-center px-4 sm:px-8 lg:px-16 py-12">
          <div className="w-full max-w-md mx-auto animate-fade-in">
            {/* Logo */}
            <div className="flex items-center gap-2 mb-8">
              <div className="w-10 h-10 rounded-lg gradient-brand flex items-center justify-center">
                <FileSpreadsheet className="w-6 h-6 text-primary-foreground" />
              </div>
              <span className="text-2xl font-bold text-foreground">AluminIA</span>
            </div>

            {/* Already logged in banner */}
            {user && (
              <div className="mb-6 p-4 rounded-lg border border-accent/30 bg-accent/5">
                <p className="text-sm font-medium text-foreground mb-1">
                  Ya estás conectado como <span className="text-accent">{user.email}</span>
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  Puedes ir a tu dashboard o iniciar sesión con otra cuenta.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={handleGoToDashboard}>
                    <LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />
                    Ir al Dashboard
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={handleSwitchAccount}
                    disabled={switchingAccount}
                  >
                    {switchingAccount ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <LogOut className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Cambiar cuenta
                  </Button>
                </div>
              </div>
            )}

            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Iniciar Sesión
              </h1>
              <p className="text-muted-foreground">
                Ingresa a tu cuenta para gestionar tus finanzas empresariales
              </p>
            </div>

            {/* Form */}
            <Card className="border-border shadow-lg">
              <CardContent className="pt-6">
                <form onSubmit={handleSubmit} className="space-y-5">
                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  {/* Email Field */}
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
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  {/* Password Field */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Contraseña</Label>
                      <Link
                        to="/forgot-password"
                        className="text-sm text-primary hover:underline"
                      >
                        ¿Olvidaste tu contraseña?
                      </Link>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-11 pl-10 pr-10"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Remember Me */}
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="remember"
                      checked={rememberMe}
                      onCheckedChange={(checked) => setRememberMe(checked === true)}
                    />
                    <Label
                      htmlFor="remember"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Recordarme
                    </Label>
                  </div>

                  {/* Turnstile (Cloudflare) anti-bot widget */}
                  <TurnstileWidget
                    onVerify={setCaptchaToken}
                    onExpire={() => setCaptchaToken(null)}
                    onError={() => setCaptchaToken(null)}
                  />

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    className="w-full h-11"
                    disabled={loading || !captchaToken}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Ingresando...
                      </>
                    ) : (
                      'Iniciar Sesión'
                    )}
                  </Button>

                  {/* Divider */}
                  <div className="flex items-center gap-3">
                    <Separator className="flex-1" />
                    <span className="text-xs text-muted-foreground">o continúa con</span>
                    <Separator className="flex-1" />
                  </div>

                  {/* Google Sign In */}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-11"
                    onClick={handleGoogleSignIn}
                    disabled={googleLoading || loading}
                  >
                    {googleLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                    )}
                    Continuar con Google
                  </Button>

                  {/* Register Link */}
                  <p className="text-center text-sm text-muted-foreground">
                    ¿No tienes una cuenta?{' '}
                    <Link
                      to="/signup"
                      className="text-primary font-medium hover:underline"
                    >
                      Regístrate gratis
                    </Link>
                  </p>
                </form>
              </CardContent>
            </Card>

            {/* Terms */}
            <p className="text-center text-xs text-muted-foreground mt-6">
              Al iniciar sesión aceptas nuestros{' '}
              <Link to="/terms" className="text-primary hover:underline">
                Términos
              </Link>{' '}
              y{' '}
              <Link to="/privacy" className="text-primary hover:underline">
                Política de Privacidad
              </Link>
            </p>
          </div>
        </div>

        {/* Right Column - Trust Elements (Desktop) */}
        <div className="hidden lg:flex lg:w-1/2 bg-muted/30 border-l border-border">
          <div className="w-full max-w-lg mx-auto px-8 py-12 flex flex-col justify-center space-y-10">
            <SecurityFeatures />
            <TestimonialReviews />
          </div>
        </div>
      </div>

      {/* Mobile: Trust Elements below form */}
      <div className="lg:hidden px-4 pb-12 space-y-10 bg-muted/30 border-t border-border pt-10">
        <div className="max-w-md mx-auto space-y-10">
          <SecurityFeatures />
          <TestimonialReviews />
        </div>
      </div>
    </div>
  );
}
