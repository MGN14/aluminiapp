// Telemetría interna AluminIA — helper para registrar eventos de uso de la app.
//
// Cada llamada invoca la edge function `notify-founder` que persiste el evento
// en `app_events` y, si es crítico (signup, payment_*, subscription_*), manda
// email inmediato al founder. El resto se agrega para el reporte semanal.
//
// USO:
//   import { logEvent } from '@/lib/analytics';
//   logEvent('extracto_uploaded', { bank: 'Bancolombia', tx_count: 142 });
//
// Importante:
//   - Es fire-and-forget. NUNCA bloquea ni rompe la UI si falla.
//   - No registres datos sensibles en `props` (saldos, NITs, números de cuenta).
//   - Para eventos pre-auth (ej. signup), pasá user_id/email/name explícitamente.

import { supabase } from '@/integrations/supabase/client';

export type AppEventType =
  // Lifecycle
  | 'signup'
  | 'login'
  | 'onboarding_completed'
  // Activación
  | 'extracto_uploaded'
  | 'siigo_connected'
  | 'dian_connected'
  | 'invoice_uploaded'
  | 'first_value_action'
  // Uso de Nico IA
  | 'nico_query'
  // Billing
  | 'payment_success'
  | 'payment_failed'
  | 'subscription_canceled'
  | 'subscription_expired'
  // Errores en flujos críticos del usuario
  | 'flow_error';

export interface LogEventOptions {
  user_id?: string | null;
  user_email?: string | null;
  user_name?: string | null;
  props?: Record<string, unknown>;
}

export function logEvent(event_type: AppEventType, options: LogEventOptions = {}): void {
  // Fire-and-forget. No await, no throw — la telemetría jamás bloquea la app.
  try {
    supabase.functions
      .invoke('notify-founder', {
        body: {
          event_type,
          user_id: options.user_id ?? null,
          user_email: options.user_email ?? null,
          user_name: options.user_name ?? null,
          props: options.props ?? {},
        },
      })
      .catch((err) => {
        // No console.error en prod — telemetry no debe ensuciar logs del cliente.
        if (import.meta.env.DEV) console.warn('[analytics] logEvent failed:', err);
      });
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[analytics] logEvent threw:', err);
  }
}
