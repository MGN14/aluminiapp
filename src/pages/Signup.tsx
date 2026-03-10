import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Loader2, FileSpreadsheet, CheckCircle, LayoutDashboard, LogOut } from 'lucide-react';

export default function Signup() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
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
    setLoading(true);
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      setLoading(false);
      return;
    }
    const { error } = await signUp(email, password, fullName);
    if (error) {
      // Translate common Supabase auth error messages to Spanish
      let msg = error.message;
      if (msg.includes('weak') || msg.includes('easy to guess')) {
        msg = 'La contraseña es muy común o fácil de adivinar. Por favor elige una más segura.';
      } else if (msg.includes('already registered') || msg.includes('already been registered')) {
        msg = 'Este correo ya está registrado. Intenta iniciar sesión.';
      } else if (msg.includes('rate limit') || msg.includes('too many requests')) {
        msg = 'Demasiados intentos. Espera un momento antes de intentar de nuevo.';
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


  if (success) {
    return <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md animate-fade-in">
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-lg gradient-brand flex items-center justify-center">
              <FileSpreadsheet className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-2xl font-bold text-foreground">AluminIA</span>
          </div>

          <Card className="border-border shadow-lg">
            <CardContent className="pt-8 pb-8 text-center">
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-success" />
              </div>
              <h2 className="text-xl font-semibold mb-2">¡Revisa tu correo!</h2>
              <p className="text-muted-foreground mb-4">
                Te enviamos un enlace de confirmación a <strong>{email}</strong>. 
                Haz clic en el enlace para activar tu cuenta.
              </p>
              
              {/* Troubleshooting tips */}
              <div className="bg-muted/50 rounded-lg p-4 mb-6 text-left">
                <p className="text-sm text-muted-foreground mb-2">
                  <strong>¿No ves el correo?</strong>
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Revisa tu carpeta de spam o promociones</li>
                  <li>• Verifica que el correo esté bien escrito</li>
                  <li>• Espera unos minutos y vuelve a intentar</li>
                </ul>
              </div>

              <div className="space-y-3">
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={handleResendEmail}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Reenviando...
                    </>
                  ) : (
                    'Reenviar correo de verificación'
                  )}
                </Button>
                <Link to="/login">
                  <Button variant="ghost" className="w-full">
                    Volver al inicio de sesión
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>;
  }
  return <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-lg gradient-brand flex items-center justify-center">
            <FileSpreadsheet className="w-6 h-6 text-primary-foreground" />
          </div>
          <span className="text-2xl font-bold text-foreground">AluminIA</span>
        </div>

        {/* Already logged in banner */}
        {user && (
          <div className="mb-5 p-4 rounded-lg border border-accent/30 bg-accent/5">
            <p className="text-sm font-medium text-foreground mb-1">
              Ya estás conectado como <span className="text-accent">{user.email}</span>
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              Puedes ir a tu dashboard o iniciar sesión con otra cuenta.
            </p>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => navigate('/dashboard', { replace: true })}>
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

        <Card className="border-border shadow-lg">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-semibold">Crear Cuenta</CardTitle>
            <CardDescription>Comienza a organizar tus extractos bancarios</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>}
              
              <div className="space-y-2">
                <Label htmlFor="fullName">Nombre completo</Label>
                <Input id="fullName" type="text" placeholder="Juan Pérez" value={fullName} onChange={e => setFullName(e.target.value)} required className="h-11" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input id="email" type="email" placeholder="tu@empresa.com" value={email} onChange={e => setEmail(e.target.value)} required className="h-11" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input id="password" type="password" placeholder="Mínimo 6 caracteres" value={password} onChange={e => setPassword(e.target.value)} required className="h-11" />
              </div>

              <Button type="submit" className="w-full h-11" disabled={loading}>
                {loading ? <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creando cuenta...
                  </> : 'Crear Cuenta'}
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
            </form>

            <p className="text-center text-sm text-muted-foreground mt-6">
              ¿Ya tienes cuenta?{' '}
              <Link to="/login" className="font-medium hover:underline text-primary">
                Iniciar sesión
              </Link>
            </p>
          </CardContent>
        </Card>

        {/* Terms */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          Al crear una cuenta aceptas nuestros{' '}
          <Link to="/terms" className="text-primary hover:underline">
            Términos
          </Link>{' '}
          y{' '}
          <Link to="/privacy" className="text-primary hover:underline">
            Política de Privacidad
          </Link>
        </p>
      </div>
    </div>;
}