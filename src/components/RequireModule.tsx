import { useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2, ShieldOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProtectedRoute from '@/components/ProtectedRoute';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/use-toast';
import { MODULE_KEYS, type ModuleKey } from '@/hooks/useCollaborators';

interface RequireModuleProps {
  moduleKey: ModuleKey;
  children: React.ReactNode;
}

/** Ruta canónica de cada módulo — destino al redirigir un acceso denegado. */
const MODULE_ROUTE: Record<ModuleKey, string> = {
  dashboard: '/dashboard',
  extractos: '/statement-upload',
  facturas_venta: '/invoices/venta',
  facturas_compra: '/invoices/compra',
  conciliacion: '/transactions',
  caja_menor: '/caja-menor',
  inventarios: '/inventarios',
  remisiones: '/remisiones',
  cotizaciones: '/productos-terminados',
  creditos: '/creditos',
  nomina: '/nomina',
  estado_resultados: '/reportes/estado-resultados',
  balance_general: '/reportes/balance-general',
  presupuesto: '/reportes/presupuesto',
  anticipos: '/reportes/anticipos',
  cuentas_por_cobrar: '/reportes/cuentas-por-cobrar',
  cuentas_por_pagar: '/reportes/cuentas-por-pagar',
  flujo_caja: '/reportes/flujo-caja',
  relacion_pagos: '/reportes/relacion-pagos',
  informe_dian: '/financial-health',
  informe_banco: '/informe-banco',
  exportar: '/export',
  nico_ia: '/nico',
};

function ModuleGate({ moduleKey, children }: RequireModuleProps) {
  const { hasModule, loading, error, refetch } = usePermissions();
  const { toast } = useToast();
  const toastedRef = useRef(false);

  // Si el colaborador no tiene permiso, lanzamos un toast informativo una sola
  // vez antes de redirigir. Sin esto, la redirección silenciosa parece bug.
  const denied = !loading && !hasModule(moduleKey);
  useEffect(() => {
    if (denied && !toastedRef.current) {
      toastedRef.current = true;
      toast({
        title: 'Sin permiso',
        description: 'No tenés acceso a esta sección. Pedile al administrador que te lo habilite.',
        variant: 'destructive',
      });
    }
  }, [denied, toast]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (denied) {
    // Error cargando permisos ≠ permisos denegados. Si la query de
    // collaborators falló (red, timeout), hasModule devuelve false para TODO
    // — sin esta rama, un fallo transitorio brickearía la app entera con la
    // pantalla de "sin módulos" incluso para un owner. Ofrecemos reintentar.
    if (error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-sm text-center space-y-3">
            <ShieldOff className="h-10 w-10 text-muted-foreground mx-auto" />
            <h1 className="text-lg font-semibold text-foreground">No pudimos cargar tus permisos</h1>
            <p className="text-sm text-muted-foreground">
              Hubo un problema de conexión al verificar tu acceso. No es un tema de permisos —
              probá de nuevo.
            </p>
            <Button onClick={() => void refetch()} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </Button>
          </div>
        </div>
      );
    }
    // Redirigir al PRIMER módulo que el usuario SÍ tiene habilitado, en el
    // orden de MODULE_KEYS. Antes esto era un Navigate fijo a /dashboard, lo
    // que volvía el permiso 'dashboard' decorativo (y arriesgaba un loop si
    // /dashboard también está protegido).
    const fallback = MODULE_KEYS.find((m) => m.key !== moduleKey && hasModule(m.key));
    if (fallback) {
      return <Navigate to={MODULE_ROUTE[fallback.key]} replace />;
    }
    // Sin NINGÚN módulo habilitado: pantalla terminal (no hay a dónde redirigir).
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center space-y-3">
          <ShieldOff className="h-10 w-10 text-muted-foreground mx-auto" />
          <h1 className="text-lg font-semibold text-foreground">Sin módulos habilitados</h1>
          <p className="text-sm text-muted-foreground">
            Tu cuenta de colaborador no tiene acceso a ningún módulo todavía.
            Pedile al administrador que te habilite al menos uno desde la sección Colaboradores.
          </p>
          <Button variant="outline" onClick={() => void refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Volver a verificar
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function RequireModule({ moduleKey, children }: RequireModuleProps) {
  return (
    <ProtectedRoute>
      <ModuleGate moduleKey={moduleKey}>{children}</ModuleGate>
    </ProtectedRoute>
  );
}
