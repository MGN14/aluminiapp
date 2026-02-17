import { Upload, LayoutDashboard, BarChart3 } from 'lucide-react';

const steps = [
  {
    icon: Upload,
    number: '01',
    title: 'Subes tu extracto bancario',
    description: 'Carga el PDF de tu banco. Compatible con la mayoría de bancos en Colombia.',
  },
  {
    icon: LayoutDashboard,
    number: '02',
    title: 'La app organiza y categoriza',
    description: 'AluminIA extrae, clasifica y organiza cada movimiento automáticamente.',
  },
  {
    icon: BarChart3,
    number: '03',
    title: 'Obtienes reportes e inteligencia',
    description: 'Accede a tu PyG, métricas clave y pregúntale a Nico lo que necesites.',
  },
];

export default function HowItWorksSection() {
  return (
    <section id="como-funciona" className="py-24 bg-background">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Cómo funciona
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Empieza en minutos. Sin configuraciones complejas.
          </p>
        </div>

        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-8">
          {steps.map((step, i) => (
            <div key={i} className="relative group">
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-7 left-[calc(50%+3rem)] right-0 h-px bg-border z-0" />
              )}

              <div className="bg-card rounded-2xl p-8 border border-border hover:border-success/50 hover:shadow-md transition-all relative z-10">
                {/* Number */}
                <div className="text-5xl font-black text-muted/30 leading-none mb-4 select-none">
                  {step.number}
                </div>
                {/* Icon */}
                <div className="w-12 h-12 rounded-xl bg-success flex items-center justify-center mb-5">
                  <step.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
