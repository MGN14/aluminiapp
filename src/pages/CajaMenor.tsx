import { Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Banknote, Info } from 'lucide-react';
import { useModuleContext } from '@/hooks/useModuleContext';

export default function CajaMenor() {
  const { isGerencial } = useModuleContext();

  // Caja Menor vive en Modo DIAN. Si esta en Gerencial, redirect.
  if (isGerencial) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Banknote className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Caja Menor</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Egresos en efectivo del negocio: gastos sin documento y cuentas de cobro de proveedores.
            </p>
          </div>
        </div>

        <Card className="border-blue-200 bg-blue-50/40 dark:bg-blue-950/10">
          <CardContent className="p-4 flex gap-3">
            <Info className="h-4 w-4 text-blue-700 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-900 dark:text-blue-100 leading-relaxed space-y-1.5">
              <p>
                <strong>Caja Menor</strong> es el módulo de gastos en efectivo y cuentas de cobro
                del Modo DIAN. La deducibilidad fiscal se calcula automáticamente según la categoría
                del gasto.
              </p>
              <p>
                Cada caso fiscal es distinto — consultá con tu contador para tu situación específica.
                AluminIA no asesora en materia fiscal.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-12 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
              <Banknote className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground max-w-md">
              Próximamente vas a poder registrar gastos en efectivo, cuentas de cobro de
              proveedores con NIT, y ver tu total de gastos deducibles del período.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
