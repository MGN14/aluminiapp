import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Plug, RefreshCw, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import { logEvent } from '@/lib/analytics';

type SiigoCreds = {
  siigo_username: string;
  partner_id: string;
  connection_status: 'pending' | 'connected' | 'error' | 'revoked';
  last_error: string | null;
  last_sync_at: string | null;
  last_invoice_pulled_at: string | null;
};

export default function SiigoConnectionCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [username, setUsername] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [partnerId, setPartnerId] = useState('aluminiapp');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const { data: creds, isLoading } = useQuery({
    queryKey: ['siigo-creds', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('user_siigo_credentials')
        .select(
          'siigo_username, partner_id, connection_status, last_error, last_sync_at, last_invoice_pulled_at',
        )
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as SiigoCreds | null;
    },
  });

  useEffect(() => {
    if (creds) {
      setUsername(creds.siigo_username);
      setPartnerId(creds.partner_id || 'aluminiapp');
    }
  }, [creds]);

  const connect = async () => {
    if (!username || !accessKey) {
      toast({
        title: 'Faltan datos',
        description: 'Usuario y access key son obligatorios.',
        variant: 'destructive',
      });
      return;
    }
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('siigo-connect', {
        body: { username, access_key: accessKey, partner_id: partnerId || 'aluminiapp' },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Conexión rechazada por Siigo');

      setAccessKey('');
      qc.invalidateQueries({ queryKey: ['siigo-creds', user?.id] });
      logEvent('siigo_connected', {
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        props: { source: 'settings', partner_id: partnerId || 'aluminiapp' },
      });
      toast({ title: 'Conectado a Siigo', description: 'Ya puedes sincronizar facturas.' });
    } catch (e: any) {
      logEvent('flow_error', {
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        props: { flow: 'siigo-connect', error: String(e?.message ?? e).slice(0, 200) },
      });
      toast({
        title: 'No se pudo conectar',
        description: e.message ?? 'Verifica usuario y access key.',
        variant: 'destructive',
      });
    } finally {
      setConnecting(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('siigo-sync-invoices', {
        body: {},
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Sincronización falló');

      qc.invalidateQueries({ queryKey: ['siigo-creds', user?.id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      // Surface honesto por tipo: los errores/vacíos de COMPRA eran invisibles
      // (solo se mostraba synced) y parecía bug de la app. Si Siigo reporta 0
      // compras, el problema es de origen: las FC no están causadas en Siigo.
      const compraTotal = (data.debug as Record<string, { total_results?: number | null }> | undefined)
        ?.compra_page1?.total_results;
      const errCount = (data.errors as string[] | undefined)?.length ?? 0;
      const detalles = [
        `${data.synced ?? 0} facturas procesadas${data.skipped ? `, ${data.skipped} omitidas` : ''}.`,
        compraTotal === 0
          ? 'Siigo reportó 0 facturas de COMPRA: para importarlas deben estar causadas como FC en Siigo (buzón de documentos DIAN → causar compra).'
          : null,
        errCount > 0 ? `${errCount} error${errCount > 1 ? 'es' : ''} durante el sync.` : null,
      ].filter(Boolean).join(' ');
      toast({
        title: 'Siigo sincronizado',
        description: detalles,
        ...(compraTotal === 0 || errCount > 0 ? { duration: 12000 } : {}),
      });
    } catch (e: any) {
      toast({
        title: 'Error sincronizando',
        description: e.message ?? 'Intenta de nuevo en unos minutos.',
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('¿Desconectar Siigo? Las facturas ya importadas se mantienen.')) return;
    const { error } = await (supabase as any)
      .from('user_siigo_credentials')
      .delete()
      .eq('user_id', user!.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    setUsername('');
    setAccessKey('');
    qc.invalidateQueries({ queryKey: ['siigo-creds', user?.id] });
    toast({ title: 'Desconectado de Siigo' });
  };

  const isConnected = creds?.connection_status === 'connected';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Plug className="h-5 w-5 text-muted-foreground" />
          Conexión con Siigo
          {isConnected ? (
            <Badge variant="default" className="ml-2 gap-1">
              <CheckCircle2 className="h-3 w-3" /> Conectado
            </Badge>
          ) : creds?.connection_status === 'error' ? (
            <Badge variant="destructive" className="ml-2 gap-1">
              <AlertCircle className="h-3 w-3" /> Error
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Importa facturas de venta y compra automáticamente desde tu cuenta Siigo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="siigo-username">Usuario API Siigo</Label>
                <Input
                  id="siigo-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="USUARIO@empresa.com"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Cópialo tal cual aparece en Siigo → Credenciales API → "Usuario API". Respeta mayúsculas y minúsculas.
                </p>
              </div>
              <div>
                <Label htmlFor="siigo-access-key">
                  Access key {isConnected && '(opcional, solo si rotas)'}
                </Label>
                <Input
                  id="siigo-access-key"
                  type="password"
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                  placeholder="••••••••••••••••"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="siigo-partner">Partner ID</Label>
                <Input
                  id="siigo-partner"
                  value={partnerId}
                  onChange={(e) => setPartnerId(e.target.value)}
                  placeholder="aluminiapp"
                />
              </div>
            </div>

            {creds?.last_error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">{creds.last_error}</AlertDescription>
              </Alert>
            )}

            {creds?.last_sync_at && (
              <p className="text-xs text-muted-foreground">
                Última sincronización: {new Date(creds.last_sync_at).toLocaleString('es-CO')}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={connect} disabled={connecting || !accessKey}>
                {connecting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plug className="h-4 w-4 mr-2" />
                )}
                {isConnected ? 'Actualizar credenciales' : 'Conectar'}
              </Button>

              {isConnected && (
                <Button variant="secondary" onClick={sync} disabled={syncing}>
                  {syncing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Traer facturas de Siigo
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
