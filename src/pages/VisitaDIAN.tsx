import { useState, useMemo, useEffect } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import CalendarioMensual from '@/components/dian/CalendarioMensual';
import ConfigurarObligacionesNegocio from '@/components/dian/ConfigurarObligacionesNegocio';
import CFOInsights from '@/components/dashboard/CFOInsights';
import { PeriodSelection } from '@/components/dashboard/UnifiedPeriodFilter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, Settings, AlertTriangle, Info, Edit2, MessageCircle } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useFiscalConfig } from '@/hooks/useFiscalConfig';
import { useBusinessObligations } from '@/hooks/useBusinessObligations';
import { useFinancialHealthScore } from '@/hooks/useFinancialHealthScore';
import { useNico } from '@/hooks/useNicoContext';
import { supabase } from '@/integrations/supabase/client';
import {
  VENCIMIENTOS_IVA_2026,
  VENCIMIENTOS_IVA_CUATRIMESTRAL_2026,
  VENCIMIENTOS_RETEFUENTE_2026,
  VENCIMIENTOS_RENTA_JURIDICA_2026,
  VENCIMIENTOS_RENTA_NATURAL_2026,
  VENCIMIENTOS_ICA_BOGOTA_2026,
  PERIODOS_IVA,
  PERIODOS_IVA_CUATRIMESTRAL,
  MESES_RETEFUENTE,
  PERIODOS_ICA,
  CalendarEvent,
  TIPO_LABEL,
} from '@/lib/dianCalendar2026';

