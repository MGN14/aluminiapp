import AppLayout from '@/components/layout/AppLayout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState } from 'react';
import PYGReport from '@/components/reports/PYGReport';
import AdvancesReport from '@/components/reports/AdvancesReport';
import AccountsReceivableReport from '@/components/reports/AccountsReceivableReport';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Lock, Loader2, Crown } from 'lucide-react';

const reportOptions = [
  { value: 'pyg', label: 'Estado de Resultados (PyG)' },
  { value: 'anticipos', label: 'Anticipos' },
  { value: 'cuentas_por_cobrar', label: 'Cuentas por Cobrar' },
  { value: 'cuentas_por_pagar', label: 'Cuentas por Pagar' },
];

export default function Reports() {
  const [selectedReport, setSelectedReport] = useState('pyg');
  const { plan, loading: subLoading, isAdmin, isFounder, isTrialing } = useSubscription();
  const navigate = useNavigate();

  const hasAccess = isAdmin || isFounder || isTrialing || ['empresarial', 'pro', 'admin'].includes(plan);

  if (subLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!hasAccess) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Reportes Avanzados</h1>
          <p className="text-muted-foreground max-w-md mb-6">
            Los reportes avanzados están disponibles en el Plan Empresarial.
            Genera estados de resultados y análisis financieros detallados.
          </p>
          <Button onClick={() => navigate('/pricing')} className="gap-2">
            <Crown className="h-4 w-4" />
            Activar Empresarial
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h1 className="text-2xl font-bold text-foreground">Reportes</h1>
          <div className="w-full sm:w-64">
            <Select value={selectedReport} onValueChange={setSelectedReport}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar reporte" />
              </SelectTrigger>
              <SelectContent>
                {reportOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {selectedReport === 'pyg' && <PYGReport />}
        {selectedReport === 'anticipos' && <AdvancesReport />}
        {selectedReport === 'cuentas_por_cobrar' && <AccountsReceivableReport />}
      </div>
    </AppLayout>
  );
}
