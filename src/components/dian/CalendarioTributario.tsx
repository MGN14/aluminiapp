import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle, Clock, AlertTriangle, Calendar, ChevronDown, ChevronUp, Info } from 'lucide-react';

// ── Calendario DIAN 2026 ────────────────────────────────────────
// Basado en el Decreto 2229 de 2023 (calendario tributario Colombia)
// Fechas por último dígito del NIT

const VENCIMIENTOS_IVA_2026: Record<number, string[]> = {
  // Bimestral: 6 períodos
  // Formato: YYYY-MM-DD (fecha límite declaración y pago)
  0: ['2026-03-10','2026-05-12','2026-07-09','2026-09-09','2026-11-10','2027-01-12'],
  1: ['2026-03-11','2026-05-13','2026-07-10','2026-09-10','2026-11-11','2027-01-13'],
  2: ['2026-03-12','2026-05-14','2026-07-13','2026-09-11','2026-11-12','2027-01-14'],
  3: ['2026-03-13','2026-05-15','2026-07-14','2026-09-14','2026-11-13','2027-01-15'],
  4: ['2026-03-16','2026-05-18','2026-07-15','2026-09-15','2026-11-16','2027-01-16'],
  5: ['2026-03-17','2026-05-19','2026-07-16','2026-09-16','2026-11-17','2027-01-19'],
  6: ['2026-03-18','2026-05-20','2026-07-17','2026-09-17','2026-11-18','2027-01-20'],
  7: ['2026-03-19','2026-05-21','2026-07-20','2026-09-18','2026-11-19','2027-01-21'],
  8: ['2026-03-20','2026-05-22','2026-07-21','2026-09-21','2026-11-20','2027-01-22'],
  9: ['2026-03-23','2026-05-25','2026-07-22','2026-09-22','2026-11-23','2027-01-23'],
};

const PERIODOS_IVA = ['Ene-Feb', 'Mar-Abr', 'May-Jun', 'Jul-Ago', 'Sep-Oct', 'Nov-Dic'];

const VENCIMIENTOS_RETEFUENTE_2026: Record<number, string[]> = {
  0: ['2026-02-10','2026-03-10','2026-04-09','2026-05-12','2026-06-09','2026-07-09','2026-08-11','2026-09-09','2026-10-08','2026-11-10','2026-12-09','2027-01-12'],
  1: ['2026-02-11','2026-03-11','2026-04-10','2026-05-13','2026-06-10','2026-07-10','2026-08-12','2026-09-10','2026-10-09','2026-11-11','2026-12-10','2027-01-13'],
  2: ['2026-02-12','2026-03-12','2026-04-13','2026-05-14','2026-06-11','2026-07-13','2026-08-13','2026-09-11','2026-10-13','2026-11-12','2026-12-11','2027-01-14'],
  3: ['2026-02-13','2026-03-13','2026-04-14','2026-05-15','2026-06-12','2026-07-14','2026-08-14','2026-09-14','2026-10-14','2026-11-13','2026-12-14','2027-01-15'],
  4: ['2026-02-16','2026-03-16','2026-04-15','2026-05-18','2026-06-15','2026-07-15','2026-08-17','2026-09-15','2026-10-15','2026-11-16','2026-12-15','2027-01-16'],
  5: ['2026-02-17','2026-03-17','2026-04-16','2026-05-19','2026-06-16','2026-07-16','2026-08-18','2026-09-16','2026-10-16','2026-11-17','2026-12-16','2027-01-19'],
  6: ['2026-02-18','2026-03-18','2026-04-17','2026-05-20','2026-06-17','2026-07-17','2026-08-19','2026-09-17','2026-10-19','2026-11-18','2026-12-17','2027-01-20'],
  7: ['2026-02-19','2026-03-19','2026-04-20','2026-05-21','2026-06-18','2026-07-20','2026-08-20','2026-09-18','2026-10-20','2026-11-19','2026-12-18','2027-01-21'],
  8: ['2026-02-20','2026-03-20','2026-04-21','2026-05-22','2026-06-19','2026-07-21','2026-08-21','2026-09-21','2026-10-21','2026-11-20','2026-12-21','2027-01-22'],
  9: ['2026-02-23','2026-03-23','2026-04-22','2026-05-25','2026-06-22','2026-07-22','2026-08-24','2026-09-22','2026-10-22','2026-11-23','2026-12-22','2027-01-23'],
};

import { MONTH_LABELS as MESES_RETEFUENTE } from '@/lib/constants';

