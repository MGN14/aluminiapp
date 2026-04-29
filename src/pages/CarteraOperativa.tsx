import { Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Wallet, Info } from 'lucide-react';
import { useModuleContext } from '@/hooks/useModuleContext';

export default function CarteraOperativa() {
  const { isGerencial } = useModuleContext();

  if (!isGerencial) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cartera Operativa</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Lo que realmente te deben tus clientes y cómo te están pagando.
            </p>
          </div>
        </div>

        <Card className="border-amber-200 bg-amber-50/40 dark:bg-amber-950/10">
          <CardContent className="p-4 flex gap-3">
            <Info className="h-4 w-4 text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 dark:text-amber-100 leading-relaxed space-y-1.5">
              <p>
                <strong>Cartera Operativa</strong> registra movimientos de tu negocio que no
                necesariamente están vinculados a facturación electrónica DIAN. Es una herramienta
                interna de gestión.
              </p>
              <p>
                Cada usuario es responsable del cumplimiento de sus obligaciones tributarias.
                Te recomendamos consultar con tu contador. AluminIA no asesora en materia fiscal.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-12 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
              <Wallet className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground max-w-md">
              Próximamente vas a poder registrar deudas operativas, ver el saldo por cliente y
              asignar pagos desde conciliación bancaria y movimientos en efectivo.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