function diasRestantes(fecha: Date): number {
  return Math.ceil((fecha.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

const SCORE_COLORS = {
  conciliacion: 'hsl(217, 91%, 60%)',
  facturacion: 'hsl(152, 69%, 40%)',
  impuestos: 'hsl(24, 95%, 53%)',
  cartera: 'hsl(280, 84%, 60%)',
  clasificacion: 'hsl(220, 9%, 46%)',
};

const SCORE_VARIABLES = [
  { key: 'conciliacion', label: 'Conciliación Bancaria', color: SCORE_COLORS.conciliacion },
  { key: 'facturacion', label: 'Facturación Soportada', color: SCORE_COLORS.facturacion },
  { key: 'impuestos', label: 'Control de Impuestos', color: SCORE_COLORS.impuestos },
  { key: 'cartera', label: 'Cartera y Anticipos', color: SCORE_COLORS.cartera },
  { key: 'clasificacion', label: 'Clasificación Financiera', color: SCORE_COLORS.clasificacion },
] as const;

function getRiskLevel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: 'Bajo', color: 'text-success' };
  if (score >= 80) return { label: 'Moderado', color: 'text-success' };
  if (score >= 50) return { label: 'Alto', color: 'text-warning' };
  return { label: 'Crítico', color: 'text-destructive' };
}

function getNicoMessage(score: number): { line1: string; line2: string } {
  if (score >= 90) return {
    line1: 'Todo en orden. Si la DIAN revisa hoy, no tendrías problemas.',
    line2: 'Sigue así y mantén tu disciplina financiera.',
  };
  if (score >= 80) return {
    line1: 'Casi listo, podrías tener observaciones menores.',
    line2: 'Unos ajustes más y quedas tranquilo ante una revisión.',
  };
  if (score >= 50) return {
    line1: 'Tienes desorden en varias áreas clave.',
    line2: 'Aún estás a tiempo de corregirlo antes de una revisión.',
  };
  return {
    line1: 'Tu situación fiscal necesita atención urgente.',
    line2: 'Una visita de la DIAN podría resultar en sanciones.',
  };
}

export default function VisitaDIAN() {
  const { config, saveConfig } = useFiscalConfig();
  const { obligations } = useBusinessObligations();
  const { openNico, setPageContext } = useNico();

  const currentYear = new Date().getFullYear();
  const { scores } = useFinancialHealthScore(currentYear);

  const [hasTransactions, setHasTransactions] = useState(false);
  useEffect(() => {
    supabase.from('transactions').select('id', { count: 'exact', head: true }).is('deleted_at', null).then(({ count }) => {
      setHasTransactions((count ?? 0) > 0);
    });
  }, []);

  const now = new Date();
  const insightsPeriod: PeriodSelection = useMemo(() => ({
    type: 'year' as const,
    month: now.getMonth() + 1,
    quarter: Math.ceil((now.getMonth() + 1) / 3),
    year: currentYear,
  }), [currentYear]);

  const donutData = useMemo(() => {
    if (!scores) return [];
    return SCORE_VARIABLES.map((v) => ({
      name: v.label,
      value: scores[v.key as keyof typeof scores] as number,
      color: v.color,
    }));
  }, [scores]);

  const bgValue = scores ? Math.max(0, 100 - scores.total) : 100;
  const risk = scores ? getRiskLevel(scores.total) : null;
  const nicoMsg = scores ? getNicoMessage(scores.total) : null;

  const handleAskNico = () => {
    setPageContext({ page: 'financial-health', filters: { year: currentYear } });
    openNico();
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('nico-prefill', { detail: { message: '¿Qué problemas podría encontrarme la DIAN?' } }));
    }, 300);
  };

  const [showConfigModal, setShowConfigModal] = useState(false);
  const [editingFiscal, setEditingFiscal] = useState(false);
  const [nitInput, setNitInput] = useState('');
  const [rentaType, setRentaType] = useState<'juridica' | 'natural'>('juridica');

  // Último dígito del NIT (antes del guión) — es lo que usa DIAN para el calendario.
  // Nota: `config.nit_digit` es el dígito de verificación (después del guión), no sirve acá.
  const nitDigit = config?.nit_ultimo_digito ?? null;
  const effectiveRentaType = config?.persona_type === 'natural' ? 'natural' : (config?.renta_type ?? 'juridica');

  // Perfil fiscal — determina qué obligaciones mostrar
  const responsableIva = config?.responsable_iva ?? true;
  const agenteRetencion = config?.agente_retencion ?? false;
  const autorretenedor = config?.autorretenedor ?? false;
  const responsableIca = config?.responsable_ica ?? true;
  const regimen = config?.regimen ?? 'comun';
  const nivelIngresos = config?.nivel_ingresos ?? 'mas_92k_uvt';
  // IVA cuatrimestral solo para régimen común con ingresos < 92.000 UVT
  const ivaCuatrimestral = regimen === 'comun' && nivelIngresos === 'menos_92k_uvt';

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
    // Input del usuario: último dígito del NIT (antes del guión).
    const digit = parseInt(nit[nit.length - 1]);
    await saveConfig.mutateAsync({ nit_ultimo_digito: digit, renta_type: rentaType });
    setEditingFiscal(false);
  };

  // Construir eventos del calendario (DIAN + ICA + negocio)
  const events: CalendarEvent[] = useMemo(() => {
    const list: CalendarEvent[] = [];
    if (nitDigit !== null) {
      // IVA — solo si es responsable. Régimen simple no declara IVA por separado.
      if (responsableIva && regimen !== 'simple') {
        if (ivaCuatrimestral) {
          VENCIMIENTOS_IVA_CUATRIMESTRAL_2026[nitDigit]?.forEach((fecha, i) => {
            list.push({
              id: `iva-${i}`,
              tipo: 'iva',
              descripcion: `IVA Cuatrimestral — ${PERIODOS_IVA_CUATRIMESTRAL[i]}`,
              fecha: new Date(fecha + 'T12:00:00'),
              periodo: PERIODOS_IVA_CUATRIMESTRAL[i],
              origen: 'dian',
            });
          });
        } else {
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
        }
      }
      // Retefuente — solo si es agente de retención o autorretenedor
      if (agenteRetencion || autorretenedor) {
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
      }
      // Renta — aplica a todos los declarantes
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
      // ICA Bogotá — solo si es responsable
      if (responsableIca) {
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
  }, [nitDigit, effectiveRentaType, obligations, responsableIva, agenteRetencion, autorretenedor, responsableIca, regimen, ivaCuatrimestral]);

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

        {/* Score salud financiera */}
        {scores && risk && nicoMsg && (
          <div className="rounded-3xl border border-border/50 bg-gradient-to-br from-card via-card to-muted/20 p-6 md:p-8 shadow-sm">
            <div className="flex flex-col md:flex-row items-center gap-8">
              <div className="relative w-44 h-44 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[{ value: 100 }]} dataKey="value" cx="50%" cy="50%" innerRadius={54} outerRadius={72} startAngle={90} endAngle={-270} stroke="none">
                      <Cell fill="hsl(var(--muted))" />
                    </Pie>
                    <Pie data={[...donutData, { name: 'empty', value: bgValue, color: 'transparent' }]} dataKey="value" cx="50%" cy="50%" innerRadius={54} outerRadius={72} startAngle={90} endAngle={-270} stroke="none" paddingAngle={1}>
                      {donutData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                      <Cell fill="transparent" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-4xl font-bold tracking-tight ${risk.color}`}>{scores.total}</span>
                  <span className="text-xs text-muted-foreground font-medium">/100</span>
                </div>
              </div>
              <div className="flex-1 space-y-4 text-center md:text-left">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Score salud financiera</p>
                  <h2 className={`text-xl font-bold tracking-tight ${risk.color}`}>Riesgo {risk.label}</h2>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">{nicoMsg.line1}</p>
                  <p className="text-sm text-muted-foreground">{nicoMsg.line2}</p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center md:justify-start">
                  {donutData.map((seg) => (
                    <div key={seg.name} className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: seg.color }} />
                      <span className="text-[11px] text-muted-foreground">{seg.name}</span>
                      <span className="text-[11px] font-bold text-foreground">{seg.value}</span>
                    </div>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-2 text-success hover:text-success hover:bg-success/10 rounded-xl"
                  onClick={handleAskNico}
                >
                  <MessageCircle className="h-4 w-4" />
                  Preguntar a Nico
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Posibles problemas ante la DIAN (Nico insights) */}
        <CFOInsights
          periodSelection={insightsPeriod}
          hasTransactions={hasTransactions}
          title="Posibles problemas ante la DIAN"
          subtitle="Esto es lo que la DIAN podría observarte hoy."
          emptySubtitle="Aún no tengo suficiente información para anticipar problemas. Sube un extracto y una factura para arrancar."
        />

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
