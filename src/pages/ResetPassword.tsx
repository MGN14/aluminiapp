import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, FileSpreadsheet, Lock, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import PasswordRequirements from '@/components/auth/PasswordRequirements';
import { evaluatePassword, translatePasswordError } from '@/lib/passwordPolicy';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [tokenError, setTokenError] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const initializeSession = async () => {
      try {
        // Check for error in URL hash first (e.g., expired token)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const errorDescription = hashParams.get('error_description');
        if (errorDescription) {
          setTokenError(true);
          setError(decodeURIComponent(errorDescription));
          setInitializing(false);
          return;
        }

        // Option 1: Check for 'code' in query string (PKCE flow)
        const code = searchParams.get('code');
        const type = searchParams.get('type');
        
        if (code) {
          if (type !== 'recovery') {
            setTokenError(true);
            setError('Link inválido o expirado');
            setInitializing(false);
            return;
          }
          
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            console.error('Exchange code error:', exchangeError);
            setTokenError(true);
            setError(exchangeError.message.includes('expired') 
              ? 'El enlace ha expirado. Solicita uno nuevo.' 
              : 'Link inválido o expirado');
            setInitializing(false);
            return;
          }
          
          if (data.session?.user?.email) {
            setUserEmail(data.session.user.email);
            setSessionReady(true);
          }
          setInitializing(false);
          return;
        }

        // Option 2: Check for access_token and refresh_token in hash (implicit flow)
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const hashType = hashParams.get('type');

        if (accessToken && refreshToken) {
          if (hashType !== 'recovery') {
            setTokenError(true);
            setError('Link inválido o expirado');
            setInitializing(false);
            return;
          }

          const { data, error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });

          if (setSessionError) {
            console.error('Set session error:', setSessionError);
            setTokenError(true);
            setError(setSessionError.message.includes('expired') 
              ? 'El enlace ha expirado. Solicita uno nuevo.' 
              : 'Link inválido o expirado');
            setInitializing(false);
            return;
          }

          if (data.session?.user?.email) {
            setUserEmail(data.session.user.email);
            setSessionReady(true);
          }
          // Clear the hash from URL for cleaner display
          window.history.replaceState(null, '', window.location.pathname);
          setInitializing(false);
          return;
        }

        // Option 3: Check if there's already an active recovery session
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email) {
          setUserEmail(session.user.email);
          setSessionReady(true);
          setInitializing(false);
          return;
        }

        // No valid token found
        setTokenError(true);
        setError('Link inválido o expirado. Por favor solicita un nuevo enlace.');
        setInitializing(false);
      } catch (err) {
        console.error('Session initialization error:', err);
        setTokenError(true);
        setError('Error al procesar el enlace de recuperación');
        setInitializing(false);
      }
    };

    initializeSession();
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validations
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
      if (updateError.message.includes('expired') || updateError.message.includes('invalid') || updateError.message.includes('session')) {
        setTokenError(true);
        setError('La sesión ha expirado. Solicita un nuevo enlace.');
      } else {
        setError(translatePasswordError(updateError.message));
      }
    } else {
      setSuccess(true);
      toast({
        title: "Contraseña actualizada",
        description: "Tu contraseña ha sido cambiada exitosamente",
      });
      // Sign out and redirect to login after 2 seconds
      setTimeout(async () => {
        await supabase.auth.signOut();
        navigate('/login');
      }, 2000);
    }
  };

  const handleResendReset = async () => {
    if (!userEmail) {
      navigate('/forgot-password');
      return;
    }

    setResendLoading(true);
    const { error: resendError } = await supabase.auth.resetPasswordForEmail(userEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResendLoading(false);

    if (resendError) {
      setError(resendError.message);
    } else {
      toast({
        title: "Enlace enviado",
        description: "Revisa tu correo para el nuevo enlace de recuperación",
      });
      navigate('/forgot-password');
    }
  };

  // Show loading state while initializing
  if (initializing) {
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
              {success ? '¡Contraseña Actualizada!' : tokenError ? 'Enlace Inválido' : 'Nueva Contraseña'}
            </CardTitle>
            <CardDescription>
              {success
                ? 'Tu contraseña ha sido actualizada exitosamente'
                : tokenError
                ? 'El enlace de recuperación ha expirado o es inválido'
                : 'Ingresa tu nueva contraseña'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {success ? (
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
            ) : tokenError ? (
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
                  El enlace de recuperación puede haber expirado. Solicita uno nuevo.
                </p>
                <Button 
                  onClick={handleResendReset} 
                  className="w-full h-11"
                  disabled={resendLoading}
                >
                  {resendLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    'Solicitar nuevo enlace'
                  )}
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
