import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, FileSpreadsheet, Eye, EyeOff, Mail, Lock } from 'lucide-react';
import SecurityFeatures from '@/components/auth/SecurityFeatures';
import TestimonialReviews from '@/components/auth/TestimonialReviews';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get the redirect destination from state, or default to dashboard
  const from = (location.state as { from?: string })?.from || '/dashboard';

  // If user is already logged in, redirect them
  useEffect(() => {
    if (!authLoading && user) {
      navigate(from, { replace: true });
    }
  }, [user, authLoading, navigate, from]);

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

    setLoading(true);

    const { error } = await signIn(email, password);
    
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        setError('Correo o contraseña incorrectos');
      } else {
        setError(error.message);
      }
      setLoading(false);
    } else {
      // Navigation will happen via the useEffect when user state updates
      // This prevents race conditions
    }
  };

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

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    className="w-full h-11"
                    disabled={loading}
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
