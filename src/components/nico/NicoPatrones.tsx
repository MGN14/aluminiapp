import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { TrendingUp, TrendingDown, AlertTriangle, Info, Package, Users, Receipt, Repeat, BarChart2, ChevronRight, Zap } from 'lucide-react';

interface Patron {
  id: string;
  tipo: 'financiero' | 'fiscal' | 'operativo' | 'cliente' | 'inventario';
  titulo: string;
  descripcion: string;
  severidad: 'info' | 'warning' | 'alert';
  confianza: number;
  preguntaNico?: string;
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(Math.round(v));
}

const TIPO_CONFIG = {
  financiero: { label: 'Financiero', icon: BarChart2, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/20' },
  fiscal: { label: 'Fiscal', icon: Receipt, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/20' },
  operativo: { label: 'Operativo', icon: Repeat, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/20' },
  cliente: { label: 'Clientes', icon: Users, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950/20' },
  inventario: { label: 'Inventario', icon: Package, color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-950/20' },
};

const SEV_CONFIG = {
  info: { icon: Info, color: 'text-blue-500' },
  warning: { icon: AlertTriangle, color: 'text-yellow-500' },
  alert: { icon: AlertTriangle, color: 'text-red-500' },
};

export default function NicoPatrones({ onPreguntarNico }: { onPreguntarNico?: (pregunta: string) => void }) {
  const { user } = useAuth();
  const currentYear = new Date().getFullYear();
  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  // Patrones guardados por Nico en DB
  const { data: nicoPatterns = [] } = useQuery({
    queryKey: ['business-patterns', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('business_patterns')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('confidence', { ascending: false });
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Transacciones del año actual y anterior
  const { data: transactions = [] } = useQuery({
    queryKey: ['patrones-tx', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('transactions')
        .select('date, amount, description, category_id, type, categories!transactions_category_id_fkey(name, report_group)')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .gte('date', `${currentYear - 1}-01-01`)
        .order('date', { ascending: true });
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Facturas de venta del año
  const { data: invoices = [] } = useQuery({
    queryKey: ['patrones-invoices', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('invoices')
        .select('id, invoice_number, issue_date, total_amount, counterparty_name, status, type')
        .eq('user_id', user.id)
        .eq('type', 'venta')
        .gte('issue_date', `${currentYear - 1}-01-01`);
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Inventario
  const { data: inventory = [] } = useQuery({
    queryKey: ['patrones-inv', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('inventory_products')
        .select('id, name, reference, stock_system, stock_physical, cost_per_unit, min_stock, last_count_date')
        .eq('user_id', user.id)
        .eq('active', true);
      return data || [];
    },
    enabled: !!user?.id,
  });

  const patrones: Patron[] = useMemo(() => {
    const resultado: Patron[] = [];
    const txAnio = transactions.filter((tx: any) => new Date(tx.date).getFullYear() === currentYear);
    const txAnioAnterior = transactions.filter((tx: any) => new Date(tx.date).getFullYear() === currentYear - 1);

    // ── PATRONES DESDE business_patterns DE NICO ──────────────
    nicoPatterns.forEach((p: any) => {
      const tipo = p.pattern_type?.includes('tax') || p.pattern_type?.includes('fiscal') ? 'fiscal'
        : p.pattern_type?.includes('client') || p.pattern_type?.includes('provider') ? 'cliente'
        : p.pattern_type?.includes('inventory') ? 'inventario'
        : p.pattern_type?.includes('anomal') ? 'operativo'
        : 'financiero';
      resultado.push({
        id: p.id,
        tipo,
        titulo: p.pattern_type?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Patrón detectado',
        descripcion: p.description,
        severidad: p.confidence >= 0.8 ? 'alert' : p.confidence >= 0.5 ? 'warning' : 'info',
        confianza: Math.round(p.confidence * 100),
        preguntaNico: `Cuéntame más sobre este patrón: ${p.description}`,
      });
    });

    // ── PATRONES CALCULADOS LOCALMENTE ────────────────────────

    // 1. Estacionalidad mensual (ingresos)
    const monthlyIngresos = new Array(12).fill(0);
    const monthlyEgresos = new Array(12).fill(0);
    txAnio.forEach((tx: any) => {
      const m = new Date(tx.date).getMonth();
      if ((tx.amount || 0) > 0) monthlyIngresos[m] += tx.amount;
      else monthlyEgresos[m] += Math.abs(tx.amount || 0);
    });
    const avgIng = monthlyIngresos.filter(v => v > 0).reduce((a, b) => a + b, 0) / (monthlyIngresos.filter(v => v > 0).length || 1);
    const mesAltoIng = monthlyIngresos.indexOf(Math.max(...monthlyIngresos));
    const mesBajoIng = monthlyIngresos.filter(v => v > 0).length > 0
      ? monthlyIngresos.map((v, i) => ({ v, i })).filter(x => x.v > 0).sort((a, b) => a.v - b.v)[0]?.i
      : -1;
    if (avgIng > 0 && mesAltoIng >= 0) {
      const varAlto = ((monthlyIngresos[mesAltoIng] - avgIng) / avgIng) * 100;
      if (varAlto > 30) {
        resultado.push({
          id: 'estacionalidad-alta',
          tipo: 'financiero',
          titulo: 'Pico estacional de ingresos',
          descripcion: `${MESES[mesAltoIng]} es tu mejor mes del año — ${varAlto.toFixed(0)}% por encima del promedio mensual (${formatCurrency(monthlyIngresos[mesAltoIng])}). Considerá anticipar inversiones o provisiones en ese período.`,
          severidad: 'info',
          confianza: Math.min(90, Math.round(varAlto)),
          preguntaNico: `¿Por qué ${MESES[mesAltoIng]} es mi mejor mes y cómo puedo aprovechar ese pico?`,
        });
      }
    }
    if (mesBajoIng !== undefined && mesBajoIng >= 0 && avgIng > 0) {
      const varBajo = ((monthlyIngresos[mesBajoIng] - avgIng) / avgIng) * 100;
      if (varBajo < -25) {
        resultado.push({
          id: 'estacionalidad-baja',
          tipo: 'financiero',
          titulo: 'Valle estacional de ingresos',
          descripcion: `${MESES[mesBajoIng]} es consistentemente tu mes más bajo — ${Math.abs(varBajo).toFixed(0)}% por debajo del promedio (${formatCurrency(monthlyIngresos[mesBajoIng])}). Planificá liquidez para ese período.`,
          severidad: 'warning',
          confianza: 75,
          preguntaNico: `¿Cómo debería prepararme financieramente para el bajo volumen de ${MESES[mesBajoIng]}?`,
        });
      }
    }

    // 2. Crecimiento vs año anterior
    const ingAnio = txAnio.filter((tx: any) => (tx.amount || 0) > 0).reduce((s: number, tx: any) => s + tx.amount, 0);
    const ingAnioAnt = txAnioAnterior.filter((tx: any) => (tx.amount || 0) > 0).reduce((s: number, tx: any) => s + tx.amount, 0);
    if (ingAnioAnt > 0 && ingAnio > 0) {
      const crecimiento = ((ingAnio - ingAnioAnt) / ingAnioAnt) * 100;
      if (Math.abs(crecimiento) > 10) {
        resultado.push({
          id: 'crecimiento-anual',
          tipo: 'financiero',
          titulo: crecimiento > 0 ? 'Crecimiento de ingresos año a año' : 'Caída de ingresos año a año',
          descripcion: `Tus ingresos ${currentYear} van ${crecimiento > 0 ? 'un' : 'un'} ${Math.abs(crecimiento).toFixed(1)}% ${crecimiento > 0 ? 'por encima' : 'por debajo'} del mismo período en ${currentYear - 1}. Acumulado: ${formatCurrency(ingAnio)} vs ${formatCurrency(ingAnioAnt)}.`,
          severidad: crecimiento > 0 ? 'info' : crecimiento > -20 ? 'warning' : 'alert',
          confianza: 95,
          preguntaNico: `¿Qué factores explican la ${crecimiento > 0 ? 'mejora' : 'caída'} del ${Math.abs(crecimiento).toFixed(1)}% en ingresos vs el año anterior?`,
        });
      }
    }

    // 3. Categorías de gasto con mayor peso
    const categorias: Record<string, number> = {};
    txAnio.forEach((tx: any) => {
      if ((tx.amount || 0) < 0) {
        const cat = (tx.categories as any)?.name || 'Sin categoría';
        categorias[cat] = (categorias[cat] || 0) + Math.abs(tx.amount || 0);
      }
    });
    const totalEgr = Object.values(categorias).reduce((a, b) => a + b, 0);
    const topCats = Object.entries(categorias).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topCats.length > 0 && totalEgr > 0) {
      const [catNombre, catMonto] = topCats[0];
      const pct = (catMonto / totalEgr) * 100;
      if (pct > 30) {
        resultado.push({
          id: 'categoria-dominante',
          tipo: 'operativo',
          titulo: 'Categoría de egreso dominante',
          descripcion: `"${catNombre}" representa el ${pct.toFixed(0)}% de todos tus egresos (${formatCurrency(catMonto)}). Una concentración tan alta puede ser un riesgo si ese gasto escala o es difícil de reducir.`,
          severidad: pct > 50 ? 'alert' : 'warning',
          confianza: 90,
          preguntaNico: `¿Cómo puedo optimizar mis gastos en "${catNombre}" que representan el ${pct.toFixed(0)}% de mis egresos?`,
        });
      }
    }

    // 4. Margen operativo
    const egresosAnio = txAnio.filter((tx: any) => (tx.amount || 0) < 0).reduce((s: number, tx: any) => s + Math.abs(tx.amount || 0), 0);
    if (ingAnio > 0) {
      const margen = ((ingAnio - egresosAnio) / ingAnio) * 100;
      if (margen < 10) {
        resultado.push({
          id: 'margen-bajo',
          tipo: 'financiero',
          titulo: 'Margen operativo bajo',
          descripcion: `Tu margen operativo actual es del ${margen.toFixed(1)}% — por debajo del 10% recomendado para empresas de distribución. Por cada $100 que ingresa, quedan $${margen.toFixed(1)} de utilidad.`,
          severidad: margen < 5 ? 'alert' : 'warning',
          confianza: 95,
          preguntaNico: `Mi margen operativo es del ${margen.toFixed(1)}%, ¿qué estrategias me recomiendas para mejorarlo?`,
        });
      } else if (margen > 25) {
        resultado.push({
          id: 'margen-alto',
          tipo: 'financiero',
          titulo: 'Margen operativo saludable',
          descripcion: `Tu margen operativo es del ${margen.toFixed(1)}% — por encima del promedio del sector. Significa que de cada $100 que ingresan, quedan $${margen.toFixed(1)} de utilidad neta.`,
          severidad: 'info',
          confianza: 95,
          preguntaNico: `¿Cómo puedo mantener y aprovechar mi margen operativo del ${margen.toFixed(1)}%?`,
        });
      }
    }

    // 5. Clientes recurrentes (desde facturas)
    const clienteMap: Record<string, number> = {};
    invoices.forEach((inv: any) => {
      if (inv.counterparty_name) clienteMap[inv.counterparty_name] = (clienteMap[inv.counterparty_name] || 0) + (inv.total_amount || 0);
    });
    const topClientes = Object.entries(clienteMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const totalFacturado = Object.values(clienteMap).reduce((a, b) => a + b, 0);
    if (topClientes.length > 0 && totalFacturado > 0) {
      const [cli1, monto1] = topClientes[0];
      const pctCli1 = (monto1 / totalFacturado) * 100;
      if (pctCli1 > 40) {
        resultado.push({
          id: 'concentracion-cliente',
          tipo: 'cliente',
          titulo: 'Alta concentración en un cliente',
          descripcion: `${cli1} representa el ${pctCli1.toFixed(0)}% de tu facturación total (${formatCurrency(monto1)}). Depender tanto de un solo cliente es un riesgo financiero — si deja de comprarte, el impacto sería inmediato.`,
          severidad: pctCli1 > 60 ? 'alert' : 'warning',
          confianza: 90,
          preguntaNico: `¿Qué estrategia me recomiendas para reducir mi dependencia del ${pctCli1.toFixed(0)}% de ventas que concentro en ${cli1}?`,
        });
      }
      if (topClientes.length >= 3) {
        const top3Pct = topClientes.slice(0, 3).reduce((s, [, v]) => s + (v / totalFacturado) * 100, 0);
        if (top3Pct > 70) {
          resultado.push({
            id: 'concentracion-top3',
            tipo: 'cliente',
            titulo: 'Top 3 clientes concentran el negocio',
            descripcion: `Tus 3 principales clientes (${topClientes.map(([n]) => n).join(', ')}) representan el ${top3Pct.toFixed(0)}% de tu facturación. Diversificar tu cartera reduciría el riesgo.`,
            severidad: 'warning',
            confianza: 85,
            preguntaNico: `¿Cómo puedo diversificar mi cartera de clientes siendo que el ${top3Pct.toFixed(0)}% está concentrado en 3 clientes?`,
          });
        }
      }
    }

    // 6. Inventario inmovilizado
    const invInmov = inventory.filter((p: any) => {
      if (!p.last_count_date) return true;
      const dias = (Date.now() - new Date(p.last_count_date).getTime()) / (1000 * 60 * 60 * 24);
      return dias > 45;
    });
    const valorInmov = invInmov.reduce((s: number, p: any) => s + (p.stock_system || 0) * (p.cost_per_unit || 0), 0);
    if (invInmov.length > 0 && valorInmov > 0) {
      resultado.push({
        id: 'inventario-inmov',
        tipo: 'inventario',
        titulo: 'Capital inmovilizado en inventario',
        descripcion: `${invInmov.length} productos (${formatCurrency(valorInmov)}) llevan más de 45 días sin movimiento. Este capital podría estar generando rendimiento si se rotara o liquidara con descuento.`,
        severidad: valorInmov > 50000000 ? 'alert' : 'warning',
        confianza: 80,
        preguntaNico: `¿Qué estrategia me recomendás para rotar o liquidar los ${invInmov.length} productos sin movimiento por ${formatCurrency(valorInmov)}?`,
      });
    }

    // 7. Stock por debajo del mínimo
    const bajoMinimo = inventory.filter((p: any) => p.stock_system < p.min_stock && p.min_stock > 0);
    if (bajoMinimo.length > 0) {
      resultado.push({
        id: 'stock-minimo',
        tipo: 'inventario',
        titulo: 'Productos bajo stock mínimo',
        descripcion: `${bajoMinimo.length} producto${bajoMinimo.length > 1 ? 's' : ''} (${bajoMinimo.slice(0, 3).map((p: any) => p.name).join(', ')}${bajoMinimo.length > 3 ? '...' : ''}) están por debajo del stock mínimo definido. Riesgo de quiebre de stock.`,
        severidad: bajoMinimo.length > 5 ? 'alert' : 'warning',
        confianza: 95,
        preguntaNico: `¿Cuándo debería reponer los ${bajoMinimo.length} productos bajo stock mínimo y cuánto pedir?`,
      });
    }

    // 8. Transacciones sin categorizar
    const sinCat = txAnio.filter((tx: any) => !tx.category_id).length;
    const pctSinCat = txAnio.length > 0 ? (sinCat / txAnio.length) * 100 : 0;
    if (pctSinCat > 20) {
      resultado.push({
        id: 'sin-categoria',
        tipo: 'operativo',
        titulo: 'Alto porcentaje sin categorizar',
        descripcion: `El ${pctSinCat.toFixed(0)}% de tus transacciones (${sinCat} de ${txAnio.length}) no tienen categoría. Esto afecta la precisión de todos los reportes, el score DIAN y los análisis de Nico.`,
        severidad: pctSinCat > 40 ? 'alert' : 'warning',
        confianza: 100,
        preguntaNico: `¿Cuáles son las transacciones sin categorizar más importantes que debería clasificar primero?`,
      });
    }

    // 9. Flujo de caja negativo recurrente
    const mesesNegativos = monthlyIngresos
      .map((ing, i) => ({ mes: MESES[i], neto: ing - monthlyEgresos[i], i }))
      .filter(m => m.neto < 0 && (monthlyIngresos[m.i] > 0 || monthlyEgresos[m.i] > 0));
    if (mesesNegativos.length >= 2) {
      resultado.push({
        id: 'flujo-negativo',
        tipo: 'financiero',
        titulo: 'Meses con flujo de caja negativo',
        descripcion: `${mesesNegativos.map(m => m.mes).join(', ')} tuvieron resultado neto negativo este año. Si este patrón se repite, podría haber problemas de liquidez en esos períodos.`,
        severidad: mesesNegativos.length >= 3 ? 'alert' : 'warning',
        confianza: 90,
        preguntaNico: `¿Cómo puedo preparar el flujo de caja para los meses que históricamente son negativos (${mesesNegativos.map(m => m.mes).join(', ')})?`,
      });
    }

    // Ordenar: alert primero, luego warning, luego info; y por confianza
    const orden = { alert: 0, warning: 1, info: 2 };
    return resultado.sort((a, b) => orden[a.severidad] - orden[b.severidad] || b.confianza - a.confianza);
  }, [transactions, invoices, inventory, nicoPatterns, currentYear]);

  const tipos = Object.keys(TIPO_CONFIG) as (keyof typeof TIPO_CONFIG)[];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Zap className="h-3.5 w-3.5 text-accent" />
        <span><strong>{patrones.length} patrones</strong> detectados — {nicoPatterns.length} de Nico + {patrones.length - nicoPatterns.length} calculados</span>
      </div>

      {tipos.map(tipo => {
        const patronesTipo = patrones.filter(p => p.tipo === tipo);
        if (patronesTipo.length === 0) return null;
        const cfg = TIPO_CONFIG[tipo];
        const Icon = cfg.icon;
        return (
          <div key={tipo}>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg w-fit mb-3 ${cfg.bg}`}>
              <Icon className={`h-4 w-4 ${cfg.color}`} />
              <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
              <span className={`text-xs ${cfg.color} opacity-70`}>({patronesTipo.length})</span>
            </div>
            <div className="space-y-2">
              {patronesTipo.map(patron => {
                const SevIcon = SEV_CONFIG[patron.severidad].icon;
                return (
                  <div key={patron.id} className={`rounded-lg border p-3 ${
                    patron.severidad === 'alert' ? 'border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20' :
                    patron.severidad === 'warning' ? 'border-yellow-200 bg-yellow-50/50 dark:border-yellow-800 dark:bg-yellow-950/20' :
                    'border-border bg-muted/20'
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <SevIcon className={`h-4 w-4 shrink-0 mt-0.5 ${SEV_CONFIG[patron.severidad].color}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <p className="text-sm font-medium text-foreground">{patron.titulo}</p>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {patron.confianza}% confianza
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{patron.descripcion}</p>
                        </div>
                      </div>
                      {patron.preguntaNico && onPreguntarNico && (
                        <button
                          onClick={() => onPreguntarNico(patron.preguntaNico!)}
                          className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 shrink-0 font-medium transition-colors"
                        >
                          Preguntarle a Nico
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {patrones.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Necesito más datos de transacciones, facturas e inventario para detectar patrones.
        </div>
      )}
    </div>
  );
}
