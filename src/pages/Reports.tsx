import AppLayout from '@/components/layout/AppLayout';
import PYGReport from '@/components/reports/PYGReport';
import AdvancesReport from '@/components/reports/AdvancesReport';
import AccountsReceivableReport from '@/components/reports/AccountsReceivableReport';
import AccountsPayableReport from '@/components/reports/AccountsPayableReport';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Lock, Loader2, Crown } from 'lucide-react';

type ReportTab = 'pyg' | 'anticipos' | 'cxc' | 'cxp';

const REPORT_TITLES: Record<ReportTab, string> = {
  pyg: 'Estado de Resultados',
  anticipos: 'Anticipos',
  cxc: 'Cuentas por Cobrar',
  cxp: 'Cuentas por Pagar',
};

interface Props {
  tab?: ReportTab;
}

export default function Reports({ tab = 'pyg' }: Props) {
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
        <h1 className="text-2xl font-bold text-foreground">{REPORT_TITLES[tab]}</h1>
        {tab === 'pyg' && <PYGReport />}
        {tab === 'anticipos' && <AdvancesReport />}
        {tab === 'cxc' && <AccountsReceivableReport />}
        {tab === 'cxp' && <AccountsPayableReport />}
      </div>
    </AppLayout>
  );
}
