import type { PlanData } from './PricingCard';

// Pricing simplificado: dos cards.
//   1. Demo — trial de 14 días con TODO incluido (mismas features del plan
//      pago). Sin tarjeta. Estrategia PLG: el cliente vive el producto
//      completo antes de pagar.
//   2. Empresarial — único tier de pago, $500.000 COP/mes. El descuento
//      del 20% en pago anual lo aplica PricingCard automáticamente.
//
// Eliminado el plan "Básico" intermedio: simplifica la decisión de compra
// y baja la fricción del funnel ("un solo sí" vs "tres opciones").
export const plans: PlanData[] = [
  {
    id: 'demo',
    name: 'Demo',
    monthlyPrice: 0,
    period: '14 días gratis',
    description: 'Probá AluminIA con todas las funciones, sin tarjeta',
    features: [
      'Todas las funciones del plan Empresarial',
      'PDFs ilimitados durante el trial',
      'Conexión con Siigo y bancos',
      'Módulo de Facturas DIAN completo',
      'Inventarios y conciliación por factura',
      'Coach financiero con IA',
      'Sin tarjeta de crédito requerida',
    ],
    cta: 'Empezar gratis 14 días',
    ctaAction: 'signup',
    highlighted: false,
    note: 'Después de 14 días podés pasarte a Empresarial o seguir con acceso de solo lectura.',
    badge: null,
  },
  {
    id: 'empresarial',
    name: 'Empresarial',
    monthlyPrice: 599000,
    period: 'COP / mes',
    description: 'Todo lo que tu negocio necesita para crecer con control',
    features: [
      'PDFs ilimitados',
      'Hasta 2 cuentas bancarias',
      '2 usuarios (Administrador y Auxiliar)',
      'Conexión con Siigo (facturas en vivo)',
      'Módulo de Facturas DIAN',
      'Conciliación real por número de factura',
      'IVA, ReteICA y ReteFuente desde facturación',
      'Las cuentas con la DIAN cada mes',
      'Historial ilimitado',
      'Reportes avanzados con IA',
      'Coach financiero con IA',
      'Área de Inventario integrada',
      'Descuento automático de inventario desde facturación',
      'Soporte prioritario',
    ],
    cta: 'Activar Empresarial',
    ctaAction: 'wompi-empresarial',
    highlighted: true,
    note: 'Convierte tus facturas, bancos e inventario en control financiero automático.',
    badge: 'Más completo',
  },
];
