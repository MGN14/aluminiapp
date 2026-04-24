import { Truck, Factory, Briefcase, HardHat, Layers } from 'lucide-react';
import OptionCard from '../OptionCard';
import CIIUCombobox from '../CIIUCombobox';
import type { StepProps } from '../state';
import { INK, INK2 } from '../OnboardingShell';

const ACTIVIDADES = [
  {
    value: 'distribuidor',
    Icon: Truck,
    title: 'Distribuidor',
    description: 'Compras y vendes sin transformar (supermercados, mayoristas, retail, e-commerce).',
    footnote: 'Nos enfocamos en rotación de inventario, márgenes por SKU y proveedores.',
  },
  {
    value: 'fabricante',
    Icon: Factory,
    title: 'Fabricante',
    description: 'Produces o transformas bienes (textil, alimentos, metalmecánica, panadería…).',
    footnote: 'Rastrearemos costos de producción, mermas y rentabilidad por producto.',
  },
  {
    value: 'servicios',
    Icon: Briefcase,
    title: 'Servicios',
    description: 'Consultoría, software, profesionales, salud, educación, agencias.',
    footnote: 'Nos enfocamos en horas facturables, tarifas promedio y CxC por cliente.',
  },
  {
    value: 'construccion',
    Icon: HardHat,
    title: 'Construcción',
    description: 'Obra civil, inmobiliaria, remodelación. Tiene reglas fiscales especiales (AIU, retenciones).',
    footnote: 'Aplicamos cálculos con AIU y retenciones específicas del sector.',
  },
  {
    value: 'mixto',
    Icon: Layers,
    title: 'Mixto',
    description: 'Combinas varios (ej: fabricas Y vendes al público, o servicios + productos).',
    footnote: 'Reportes separados por línea para que veas qué parte rinde más.',
  },
] as const;

export default function Step06Actividad({ state, update }: StepProps) {
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
        ¿A qué se dedica tu negocio?
      </h2>
      <p
        style={{
          fontSize: 14.5,
          color: INK2,
          lineHeight: 1.6,
          marginBottom: 24,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s both',
          opacity: 0,
        }}
      >
        Con esto ajustamos los KPIs, alertas y reportes para que sean relevantes a tu operación.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          marginBottom: 24,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.15s both',
          opacity: 0,
        }}
      >
        {ACTIVIDADES.map((a) => (
          <OptionCard
            key={a.value}
            selected={state.actividadPrincipal === a.value}
            onClick={() => update('actividadPrincipal', a.value)}
            icon={<a.Icon style={{ width: 20, height: 20 }} />}
            title={a.title}
            description={a.description}
            footnote={a.footnote}
          />
        ))}
      </div>

      {/* CIIU code */}
      <div
        style={{
          marginBottom: 24,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.22s both',
          opacity: 0,
        }}
      >
        <label
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 500,
            color: INK,
            marginBottom: 6,
          }}
        >
          Código CIIU
        </label>
        <CIIUCombobox
          value={state.codigoCiiu}
          onChange={(code) => update('codigoCiiu', code)}
          actividad={state.actividadPrincipal}
        />
        <p style={{ fontSize: 11.5, color: INK2, marginTop: 6, lineHeight: 1.5 }}>
          Lo encuentras en el RUT casilla 46. Si no lo sabes, busca por palabra (ej: "panadería").
        </p>
      </div>

      {/* Nivel ingresos — opcional */}
      <div
        style={{
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.28s both',
          opacity: 0,
        }}
      >
        <label
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 500,
            color: INK,
            marginBottom: 6,
          }}
        >
          Nivel de ingresos del año anterior{' '}
          <span style={{ fontSize: 11, color: INK2, fontWeight: 400 }}>(opcional)</span>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <OptionCard
            selected={state.nivelIngresos === 'menos_92k_uvt'}
            onClick={() =>
              update(
                'nivelIngresos',
                state.nivelIngresos === 'menos_92k_uvt' ? null : 'menos_92k_uvt',
              )
            }
            title="Menos de 92.000 UVT"
            description="≈ menos de $4.300M COP (2024)"
          />
          <OptionCard
            selected={state.nivelIngresos === 'mas_92k_uvt'}
            onClick={() =>
              update(
                'nivelIngresos',
                state.nivelIngresos === 'mas_92k_uvt' ? null : 'mas_92k_uvt',
              )
            }
            title="Más de 92.000 UVT"
            description="≈ más de $4.300M COP (2024)"
          />
        </div>
      </div>
    </div>
  );
}
