import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useDIANConnection } from '@/hooks/useDIANConnection';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  ShieldCheck,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { logEvent } from '@/lib/analytics';

const DOC_TYPES = [
  { value: 'CC', label: 'Cédula de ciudadanía' },
  { value: 'CE', label: 'Cédula de extranjería' },
  { value: 'TI', label: 'Tarjeta de identidad' },
  { value: 'PA', label: 'Pasaporte' },
  { value: 'NIT', label: 'NIT (persona jurídica)' },
];

export default function DIANConnectionCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: creds, isLoading } = useDIANConnection();

  const [nit, setNit] = useState('');
  const [rlDocType, setRlDocType] = useState('CC');
  const [rlDocNumber, setRlDocNumber] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);

  const [connecting, setConnecting] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (creds) {
      setNit(creds.nit);
      setRlDocType(creds.rl_doc_type);
      setRlDocNumber(creds.rl_doc_number);
      setConsent(true);
    }
  }, [creds]);

  const isConnected = creds?.connection_status === 'connected';
  const isErrored = creds?.connection_status === 'error';
  const isPending = creds?.connection_status === 'pending';

  const connect = async () => {
    if (!nit || !rlDocNumber || !password) {
      toast({
        title: 'Faltan datos',
        description: 'NIT, número de documento y contraseña son obligatorios.',
        variant: 'destructive',
      });
      return;
    }
    if (!consent) {
      toast({
        title: 'Falta consentimiento',
        description: 'Debes autorizar a AluminIA a consultar la DIAN en tu nombre.',
        variant: 'destructive',
      });
      return;
    }

    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('dian-connect', {
        body: {
          nit,
          rl_doc_type: rlDocType,
          rl_doc_number: rlDocNumber,
          password,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No se pudo guardar la conexión');

      setPassword('');
      qc.invalidateQueries({ queryKey: ['dian-connection', user?.id] });
      logEvent('dian_connected', {
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        props: { source: 'visita_dian' },
      });
      toast({
        title: 'Credenciales guardadas',
        description: 'Ya podés correr la primera verificación contra DIAN.',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Verificá los datos.';
      logEvent('flow_error', {
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        props: { flow: 'dian-connect', error: msg.slice(0, 200) },
      });
      toast({
        title: 'No se pudo conectar',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setConnecting(false);
    }
  };

  const verifyRut = async () => {
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('dian-verify-rut', {
        body: {},
      });
      if (error) throw error;

      qc.invalidateQueries({ queryKey: ['dian-connection', user?.id] });
      qc.invalidateQueries({ queryKey: ['dian-verifications', user?.id] });

      const headline = data?.summary?.headline ?? (data?.ok ? 'Verificación completa' : 'Verificación con error');
      const details = data?.summary?.details ?? '';
      toast({
        title: headline,
        description: details.slice(0, 200),
        variant: data?.ok ? 'default' : 'destructive',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Intentá de nuevo en unos minutos.';
      toast({
        title: 'Error al verificar',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setVerifying(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('¿Desconectar de DIAN? Las verificaciones previas se mantienen.')) return;
    const { error } = await (
      supabase as unknown as {
        from: (t: string) => {
          delete: () => { eq: (col: string, v: string) => Promise<{ error: unknown }> };
        };
      }
    )
      .from('user_dian_credentials')
      .delete()
      .eq('user_id', user!.id);
    if (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast({ title: 'Error', description: msg, variant: 'destructive' });
      return;
    }
    setNit('');
    setRlDocNumber('');
    setPassword('');
    setConsent(false);
    qc.invalidateQueries({ queryKey: ['dian-connection', user?.id] });
    toast({ title: 'Desconectado de DIAN' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          Verificación contra DIAN
          {isConnected && (
            <Badge variant="default" className="ml-2 gap-1">
              <CheckCircle2 className="h-3 w-3" /> Conectado
            </Badge>
          )}
          {isErrored && (
            <Badge variant="destructive" className="ml-2 gap-1">
              <AlertCircle className="h-3 w-3" /> Error
            </Badge>
          )}
          {isPending && (
            <Badge variant="secondary" className="ml-2 gap-1">
              <Lock className="h-3 w-3" /> Listo para verificar
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Consultamos MUISCA en tu nombre para confirmar que lo que tu contador
          declaró efectivamente está registrado en la DIAN.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="dian-nit">NIT del contribuyente (sin DV)</Label>
                <Input
                  id="dian-nit"
                  value={nit}
                  onChange={(e) => setNit(e.target.value.replace(/\D/g, ''))}
                  placeholder="900123456"
                  inputMode="numeric"
                  autoComplete="off"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Solo números, sin el último dígito (DV).
                </p>
              </div>
              <div>
                <Label htmlFor="dian-doc-type">Tipo de documento del RL</Label>
                <Select value={rlDocType} onValueChange={setRlDocType}>
                  <SelectTrigger id="dian-doc-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="dian-doc-number">Número de documento del RL</Label>
                <Input
                  id="dian-doc-number"
                  value={rlDocNumber}
                  onChange={(e) => setRlDocNumber(e.target.value.replace(/\D/g, ''))}
                  placeholder="1020304050"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="dian-password">
                  Contraseña MUISCA {isConnected && '(opcional, solo si la rotás)'}
                </Label>
                <Input
                  id="dian-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="flex items-start gap-2 pt-1">
              <Checkbox
                id="dian-consent"
                checked={consent}
                onCheckedChange={(v) => setConsent(v === true)}
              />
              <Label
                htmlFor="dian-consent"
                className="text-xs leading-relaxed text-muted-foreground"
              >
                Autorizo a AluminIA a usar estas credenciales únicamente para
                consultar información en MUISCA en mi nombre. Las credenciales se
                cifran en reposo y se borran al desconectar.
              </Label>
            </div>

            {creds?.last_error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {creds.last_error}
                </AlertDescription>
              </Alert>
            )}

            {creds?.last_verification_at && (
              <p className="text-xs text-muted-foreground">
                Última verificación: {new Date(creds.last_verification_at).toLocaleString('es-CO')}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={connect} disabled={connecting || !password}>
                {connecting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Lock className="h-4 w-4 mr-2" />
                )}
                {creds ? 'Actualizar credenciales' : 'Conectar con DIAN'}
              </Button>

              {creds && (
                <Button variant="secondary" onClick={verifyRut} disabled={verifying}>
                  {verifying ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Verificar RUT ahora
                </Button>
              )}

              {creds && (
                <Button variant="ghost" onClick={disconnect}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Desconectar
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
