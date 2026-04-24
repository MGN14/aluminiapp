// Shared definition of the 6 tour stops. Used by:
//  - src/components/onboarding/steps/Step10Tour.tsx  (in-onboarding preview)
//  - src/components/tour/TourOverlay.tsx             (floating overlay that
//    follows the user across the app after they start the tour)

import {
  Landmark,
  Receipt,
  Package,
  Download,
  Bot,
  LayoutDashboard,
  type LucideIcon,
} from 'lucide-react';

export interface TourStop {
  id: string;
  Icon: LucideIcon;
  pill: string;
  title: string;
  description: string;
  overlayHint: string; // shorter copy for the floating overlay
  bullets: string[];
  cta: string;
  path: string;
}

export const TOUR_STOPS: TourStop[] = [
  {
    id: 'statements',
    Icon: Landmark,
    pill: 'Lo que más nutre a AluminIA',
    title: 'Extracto bancario',
    description:
      'Lo primero: sube tu extracto del banco. Es lo que le da contexto completo a AluminIA sobre el dinero que entra y sale realmente.',
    overlayHint:
      'Sube aquí tu extracto (mensual o semanal). Con esto AluminIA ve el dinero real que entra y sale.',
    bullets: [
      'Puedes subirlo mensual (una vez al mes) o semanal si quieres ver los números más frescos.',
      'Soportamos PDF de Bancolombia, Davivienda, BBVA y los demás bancos grandes.',
      'Nico cruzará esos movimientos con tus facturas automáticamente.',
    ],
    cta: 'Subir extracto bancario',
    path: '/statement-upload',
  },
  {
    id: 'invoices',
    Icon: Receipt,
    pill: 'Ventas y compras',
    title: 'Facturas de venta y compra',
    description:
      'Conecta tus facturas electrónicas para que AluminIA calcule IVA, retenciones, márgenes y CxC/CxP sin que digites nada.',
    overlayHint:
      'Conecta tus facturas electrónicas (o trae las de Siigo) para que calculemos IVA, retenciones y márgenes.',
    bullets: [
      'Si tienes Siigo conectado, las traemos automáticamente (ventas y compras).',
      'Si no, puedes cargarlas por XML o DIAN directamente.',
      'Verás tu utilidad real actualizada cada vez que entra una factura.',
    ],
    cta: 'Ir a facturas',
    path: '/invoices/venta',
  },
  {
    id: 'inventory',
    Icon: Package,
    pill: 'Stock y rotación',
    title: 'Inventarios',
    description:
      'Carga los productos que manejas para que veamos cuánto capital tienes detenido, qué se mueve y qué está a punto de quedarse sin stock.',
    overlayHint:
      'Sube tus productos para ver capital detenido, rotación por SKU y alertas de stock crítico.',
    bullets: [
      'Puedes cargar productos uno a uno o masivamente por CSV.',
      'Registras entradas y salidas y nosotros calculamos rotación por SKU.',
      'Nico te avisa cuando algo está por agotarse o quedó capital frenado.',
    ],
    cta: 'Ir a inventarios',
    path: '/inventarios',
  },
  {
    id: 'export',
    Icon: Download,
    pill: 'Para tu contador',
    title: 'Exportar movimientos',
    description:
      'Descarga todos tus movimientos categorizados en Excel o CSV para mandarlos a tu contador o integrarlos con otras herramientas.',
    overlayHint:
      'Descarga todos los movimientos categorizados (Excel/CSV) para pasárselos a tu contador.',
    bullets: [
      'Exportas por rango de fechas y por tipo de movimiento.',
      'Incluye la categorización que Nico hizo automáticamente.',
      'Úsalo para declaraciones bimestrales, ICA, renta o cualquier auditoría.',
    ],
    cta: 'Ir a exportar',
    path: '/export',
  },
  {
    id: 'nico',
    Icon: Bot,
    pill: 'Tu copiloto IA',
    title: 'Nico',
    description:
      'Nico revisa tus datos cada día y te dice exactamente qué está pasando con el dinero — sin que tengas que buscar.',
    overlayHint:
      'Nico revisa tu operación cada día y te dice qué mirar: CxC vencidas, stock crítico, capital detenido.',
    bullets: [
      'Alertas de clientes que te deben hace demasiado tiempo.',
      'Avisos de productos críticos o capital detenido.',
      'Análisis y recomendaciones concretas en lenguaje claro.',
    ],
    cta: 'Conocer a Nico',
    path: '/nico',
  },
  {
    id: 'dashboard',
    Icon: LayoutDashboard,
    pill: 'Tu resumen diario',
    title: 'Dashboard',
    description:
      'Todo lo anterior se condensa aquí. Tu health score, margen, CxC, CxP y la próxima fecha de declaración en una sola pantalla.',
    overlayHint:
      'Aquí aterriza todo: KPIs, health score, CxC, CxP y la próxima fecha de declaración. Arranca cada día aquí.',
    bullets: [
      'Los KPIs que realmente importan, sin ruido.',
      'Actualizado automáticamente con cada factura o extracto.',
      'Es donde recomendamos arrancar cada día.',
    ],
    cta: 'Ir al dashboard',
    path: '/dashboard',
  },
];
