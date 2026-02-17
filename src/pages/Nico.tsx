import AppLayout from '@/components/layout/AppLayout';
import NicoChat from '@/components/nico/NicoChat';
import { Bot } from 'lucide-react';

export default function NicoPage() {
  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Nico</h1>
              <p className="text-sm text-muted-foreground">Tu analista financiero inteligente</p>
            </div>
          </div>
          <p className="text-muted-foreground text-sm mt-3 max-w-lg">
            Pregúntale a Nico cualquier cosa sobre tus ingresos, gastos, proveedores o tendencias.
            Usa tus datos reales para darte respuestas ejecutivas y accionables.
          </p>
        </div>

        {/* Chat */}
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <NicoChat />
        </div>
      </div>
    </AppLayout>
  );
}
