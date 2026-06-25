import AppLayout from '@/components/layout/AppLayout';
import { ScanLine } from 'lucide-react';
import ProbarPistolaPanel from '@/components/scanner/ProbarPistolaPanel';

export default function ProbarPistola() {
  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="h-11 w-11 rounded-xl bg-violet-600/10 flex items-center justify-center flex-shrink-0">
            <ScanLine className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#1d1d1f', letterSpacing: '-0.6px' }}>Probar pistola</h1>
            <p className="text-sm text-muted-foreground">Validá que la pistola lee y escribe en la app, sin imprimir nada.</p>
          </div>
        </div>
        <ProbarPistolaPanel />
      </div>
    </AppLayout>
  );
}
