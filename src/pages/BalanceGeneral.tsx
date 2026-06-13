import AppLayout from '@/components/layout/AppLayout';
import BalanceSheetReport from '@/components/reports/BalanceSheetReport';

export default function BalanceGeneral() {
  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <BalanceSheetReport />
      </div>
    </AppLayout>
  );
}
