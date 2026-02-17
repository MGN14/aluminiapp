import { TrendingUp } from 'lucide-react';

const pygLines = [
  { label: 'Ingresos', value: '+$18.4M', color: 'text-success', bg: 'bg-success/10' },
  { label: 'Costos operacionales', value: '-$7.2M', color: 'text-destructive', bg: 'bg-destructive/10' },
  { label: 'Utilidad bruta', value: '$11.2M', color: 'text-foreground', bg: 'bg-muted', bold: true },
  { label: 'Gastos operativos', value: '-$3.8M', color: 'text-destructive', bg: 'bg-destructive/10' },
  { label: 'EBITDA', value: '$7.4M', color: 'text-foreground', bg: 'bg-muted', bold: true },
  { label: 'Impuestos estimados', value: '-$1.2M', color: 'text-warning', bg: 'bg-warning/10' },
  { label: 'Utilidad neta', value: '$6.2M', color: 'text-success', bg: 'bg-success/10', bold: true },
];

export default function PYGSection() {
  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Left: PyG visual */}
            <div className="bg-card border border-border rounded-2xl shadow-lg p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-lg bg-success flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-white" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">Estado de Resultados</div>
                  <div className="text-xs text-muted-foreground">Febrero 2025 · Actualizado ahora</div>
                </div>
              </div>

              <div className="space-y-2">
                {pygLines.map((line, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between px-4 py-2.5 rounded-lg ${line.bg}`}
                  >
                    <span className={`text-sm ${line.bold ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                      {line.label}
                    </span>
                    <span className={`text-sm font-semibold ${line.color}`}>{line.value}</span>
                  </div>
                ))}
              </div>

              <div className="mt-5 pt-4 border-t border-border text-center text-xs text-muted-foreground">
                Datos generados automáticamente desde tus extractos
              </div>
            </div>

            {/* Right: copy */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-success/10 text-success text-xs font-semibold uppercase tracking-wider mb-6">
                <TrendingUp className="w-3.5 h-3.5" />
                PyG Inteligente
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4 leading-tight">
                Visualiza tu flujo de dinero en tiempo real
              </h2>
              <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
                Tu Estado de Resultados (PyG aproximado) se construye automáticamente a partir de
                tus extractos bancarios.
              </p>

              <div className="bg-muted/60 rounded-xl p-5 border border-border">
                <p className="text-foreground font-semibold text-lg">
                  Sin Excel. Sin fórmulas. Sin errores manuales.
                </p>
                <p className="text-muted-foreground text-sm mt-2">
                  Solo sube tu extracto y AluminIA hace el resto.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