// Renta personas jurídicas 2026 (declaración año gravable 2025)
const VENCIMIENTOS_RENTA_2026: Record<number, string> = {
  0: '2026-04-14', 1: '2026-04-15', 2: '2026-04-16',
  3: '2026-04-17', 4: '2026-04-20', 5: '2026-04-21',
  6: '2026-04-22', 7: '2026-04-23', 8: '2026-04-24',
  9: '2026-04-27',
};

interface Obligacion {
  id: string;
  tipo: 'iva' | 'retefuente' | 'renta' | 'ica';
  descripcion: string;
  fecha: Date;
  periodo: string;
  completada?: boolean;
}

function diasRestantes(fecha: Date): number {
  return Math.ceil((fecha.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function getEstado(dias: number, completada: boolean): 'completada' | 'vencida' | 'urgente' | 'proxima' | 'ok' {
  if (completada) return 'completada';
  if (dias < 0) return 'vencida';
  if (dias <= 15) return 'urgente';
  if (dias <= 45) return 'proxima';
  return 'ok';
}

const ESTADO_CONFIG = {
  completada: { label: 'Listo, cumpliste', color: 'bg-green-100 text-green-700', icon: CheckCircle, iconColor: 'text-green-500' },
  vencida: { label: '¡Vencida!', color: 'bg-red-100 text-red-700', icon: AlertTriangle, iconColor: 'text-red-500' },
  urgente: { label: '¡Apriétese los pantalones!', color: 'bg-orange-100 text-orange-700', icon: AlertTriangle, iconColor: 'text-orange-500' },
  proxima: { label: 'Ya casi', color: 'bg-yellow-100 text-yellow-700', icon: Clock, iconColor: 'text-yellow-500' },
  ok: { label: 'Tranquilo, hay chance', color: 'bg-muted text-muted-foreground', icon: Calendar, iconColor: 'text-muted-foreground' },
};

const TIPO_LABELS = {
  iva: 'IVA Bimestral',
  retefuente: 'Retención en la Fuente',
  renta: 'Declaración de Renta',
  ica: 'ICA',
};

export default function CalendarioTributario() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [nitDigit, setNitDigit] = useState<number | null>(null);
  const [nitInput, setNitInput] = useState('');
  const [completadas, setCompletadas] = useState<Set<string>>(new Set());
  const [mostrarTodas, setMostrarTodas] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<'todas' | 'iva' | 'retefuente' | 'renta'>('todas');

  // Cargar NIT guardado del perfil
  useQuery({
    queryKey: ['profile-nit', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('profiles')
        .select('reteica_city')
        .eq('user_id', user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user?.id,
  });

  const obligaciones: Obligacion[] = useMemo(() => {
    if (nitDigit === null) return [];
    const digit = nitDigit;
    const result: Obligacion[] = [];

    // IVA Bimestral
    VENCIMIENTOS_IVA_2026[digit]?.forEach((fecha, i) => {
      result.push({
        id: `iva-${i}`,
        tipo: 'iva',
        descripcion: `IVA Bimestral — Período ${PERIODOS_IVA[i]} 2026`,
        fecha: new Date(fecha),
        periodo: PERIODOS_IVA[i],
      });
    });

    // Retención en la Fuente (mensual)
    VENCIMIENTOS_RETEFUENTE_2026[digit]?.forEach((fecha, i) => {
      result.push({
        id: `ret-${i}`,
        tipo: 'retefuente',
        descripcion: `Retención en la Fuente — ${MESES_RETEFUENTE[i]} 2025`,
        fecha: new Date(fecha),
        periodo: MESES_RETEFUENTE[i],
      });
    });

    // Renta
    const rentaFecha = VENCIMIENTOS_RENTA_2026[digit];
    if (rentaFecha) {
      result.push({
        id: 'renta-2025',
        tipo: 'renta',
        descripcion: 'Declaración de Renta — Año gravable 2025',
        fecha: new Date(rentaFecha),
        periodo: '2025',
      });
    }

    return result.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  }, [nitDigit]);

  const filtradas = obligaciones.filter(o => filtroTipo === 'todas' || o.tipo === filtroTipo);
  const proximas = filtradas.filter(o => {
    const dias = diasRestantes(o.fecha);
    return dias >= -30 && dias <= 90;
  });
  const mostradas = mostrarTodas ? filtradas : proximas.slice(0, 8);

  const urgentes = obligaciones.filter(o => {
    const d = diasRestantes(o.fecha);
    return d >= 0 && d <= 15 && !completadas.has(o.id);
  });

  const handleNit = () => {
    const nit = nitInput.replace(/\D/g, '');
    if (nit.length > 0) {
      setNitDigit(parseInt(nit[nit.length - 1]));
    }
  };

  const toggleCompletada = (id: string) => {
    setCompletadas(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      {/* Configurar NIT */}
      {nitDigit === null ? (
        <Card className="border-dashed">
          <CardContent className="pt-6 pb-6">
            <div className="flex flex-col items-center text-center gap-3">
              <Calendar className="h-10 w-10 text-muted-foreground/40" />
              <div>
                <p className="font-medium text-foreground">Configurá tu NIT para ver el calendario</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Las fechas de vencimiento dependen del último dígito de tu NIT según la DIAN.
                </p>
              </div>
              <div className="flex gap-2 mt-2">
                <Input
                  placeholder="Ej: 900.123.456-7"
                  value={nitInput}
                  onChange={e => setNitInput(e.target.value)}
                  className="w-52"
                  onKeyDown={e => e.key === 'Enter' && handleNit()}
                />
                <Button onClick={handleNit} disabled={!nitInput.trim()}>Ver calendario</Button>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" />
                Solo se usa el último dígito — tus datos no se guardan
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Resumen urgentes */}
          {urgentes.length > 0 && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">
                  {urgentes.length} obligación{urgentes.length > 1 ? 'es' : ''} vencen en los próximos 15 días
                </p>
              </div>
              <div className="space-y-1">
                {urgentes.map(o => (
                  <p key={o.id} className="text-xs text-orange-600 dark:text-orange-400">
                    • {o.descripcion} — {o.fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })} ({diasRestantes(o.fecha)} días)
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Filtros */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Filtrar:</span>
            {(['todas', 'iva', 'retefuente', 'renta'] as const).map(t => (
              <button
                key={t}
                onClick={() => setFiltroTipo(t)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  filtroTipo === t ? 'bg-foreground text-background border-foreground' : 'border-border hover:bg-muted'
                }`}
              >
                {t === 'todas' ? 'Todas' : TIPO_LABELS[t]}
              </button>
            ))}
            <button
              onClick={() => setNitDigit(null)}
              className="text-xs text-muted-foreground hover:text-foreground ml-auto"
            >
              Cambiar NIT
            </button>
          </div>

          {/* Lista de obligaciones */}
          <div className="space-y-2">
            {mostradas.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">No hay obligaciones próximas en este período.</p>
            ) : (
              mostradas.map(o => {
                const dias = diasRestantes(o.fecha);
                const estado = getEstado(dias, completadas.has(o.id));
                const cfg = ESTADO_CONFIG[estado];
                const Icon = cfg.icon;
                return (
                  <div
                    key={o.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-opacity ${
                      completadas.has(o.id) ? 'opacity-50' : ''
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${cfg.iconColor}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${completadas.has(o.id) ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                        {o.descripcion}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {o.fecha.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                        {!completadas.has(o.id) && dias >= 0 && ` · ${dias === 0 ? '¡Hoy!' : `${dias} días`}`}
                        {!completadas.has(o.id) && dias < 0 && ` · Venció hace ${Math.abs(dias)} días`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={`text-[10px] ${cfg.color}`}>{cfg.label}</Badge>
                      <button
                        onClick={() => toggleCompletada(o.id)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          completadas.has(o.id)
                            ? 'bg-green-500 border-green-500'
                            : 'border-muted-foreground/30 hover:border-green-500'
                        }`}
                      >
                        {completadas.has(o.id) && <CheckCircle className="h-3 w-3 text-white" />}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Ver más / menos */}
          {filtradas.length > 8 && (
            <button
              onClick={() => setMostrarTodas(!mostrarTodas)}
              className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground py-2 border rounded-lg"
            >
              {mostrarTodas ? (
                <><ChevronUp className="h-3 w-3" /> Ver menos</>
              ) : (
                <><ChevronDown className="h-3 w-3" /> Ver todas las obligaciones ({filtradas.length})</>
              )}
            </button>
          )}

          <p className="text-xs text-muted-foreground italic flex items-center gap-1">
            <Info className="h-3 w-3" />
            Fechas basadas en el Calendario Tributario DIAN 2026. Verificá con tu contador ante cambios normativos.
          </p>
        </>
      )}
    </div>
  );
}
