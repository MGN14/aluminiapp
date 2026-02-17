import { CheckCircle, Clock, TrendingUp, BarChart3, Database } from 'lucide-react';

const benefits = [
  { icon: Clock, title: 'Ahorra horas de trabajo manual', desc: 'No más copiar y pegar. Todo automatizado.' },
  { icon: CheckCircle, title: 'Reduce errores humanos', desc: 'Extracción precisa directamente del PDF.' },
  { icon: Database, title: 'Control total de tu flujo de caja', desc: 'Visualiza ingresos y egresos en tiempo real.' },
  { icon: BarChart3, title: 'Decisiones basadas en datos reales', desc: 'Métricas accionables, no solo números.' },
];

export default function ForEntrepreneursSection() {
  return (
    <section className="py-24 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Diseñado para empresarios que valoran su tiempo
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              AluminIA trabaja mientras tú te enfocas en hacer crecer tu negocio.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            {benefits.map((b, i) => (
              <div
                key={i}
                className="bg-card rounded-xl p-7 border border-border hover:border-success/40 hover:shadow-sm transition-all flex gap-5 items-start"
              >
                <div className="w-11 h-11 rounded-lg bg-success/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <b.icon className="w-5 h-5 text-success" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground mb-1">{b.title}</h4>
                  <p className="text-muted-foreground text-sm">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
