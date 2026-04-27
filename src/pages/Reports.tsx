import AppLayout from '@/components/layout/AppLayout';
import PYGReport from '@/components/reports/PYGReport';
import AdvancesReport from '@/components/reports/AdvancesReport';
import AccountsReceivableReport from '@/components/reports/AccountsReceivableReport';
import AccountsPayableReport from '@/components/reports/AccountsPayableReport';
import CashFlowReport from '@/components/reports/CashFlowReport';
import PaymentsLogReport from '@/components/reports/PaymentsLogReport';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import { Lock, Loader2, Crown, TrendingUp, ArrowDownUp, HandCoins, ReceiptText, Wallet, ListChecks } from 'lucide-react';

type ReportTab = 'pyg' | 'anticipos' | 'cxc' | 'cxp' | 'caja' | 'pagos';

const BRAND = 'oklch(0.43 0.14 155)';
const INK = '#1d1d1f';
const INK2 = '#6e6e73';
const INK3 = '#a1a1a6';

const TABS: Record<ReportTab, {
  title: string;
  hint: string;
  icon: typeof TrendingUp;
  color: string;
  bg: string;
  border: string;
}> = {
  pyg: {
    title: 'Estado de resultados',
    hint: 'Cómo le va a tu negocio este año.',
    icon: TrendingUp,
    color: 'oklch(0.43 0.14 155)',
    bg: 'linear-gradient(135deg, oklch(0.43 0.14 155 / 0.18), oklch(0.55 0.12 165 / 0.06))',
    border: '1px solid oklch(0.43 0.14 155 / 0.22)',
  },
  anticipos: {
    title: 'Anticipos',
    hint: 'Plata que entró antes de que emitieras la factura.',
    icon: ArrowDownUp,
    color: 'oklch(0.55 0.17 70)',
    bg: 'linear-gradient(135deg, oklch(0.70 0.17 70 / 0.18), oklch(0.75 0.14 60 / 0.06))',
    border: '1px solid oklch(0.70 0.17 70 / 0.22)',
  },
  cxc: {
    title: 'Lo que me deben',
    hint: 'Facturas de venta con saldo pendiente de pago.',
    icon: HandCoins,
    color: 'oklch(0.52 0.18 25)',
    bg: 'linear-gradient(135deg, oklch(0.62 0.20 15 / 0.16), oklch(0.68 0.17 25 / 0.06))',
    border: '1px solid oklch(0.62 0.20 15 / 0.22)',
  },
  cxp: {
    title: 'Lo que debo',
    hint: 'Facturas de compra por pagar a proveedores.',
    icon: ReceiptText,
    color: 'oklch(0.55 0.15 240)',
    bg: 'linear-gradient(135deg, oklch(0.55 0.15 240 / 0.18), oklch(0.65 0.12 220 / 0.06))',
    border: '1px solid oklch(0.55 0.15 240 / 0.22)',
  },
  caja: {
    title: 'Flujo de caja',
    hint: 'Cuánta plata entra, sale y queda en caja mes a mes.',
    icon: Wallet,
    color: 'oklch(0.55 0.16 150)',
    bg: 'linear-gradient(135deg, oklch(0.55 0.16 150 / 0.18), oklch(0.65 0.13 160 / 0.06))',
    border: '1px solid oklch(0.55 0.16 150 / 0.22)',
  },
  pagos: {
    title: 'Relación de pagos',
    hint: 'Historial completo de movimientos: ingresos y egresos exportables.',
    icon: ListChecks,
    color: 'oklch(0.50 0.14 290)',
    bg: 'linear-gradient(135deg, oklch(0.55 0.16 290 / 0.18), oklch(0.65 0.12 280 / 0.06))',
    border: '1px solid oklch(0.55 0.16 290 / 0.22)',
  },
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <Loader2 style={{ width: 28, height: 28, color: INK3 }} className="animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (!hasAccess) {
    return (
      <AppLayout>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            textAlign: 'center',
            padding: '0 24px',
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 99,
              background: 'oklch(0.70 0.17 70 / 0.10)',
              border: '1px solid oklch(0.70 0.17 70 / 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
              animation: 'popIn 0.5s cubic-bezier(0.16,1,0.3,1)',
            }}
          >
            <Lock style={{ width: 30, height: 30, color: 'oklch(0.55 0.17 70)' }} />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, margin: 0, letterSpacing: '-0.8px' }}>
            Reportes avanzados
          </h1>
          <p style={{ fontSize: 14, color: INK2, maxWidth: 400, margin: '10px 0 22px', lineHeight: 1.5 }}>
            Los reportes avanzados están en el plan Empresarial. Desbloquealos para ver P&G, anticipos, CxC y CxP.
          </p>
          <button
            onClick={() => navigate('/pricing')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 22px',
              height: 44,
              border: 'none',
              borderRadius: 10,
              background: BRAND,
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 14px oklch(0.43 0.14 155 / 0.25)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 8px 20px oklch(0.43 0.14 155 / 0.35)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 14px oklch(0.43 0.14 155 / 0.25)';
            }}
          >
            <Crown style={{ width: 16, height: 16 }} />
            Activar Empresarial
          </button>
        </div>
      </AppLayout>
    );
  }

  const meta = TABS[tab];
  const Icon = meta.icon;

  return (
    <AppLayout>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: meta.bg,
              border: meta.border,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon style={{ width: 22, height: 22, color: meta.color }} />
          </div>
          <div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: INK,
                margin: 0,
                letterSpacing: '-0.8px',
                lineHeight: 1.1,
              }}
            >
              {meta.title}
            </h1>
            <p style={{ fontSize: 13, color: INK2, margin: '4px 0 0 0' }}>{meta.hint}</p>
          </div>
        </div>
        {tab === 'pyg' && <PYGReport />}
        {tab === 'anticipos' && <AdvancesReport />}
        {tab === 'cxc' && <AccountsReceivableReport />}
        {tab === 'cxp' && <AccountsPayableReport />}
        {tab === 'caja' && <CashFlowReport />}
        {tab === 'pagos' && <PaymentsLogReport />}
      </div>
    </AppLayout>
  );
}
