import { useState, useMemo, useEffect } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import CalendarioMensual from '@/components/dian/CalendarioMensual';
import ConfigurarObligacionesNegocio from '@/components/dian/ConfigurarObligacionesNegocio';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, Settings, AlertTriangle, Info, Edit2 } from 'lucide-react';
import { useFiscalConfig } from '@/hooks/useFiscalConfig';
import { useBusinessObligations } from '@/hooks/useBusinessObligations';
import {
  VENCIMIENTOS_IVA_2026,
  VENCIMIENTOS_RETEFUENTE_2026,
  VENCIMIENTOS_RENTA_JURIDICA_2026,
  VENCIMIENTOS_RENTA_NATURAL_2026,
  VENCIMIENTOS_ICA_BOGOTA_2026,
  PERIODOS_IVA,
  MESES_RETEFUENTE,
  PERIODOS_ICA,
  CalendarEvent,
  TIPO_LABEL,
} from '@/lib/dianCalendar2026';

function diasRestantes(fecha: Date): number {
  return Math.ceil((fecha.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export default function VisitaDIAN() {
  const { config, saveConfig } = useFiscalConfig();
  const { obligations } = useBusinessObligations();

  const [showConfigModal, setShowConfigModal] = useState(false);
  const [editingFiscal, setEditingFiscal] = useState(false);
  const [nitInput, setNitInput] = useState('');
  const [rentaType, setRentaType] = useState<'juridica' | 'natural'>('juridica');

  const nitDigit = config?.nit_digit ?? null;
  const effectiveRentaType = config?.renta_type ?? 'juridica';

  // Abrir edición automáticamente si falta NIT
  useEffect(() => {
    if (config !== undefined && nitDigit === null) setEditingFiscal(true);
  }, [config, nitDigit]);

  // Pre-poblar input al editar
  useEffect(() => {
    if (editingFiscal && nitDigit !== null) {
      setNitInput(String(nitDigit));
      setRentaType(effectiveRentaType);
    }
  }, [editingFiscal, nitDigit, effectiveRentaType]);

  const handleSaveNit = async () => {
    const nit = nitInput.replace(/\D/g, '');
    if (!nit.length) return;
    const digit = parseInt(nit[nit.length - 1]);
    await saveConfig.mutateAsync({ nit_digit: digit, renta_type: rentaType });
    setEditingFiscal(false);
  };

  // Construir eventos del calendario (DIAN + ICA + negocio)
  const events: CalendarEvent[] = useMemo(() => {
    const list: CalendarEvent[] = [];
    if (nitDigit !== null) {
      // IVA
      VENCIMIENTOS_IVA_2026[nitDigit]?.forEach((fecha, i) => {
        list.push({
          id: `iva-${i}`,
          tipo: 'iva',
          descripcion: `IVA Bimestral — ${PERIODOS_IVA[i]}`,
          fecha: new Date(fecha + 'T12:00:00'),
          periodo: PERIODOS_IVA[i],
          origen: 'dian',
        });
      });
      // Retefuente
      VENCIMIENTOS_RETEFUENTE_2026[nitDigit]?.forEach((fecha, i) => {
        list.push({
          id: `ret-${i}`,
          tipo: 'retefuente',
          descripcion: `Retención en la Fuente — ${MESES_RETEFUENTE[i]}`,
          fecha: new Date(fecha + 'T12:00:00'),
          periodo: MESES_RETEFUENTE[i],
          origen: 'dian',
        });
      });
      // Renta
      const rentaMap = effectiveRentaType === 'natural'
        ? VENCIMIENTOS_RENTA_NATURAL_2026
        : VENCIMIENTOS_RENTA_JURIDICA_2026;
      const rentaFecha = rentaMap[nitDigit];
      if (rentaFecha) {
        list.push({
          id: 'renta-2025',
          tipo: 'renta',
          descripcion: `Declaración de Renta ${effectiveRentaType === 'natural' ? 'Persona Natural' : 'Persona Jurídica'} — Año gravable 2025`,
          fecha: new Date(rentaFecha + 'T12:00:00'),
          periodo: '2025',
          origen: 'dian',
        });
      }
      // ICA Bogotá
      VENCIMIENTOS_ICA_BOGOTA_2026[nitDigit]?.forEach((fecha, i) => {
        list.push({
          id: `ica-${i}`,
          tipo: 'ica',
          descripcion: `ICA Bogotá — ${PERIODOS_ICA[i]}`,
          fecha: new Date(fecha + 'T12:00:00'),
          periodo: PERIODOS_ICA[i],
          origen: 'ica',
        });
      });
    }

    // Obligaciones del negocio — generar evento por mes (12 meses desde hoy)
    const base = new Date();
    base.setDate(1);
    for (const ob of obligations) {
      if (!ob.activa) continue;
      for (let offset = -1; offset <= 12; offset++) {
        const y = base.getFullYear();
        const m = base.getMonth() + offset;
        const d = new Date(y, m, 1);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const day = Math.min(ob.dia_mes, lastDay);
        const fecha = new Date(d.getFullYear(), d.getMonth(), day, 12, 0, 0);
        list.push({
          id: `ob-${ob.id}-${d.getFullYear()}-${d.getMonth()}`,
          tipo: ob.tipo,
          descripcion: ob.nombre,
          fecha,
          periodo: d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }),
          monto: ob.monto_estimado,
          origen: 'negocio',
        });
      }
    }

    return list;
  }, [nitDigit, effectiveRentaType, obligations]);

  // Próximas urgentes (≤ 15 días)
  const urgentes = useMemo(() => {
    return events
      .filter(ev => {
        const d = diasRestantes(ev.fecha);
        return d >= 0 && d <= 15;
      })
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
      .slice(0, 6);
  }, [events]);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950/30">
              <ShieldCheck className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Visita DIAN</h1>
              <p className="text-sm text-muted-foreground">
                Calendario tributario y obligaciones del negocio
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {nitDigit !== null && (
              <Button variant="outline" size="sm" onClick={() => setEditingFiscal(true)}>
                <Edit2 className="h-3.5 w-3.5 mr-1" />
                NIT: ...{nitDigit}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setShowConfigModal(true)}>
              <Settings className="h-3.5 w-3.5 mr-1" />
              Obligaciones del negocio
            </Button>
          </div>
        </div>

        {/* Configuración fiscal */}
        {editingFiscal && (
          <Card className="border-dashed">
            <CardContent className="pt-6 pb-6 space-y-4">
              <div>
                <p className="font-medium">Configuración fiscal</p>
                <p className="text-xs text-muted-foreground">
                  Las fechas de la DIAN dependen del último dígito del NIT.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">NIT (solo se usa el último dígito)</Label>
                  <Input
                    placeholder="Ej: 900.123.456-7"
                    value={nitInput}
                    onChange={e => setNitInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveNit()}
                  />
                </div>
                <div>
                  <Label className="text-xs">Tipo de declarante de renta</Label>
                  <Select value={rentaType} onValueChange={(v) => setRentaType(v as 'juridica' | 'natural')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="juridica">Persona jurídica</SelectItem>
                      <SelectItem value="natural">Persona natural</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                {nitDigit !== null && (
                  <Button variant="ghost" size="sm" onClick={() => setEditingFiscal(false)}>
                    Cancelar
                  </Button>
                )}
                <Button size="sm" onClick={handleSaveNit} disabled={!nitInput.trim() || saveConfig.isPending}>
                  Guardar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Próximas urgentes */}
        {urgentes.length > 0 && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">
                Próximas obligaciones (15 días)
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-1">
              {urgentes.map(ev => {
                const dias = diasRestantes(ev.fecha);
                return (
                  <div key={ev.id} className="text-xs text-orange-700 dark:text-orange-300 flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px] bg-background shrink-0">
                      {TIPO_LABEL[ev.tipo]}
                    </Badge>
                    <span className="truncate">
                      {ev.descripcion} — {ev.fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
                      {' '}({dias === 0 ? '¡hoy!' : `${dias}d`})
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Calendario */}
        {nitDigit !== null ? (
          <Card>
            <CardContent className="pt-6">
              <CalendarioMensual events={events} />
            </CardContent>
          </Card>
        ) : !editingFiscal && (
          <Card className="border-dashed">
            <CardContent className="pt-6 pb-6 text-center">
              <p className="text-sm text-muted-foreground">
                Configurá tu NIT para ver el calendario tributario.
              </p>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground italic flex items-center gap-1">
          <Info className="h-3 w-3" />
          Fechas basadas en el Calendario Tributario DIAN 2026 e ICA Bogotá. Verificá con tu contador ante cambios normativos.
        </p>
      </div>

      <ConfigurarObligacionesNegocio
        open={showConfigModal}
        onClose={() => setShowConfigModal(false)}
      />
    </AppLayout>
  );
}
