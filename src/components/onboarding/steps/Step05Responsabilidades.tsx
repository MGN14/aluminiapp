import YesNoField from '../YesNoField';
import FacturadorSelect from '../FacturadorSelect';
import type { StepProps } from '../state';
import { INK, INK2 } from '../OnboardingShell';

export default function Step05Responsabilidades({ state, update }: StepProps) {
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
        Responsabilidades tributarias
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
        Mira el RUT (casillas 53-54). Si no estás seguro, marca "No" — siempre se puede ajustar después.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.15s both',
          opacity: 0,
        }}
      >
        <YesNoField
          label="¿Eres responsable de IVA?"
          description="Cobras IVA del 19% (o 5%) en tus facturas de venta."
          whatWeDo="Calculamos tu IVA por cobrar y por pagar con tus facturas de venta y compra en tiempo real."
          value={state.responsableIva}
          onChange={(v) => update('responsableIva', v)}
        />
        <YesNoField
          label="¿Realizas retenciones en la fuente?"
          description="Cuando compras a proveedores, les descuentas un % y se lo pagas a la DIAN."
          whatWeDo="Avisamos cuánto debes pagar cada mes por retenciones practicadas."
          value={state.agenteRetencion}
          onChange={(v) => update('agenteRetencion', v)}
        />
        <YesNoField
          label="¿Eres autorretenedor?"
          description="Cuando te pagan, tú misma/o practicas la retención sobre tus propios ingresos."
          whatWeDo="Calculamos tu autorretención mensual según los ingresos facturados."
          value={state.autorretenedor}
          onChange={(v) => update('autorretenedor', v)}
        />
        <YesNoField
          label="¿Tu empresa paga ICA?"
          description="Impuesto municipal de industria y comercio (normalmente bimestral o anual)."
          whatWeDo="Calculamos ICA por ciudad según los ingresos facturados."
          value={state.responsableIca}
          onChange={(v) => update('responsableIca', v)}
        />
        <YesNoField
          label="¿Estás obligado a facturación electrónica?"
          description="Emites facturas electrónicas firmadas que se reportan a la DIAN."
          whatWeDo="Conectamos tu facturador para traer ventas automáticamente — sin digitar nada."
          value={state.facturacionElectronica}
          onChange={(v) => update('facturacionElectronica', v)}
        />

        {state.facturacionElectronica && (
          <div
            style={{
              animation: 'fieldIn 0.4s cubic-bezier(0.16,1,0.3,1) both',
              padding: 14,
              background: '#fff',
              border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: 14,
            }}
          >
            <FacturadorSelect
              value={state.nombreFacturador}
              onChange={(v) => update('nombreFacturador', v)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
