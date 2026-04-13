import { useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { Rocket } from 'lucide-react';

const MODULE_TITLES: Record<string, string> = {
  'movimientos-efectivo': 'Movimientos en Efectivo',
  'remisiones': 'Remisiones',
  'inventario-real': 'Inventario Real',
  'pyg-real': 'PYG Real',
};

export default function ComingSoon() {
  const [params] = useSearchParams();
  const mod = params.get('mod') || '';
  const title = MODULE_TITLES[mod] || 'Módulo';

  return (
    <AppLayout>
      <div className="flex flex-col items-center justify-center py-24 text-center gap-6 animate-in fade-in duration-500">
        <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center">
          <Rocket className="w-8 h-8 text-accent" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <p className="text-muted-foreground max-w-md leading-relaxed">
          Este módulo hará parte del <span className="font-semibold text-accent">Módulo Gerencial</span> de AluminIA.
          <br />
          Muy pronto podrás gestionar la realidad completa de tu negocio desde aquí.
        </p>
        <div className="px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-medium">
          Próximamente
        </div>
      </div>
    </AppLayout>
  );
}
