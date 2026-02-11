import AppLayout from '@/components/layout/AppLayout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState } from 'react';
import PYGReport from '@/components/reports/PYGReport';

const reportOptions = [
  { value: 'pyg', label: 'Estado de Resultados (PyG)' },
];

export default function Reports() {
  const [selectedReport, setSelectedReport] = useState('pyg');

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
      </div>
    </AppLayout>
  );
}
