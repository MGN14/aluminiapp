import { CheckCircle, ShieldCheck } from 'lucide-react';

const benefits = [
  'Estimación mensual de impuestos',
  'Proyección anual de obligaciones',
  'Identificación de gastos deducibles',
  'Mayor claridad para tu contador',
];

export default function DIANSection() {
  return (
    <section className="py-24 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-card border border-border rounded-2xl shadow-lg overflow-hidden">
            <div className="grid md:grid-cols-2">
              {/* Left: dark accent panel */}
              <div className="bg-foreground text-background p-10 flex flex-col justify-center">
                <div className="w-12 h-12 rounded-xl bg-success flex items-center justify-center mb-6">
                  <ShieldCheck className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-2xl md:text-3xl font-bold mb-4 leading-tight">
                  Evita sanciones. Prepárate para la DIAN.
                </h2>
                <p className="text-background/70 text-base leading-relaxed">
                  Conoce tu utilidad real y estima tus impuestos antes de que sea tarde. La información
                  está ahí — AluminIA la hace visible.
                </p>
              </div>

              {/* Right: benefits */}
              <div className="p-10 flex flex-col justify-center">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-6">
                  Qué obtienes
                </p>
                <div className="space-y-4">
                  {benefits.map((b) => (
                    <div key={b} className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
                      <span className="text-foreground font-medium">{b}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-6 leading-relaxed">
                  * Las estimaciones son orientativas y no reemplazan asesoría contable profesional.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
