import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useForcePasswordChange } from '@/hooks/useForcePasswordChange';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, FileSpreadsheet, Lock, Eye, EyeOff } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import PasswordRequirements from '@/components/auth/PasswordRequirements';
import { evaluatePassword, translatePasswordError } from '@/lib/passwordPolicy';

export default function ChangePassword() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refresh, required: forcedFlow } = useForcePasswordChange();

  // Cuando el usuario viene de un magic link de invitación (colaborador
  // nuevo) o de "olvidé mi contraseña", no tiene contraseña previa que
  // recuerde — Supabase le generó una random oculta. Pedirle "contraseña
  // actual" es absurdo y bloquea el onboarding.
  //
  // Heurística: si profiles.force_password_change=true, asumimos que es
  // un flujo de seteo inicial → ocultamos el campo "Contraseña actual" y
  // saltamos el re-auth. Si está en false (caso: usuario voluntariamente
  // entró a cambiar su contraseña desde Ajustes), pedimos la actual.
  const isInitialSetup = forcedFlow;

  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // En setup inicial (invite/reset) no hace falta currentPassword.
    if ((!isInitialSetup && !currentPassword) || !password || !confirmPassword) {
      setError('Por favor completa todos los campos');
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
    if (!isInitialSetup && password === currentPassword) {
      setError('La nueva contraseña no puede ser igual a la actual');
      return;
    }

    setLoading(true);

    if (!user?.email) {
      setLoading(false);
      setError('No se pudo verificar tu sesión. Vuelve a iniciar sesión.');
      return;
    }

    // 1) Re-authenticate solo cuando el usuario tiene contraseña previa.
    //    En el flow de invite/reset el user no la sabe — Supabase ya validó
    //    la identidad por el magic link, no necesitamos prueba adicional.
    if (!isInitialSetup) {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthError) {
        setLoading(false);
        setError('La contraseña actual no es correcta.');
        return;
      }
    }

    // 2) Update password via Supabase auth.
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setLoading(false);
      setError(translatePasswordError(updateError.message));
      return;
    }

    // 3) Clear the force_password_change flag on the profile.
    if (user?.id) {
      const { error: flagError } = await supabase
        .from('profiles')
        .update({ force_password_change: false } as never)
        .eq('user_id', user.id);

      if (flagError) {
        console.error('[change-password] clear flag error', flagError);
      }
    }

    await refresh();
    setLoading(false);
    toast({
      title: 'Contraseña actualizada',
      description: 'Tu contraseña se cambió correctamente.',
    });
    navigate('/dashboard', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
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
              {isInitialSetup ? 'Definí tu contraseña' : 'Cambia tu contraseña'}
            </CardTitle>
            <CardDescription>
              {isInitialSetup
                ? 'Bienvenido. Creá tu contraseña para entrar a AluminIA.'
                : 'Por seguridad, debes definir una nueva contraseña para continuar.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {!isInitialSetup && (
                <div className="space-y-2">
                  <Label htmlFor="currentPassword">Contraseña actual</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="currentPassword"
                      type={showCurrentPassword ? 'text' : 'password'}
                      placeholder="Tu contraseña actual"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="h-11 pl-10 pr-10"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
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
                    tabIndex={-1}
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
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full h-11" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {isInitialSetup ? 'Creando...' : 'Actualizando...'}
                  </>
                ) : (
                  isInitialSetup ? 'Crear contraseña y entrar' : 'Cambiar contraseña'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
