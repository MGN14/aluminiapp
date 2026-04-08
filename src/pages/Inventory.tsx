import { Package } from 'lucide-react';

export default function Inventory() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4">
      <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
        <Package className="h-8 w-8 text-muted-foreground/60" />
      </div>
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Inventarios</h1>
        <p className="text-muted-foreground text-sm max-w-md">
          Pronto podrás gestionar tu inventario de forma inteligente, integrado con tu facturación y movimientos.
        </p>
      </div>
      <span className="inline-flex items-center rounded-full border border-success/30 bg-success/5 px-4 py-1.5 text-xs font-semibold text-success tracking-wide uppercase">
        Próximamente
      </span>
    </div>
  );
}
