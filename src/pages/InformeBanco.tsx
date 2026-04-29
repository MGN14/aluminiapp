import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, Info } from 'lucide-react';
import InformeBancoView from '@/components/informe-banco/InformeBancoView';

export default function InformeBanco() {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Informe para Banco</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Toda la información de tu negocio en un solo lugar para responder lo que el banco te va a preguntar.
            </p>
          </div>
        </div>

        <Card className="border-blue-200 bg-blue-50/40 dark:bg-blue-950/10">
          <CardContent className="p-4 flex gap-3">
            <Info className="h-4 w-4 text-blue-700 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-900 dark:text-blue-100 leading-relaxed">
              Este informe agrega datos reales de tu actividad: ingresos, egresos, cartera, inventario, concentración de
              clientes. Las respuestas a las preguntas del banco se calculan automáticamente con tus números. Podés
              descargarlo en PDF para enviarlo al banco o llevarlo a la reunión. AluminIA es herramienta de apoyo —
              los estados financieros formales requieren firma de contador titulado.
            </div>
          </CardContent>
        </Card>

        <InformeBancoView />
      </div>
    </AppLayout>
  );
}
