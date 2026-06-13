import AppLayout from '@/components/layout/AppLayout';
import BudgetReport from '@/components/reports/BudgetReport';

export default function Presupuesto() {
  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <BudgetReport />
      </div>
    </AppLayout>
  );
}
