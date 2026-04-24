import { Landmark, Receipt, HeartHandshake } from 'lucide-react';
import OptionCard from '../OptionCard';
import type { StepProps } from '../state';
import { INK, INK2 } from '../OnboardingShell';

export default function Step04Regimen({ state, update }: StepProps) {
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
        ¿Qué régimen tributario usas?
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
        Mira el RUT (casilla 53) o pregúntale a tu contador. Esto define tasas e impuestos que debes declarar.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.15s both',
          opacity: 0,
        }}
      >
        <OptionCard
          selected={state.regimen === 'comun'}
          onClick={() => update('regimen', 'comun')}
          icon={<Landmark style={{ width: 20, height: 20 }} />}
          title="Régimen Común"
          description="El más frecuente. Personas jurídicas y naturales con ingresos significativos que cobran IVA en sus ventas."
          footnote="Calculamos renta, IVA, retenciones y autorretenciones con las tasas estándar."
        />
        <OptionCard
          selected={state.regimen === 'simple'}
          onClick={() => update('regimen', 'simple')}
          icon={<Receipt style={{ width: 20, height: 20 }} />}
          title="Régimen Simple de Tributación (SIMPLE)"
          description="Para pequeños contribuyentes que eligieron declarar todo con una sola tarifa (menos fricción, sin IVA facturado)."
          footnote="Simplificamos el cálculo — sin IVA en facturas, tarifa única según actividad."
        />
        <OptionCard
          selected={state.regimen === 'especial'}
          onClick={() => update('regimen', 'especial')}
          icon={<HeartHandshake style={{ width: 20, height: 20 }} />}
          title="Régimen Especial"
          description="Cooperativas, fundaciones, ONG, asociaciones sin ánimo de lucro."
          footnote="Aplicamos reglas de renta especiales y reportes sectoriales."
        />
      </div>
    </div>
  );
}
