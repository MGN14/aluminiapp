import { useState } from 'react';
import {
  Landmark,
  Receipt,
  Package,
  Download,
  Bot,
  LayoutDashboard,
  ArrowRight,
  Check,
} from 'lucide-react';
import { BRAND, INK, INK2, INK3 } from '../OnboardingShell';

interface Stop {
  id: string;
  Icon: typeof Landmark;
  pill: string;
  title: string;
  description: string;
  bullets: string[];
  cta: string;
  path: string;
}

const STOPS: Stop[] = [
  {
    id: 'statements',
    Icon: Landmark,
    pill: 'Lo que más nutre a AluminIA',
    title: 'Extracto bancario',
    description:
      'Lo primero: sube tu extracto del banco. Es lo que le da contexto completo a AluminIA sobre el dinero que entra y sale realmente.',
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
    bullets: [
      'Si tienes Siigo conectado, las traemos automáticamente (ventas y compras).',
      'Si no, puedes cargarlas por XML o DIAN directamente.',
      'Verás tu utilidad real actualizada cada vez que entra una factura.',
    ],
    cta: 'Ir a facturas',
    path: '/invoices',
  },
  {
    id: 'inventory',
    Icon: Package,
    pill: 'Stock y rotación',
    title: 'Inventarios',
    description:
      'Carga los productos que manejas para que veamos cuánto capital tienes detenido, qué se mueve y qué está a punto de quedarse sin stock.',
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
    bullets: [
      'Los KPIs que realmente importan, sin ruido.',
      'Actualizado automáticamente con cada factura o extracto.',
      'Es donde recomendamos arrancar cada día.',
    ],
    cta: 'Ir al dashboard',
    path: '/dashboard',
  },
];

interface Props {
  onNavigate: (path: string) => void;
}

export default function Step10Tour({ onNavigate }: Props) {
  const [idx, setIdx] = useState(0);
  const stop = STOPS[idx];
  const isLast = idx === STOPS.length - 1;
  const { Icon } = stop;

  return (
    <div>
      <h2
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.8px',
          color: INK,
          marginBottom: 10,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s both',
          opacity: 0,
        }}
      >
        Tour guiado
      </h2>
      <p
        style={{
          fontSize: 14.5,
          color: INK2,
          lineHeight: 1.6,
          marginBottom: 20,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s both',
          opacity: 0,
        }}
      >
        Seguimos este orden porque es lo que más nutre a AluminIA. Empezamos por los datos y
        terminamos en el dashboard donde ves el resultado.
      </p>

      {/* Internal tour progress (6 dots) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 20,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.15s both',
          opacity: 0,
        }}
      >
        {STOPS.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <div
              key={s.id}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 99,
                background: done
                  ? BRAND
                  : active
                    ? `linear-gradient(90deg, ${BRAND}, oklch(0.60 0.14 155))`
                    : 'rgba(0,0,0,0.08)',
                transition: 'background 0.3s',
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          fontSize: 11,
          color: INK3,
          letterSpacing: 0.3,
          marginBottom: 14,
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        Paso {idx + 1} de {STOPS.length}
      </div>

      {/* Current stop card (remounts on idx change to re-animate) */}
      <div
        key={stop.id}
        style={{
          background: '#fff',
          border: '1px solid rgba(0,0,0,0.06)',
          borderRadius: 16,
          padding: 20,
          boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
          animation: 'fieldIn 0.45s cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: 'oklch(0.43 0.14 155 / 0.10)',
              color: BRAND,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon style={{ width: 22, height: 22 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'inline-flex',
                fontSize: 10.5,
                fontWeight: 700,
                color: BRAND,
                background: 'oklch(0.43 0.14 155 / 0.08)',
                padding: '3px 8px',
                borderRadius: 99,
                letterSpacing: 0.3,
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              {stop.pill}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: INK, letterSpacing: '-0.4px' }}>
              {stop.title}
            </div>
          </div>
        </div>

        <p style={{ fontSize: 14, color: INK2, lineHeight: 1.55, marginBottom: 14 }}>
          {stop.description}
        </p>

        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 18px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {stop.bullets.map((b, i) => (
            <li
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 13,
                color: INK2,
                lineHeight: 1.5,
              }}
            >
              <Check
                style={{
                  width: 14,
                  height: 14,
                  color: BRAND,
                  flexShrink: 0,
                  marginTop: 3,
                }}
                strokeWidth={3}
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            onClick={() => onNavigate(stop.path)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              height: 46,
              padding: '0 18px',
              background: BRAND,
              border: 'none',
              borderRadius: 12,
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 6px 18px oklch(0.43 0.14 155 / 0.30)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {stop.cta}
            <ArrowRight style={{ width: 14, height: 14 }} />
          </button>

          {!isLast && (
            <button
              type="button"
              onClick={() => setIdx(idx + 1)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                height: 40,
                padding: '0 14px',
                background: 'transparent',
                border: 'none',
                color: INK2,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = INK;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = INK2;
              }}
            >
              Saltar por ahora · siguiente paso →
            </button>
          )}
        </div>
      </div>

      {idx > 0 && (
        <button
          type="button"
          onClick={() => setIdx(idx - 1)}
          style={{
            marginTop: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'transparent',
            border: 'none',
            color: INK3,
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          ← Volver al paso anterior del tour
        </button>
      )}
    </div>
  );
}
