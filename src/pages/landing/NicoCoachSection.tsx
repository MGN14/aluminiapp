import { CheckCircle, MessageSquare } from 'lucide-react';

const chatMessages = [
  { role: 'user', text: '¿Cuánto gasté este mes?' },
  { role: 'nico', text: 'Este mes tus gastos totales fueron $4.2M. Los más altos fueron en proveedores (42%) y nómina (31%).' },
  { role: 'user', text: '¿Cuál fue mi costo más alto?' },
  { role: 'nico', text: 'Tu mayor costo fue en Proveedor Logística S.A. con $1.1M el 12 de febrero.' },
  { role: 'user', text: '¿Estoy listo para pagar impuestos?' },
  { role: 'nico', text: 'Basado en tu utilidad estimada, deberías reservar aproximadamente $680K para renta. Te recomiendo separarlo esta semana.' },
];

const benefits = [
  'Respuestas inmediatas',
  'Análisis de tendencias',
  'Alertas financieras inteligentes',
  'Comparación mensual y anual',
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
                <MessageSquare className="w-3.5 h-3.5" />
                Nico Coach
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4 leading-tight">
                Pregúntale a tus finanzas cualquier cosa
              </h2>
              <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
                Nico Coach analiza tus ingresos, gastos y patrones financieros para darte respuestas
                claras, estratégicas y accionables.
              </p>
              <div className="space-y-3">
                {benefits.map((b) => (
                  <div key={b} className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-success flex-shrink-0" />
                    <span className="text-foreground font-medium">{b}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: simulated chat */}
            <div className="bg-card border border-border rounded-2xl shadow-lg overflow-hidden">
              {/* Chat header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-card">
                <div className="w-8 h-8 rounded-full bg-success flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-white" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">Nico Coach</div>
                  <div className="text-xs text-success">● Activo</div>
                </div>
              </div>

              {/* Messages */}
              <div className="p-5 space-y-4 max-h-96 overflow-y-auto">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-success text-white rounded-br-sm'
                          : 'bg-muted text-foreground rounded-bl-sm'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>

              {/* Input placeholder */}
              <div className="px-5 py-4 border-t border-border">
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-muted text-muted-foreground text-sm">
                  <span>Escríbele a Nico Coach...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
