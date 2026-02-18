import { CheckCircle } from 'lucide-react';
import nicoAvatar from '@/assets/nico-avatar.png';

const chatMessages = [
  { role: 'user', text: '¿Cómo cambiaron mis gastos este año?' },
  { role: 'nico', text: '1️⃣ Tus gastos acumulados este año son $38.4M, un 18% más que el mismo período del año anterior.\n2️⃣ El mayor incremento fue en proveedores (+31%).\n3️⃣ La concentración en 3 proveedores representa el 62% del total.\n4️⃣ Considera renegociar condiciones con tus proveedores principales.' },
  { role: 'user', text: '¿Cuánto debo provisionar para impuestos?' },
  { role: 'nico', text: '1️⃣ Tu utilidad neta estimada este mes es $4.8M.\n2️⃣ Deberías provisionar aprox. $1.68M (35%) para renta e impuestos.\n3️⃣ Esto es 12% más que el mes anterior por el aumento en ingresos.\n4️⃣ Separa este valor esta semana antes de comprometer el flujo.' },
];

const benefits = [
  'Respuestas con tus números reales',
  'Comparación automática con períodos anteriores',
  'Detección de anomalías y picos',
  'Recomendaciones ejecutivas concretas',
];

const exampleQuestions = [
  '¿Cuál fue mi proveedor más costoso?',
  '¿Estoy creciendo frente al año pasado?',
  '¿Cuánto debo provisionar para impuestos?',
  '¿Cuál es mi utilidad neta del mes?',
];

export default function NicoCoachSection() {
  return (
    <section className="py-24 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Left: copy */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-success/10 text-success text-xs font-semibold uppercase tracking-wider mb-6">
                <img src={nicoAvatar} alt="Nico" className="w-4 h-4 rounded-full object-cover object-top" />
                Nico · IA Financiera
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4 leading-tight">
                Pregúntale a Nico cualquier cosa sobre tu negocio
              </h2>
              <p className="text-muted-foreground text-lg mb-6 leading-relaxed">
                Nico analiza tus ingresos, gastos y tendencias para darte respuestas claras,
                estratégicas y accionables.
              </p>

              <div className="space-y-2 mb-8">
                {benefits.map((b) => (
                  <div key={b} className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-success flex-shrink-0" />
                    <span className="text-foreground font-medium">{b}</span>
                  </div>
                ))}
              </div>

              <div className="bg-card rounded-xl border border-border p-4">
                <p className="text-xs text-muted-foreground font-medium mb-3 uppercase tracking-wider">Ejemplos de preguntas</p>
                <div className="space-y-2">
                  {exampleQuestions.map((q) => (
                    <div key={q} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="text-success">›</span>
                      {q}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: simulated chat */}
            <div className="bg-card border border-border rounded-2xl shadow-lg overflow-hidden">
              {/* Chat header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-card">
                <div className="w-8 h-8 rounded-full overflow-hidden border border-border bg-muted">
                  <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">Nico</div>
                  <div className="text-xs text-success flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                    Activo · Analizando tus datos
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="p-5 space-y-4 max-h-80 overflow-y-auto bg-muted/10">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'nico' && (
                      <div className="w-6 h-6 rounded-full overflow-hidden border border-border bg-muted mr-2 flex-shrink-0 mt-0.5">
                        <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
                      </div>
                    )}
                    <div
                      className={`max-w-[82%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-line ${
                        msg.role === 'user'
                          ? 'bg-success text-white rounded-br-sm'
                          : 'bg-card text-foreground border border-border rounded-bl-sm'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>

              {/* Input placeholder */}
              <div className="px-5 py-4 border-t border-border bg-card">
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-muted text-muted-foreground text-sm">
                  <span>Pregúntale a Nico...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

