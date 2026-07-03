import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AlertTriangle, Info, Package, Users, Receipt, Repeat, BarChart2, ChevronRight, Zap, Sparkles, CheckCircle2, Plus, Wrench, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useReconciliationRules, matchesRule, type ReconciliationRule } from '@/hooks/useReconciliationRules';
import CrearReglaModal, { ReglaPatronSugerido } from './CrearReglaModal';
import { MONTH_LABELS_SHORT } from '@/lib/constants';
import { useCounterpartyResolver, resolveCounterpartyName } from '@/lib/counterpartyResolver';
import { normalizeForMatch } from '@/lib/stringUtils';

interface Patron {
  id: string;
  tipo: 'financiero' | 'fiscal' | 'operativo' | 'cliente' | 'inventario';
  titulo: string;
  descripcion: string;
  severidad: 'info' | 'warning' | 'alert';
  confianza: number;
  preguntaNico?: string;
  automatable?: boolean;
  suggestedKeyword?: string;
  suggestedAmountMin?: number;
  suggestedAmountMax?: number;
  suggestedType?: 'ingreso' | 'egreso';
  suggestedCategoryId?: string;
  suggestedResponsibleId?: string;
  ocurrencias?: number;
}

/** Prefijo común más largo de un set de strings (para derivar keyword estable
 *  cuando las variantes difieren solo en números: "c manejo tarj deb 1015 06"). */
function commonPrefix(strings: string[]): string {
  if (!strings.length) return '';
  let prefix = strings[0];
  for (const s of strings.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}

/** Entrada con mayor conteo de un Map<key, count>. */
function topOf(map: Map<string, number>): [string | undefined, number] {
  let bestKey: string | undefined;
  let bestCount = 0;
  for (const [k, c] of map) {
    if (c > bestCount) { bestKey = k; bestCount = c; }
  }
  return [bestKey, bestCount];
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
  // Usa MONTH_LABELS_SHORT importado al top del archivo
  const MESES = MONTH_LABELS_SHORT;
  const { rules } = useReconciliationRules();
  const [reglaModal, setReglaModal] = useState<{ open: boolean; patron?: ReglaPatronSugerido; editRule?: ReconciliationRule }>({ open: false });
  const counterpartyResolver = useCounterpartyResolver();

  // Patrones guardados por Nico en DB
  const { data: nicoPatterns = [] } = useQuery({
    queryKey: ['business-patterns', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('business_patterns')
        .select('*')
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
        .select('date, amount, description, category_id, responsible_id, type, categories!transactions_category_id_fkey(name, report_group)')
        .is('deleted_at', null)
        .gte('date', `${currentYear - 1}-01-01`)
        .order('date', { ascending: true });
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Nombres de beneficiarios (para describir sugerencias de reglas)
  const { data: responsiblesList = [] } = useQuery({
    queryKey: ['patrones-responsibles', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase.from('responsibles').select('id, name');
      return (data || []) as { id: string; name: string }[];
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
        .select('id, invoice_number, issue_date, total_amount, counterparty_name, status, type, responsible_id')
        .eq('type', 'venta')
        // Excluir las anuladas totalmente por NC: Nico IA no debe alertar sobre patrones de facturas inválidas.
        .or('void_type.is.null,void_type.eq.partial')
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
      const confianza = Math.round(p.confidence * 100);
      const isRecurring = p.pattern_type?.includes('recurring') || p.pattern_type?.includes('expense') || p.pattern_type?.includes('subscription');
      resultado.push({
        id: p.id,
        tipo,
        titulo: p.pattern_type?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Patrón detectado',
        descripcion: p.description,
        severidad: p.confidence >= 0.8 ? 'alert' : p.confidence >= 0.5 ? 'warning' : 'info',
        confianza,
        preguntaNico: `Cuéntame más sobre este patrón: ${p.description}`,
        // All high-confidence DB patterns from Nico are candidates for automation rules
        automatable: confianza >= 90,
        suggestedType: isRecurring ? 'egreso' : undefined,
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
          // automatable: false — este es un INSIGHT estratégico, no una regla de matching.
          // El nombre de la categoría no aparece literalmente en descripciones bancarias,
          // así que crear una "regla" con keyword=categoría no matchearía nada.
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

    // 5. Clientes recurrentes (desde facturas) — resuelto via Beneficiarios
    const clienteMap: Record<string, number> = {};
    invoices.forEach((inv: any) => {
      const name = resolveCounterpartyName(inv.counterparty_name, inv.responsible_id, counterpartyResolver);
      if (name && name !== 'Sin identificar') {
        clienteMap[name] = (clienteMap[name] || 0) + (inv.total_amount || 0);
      }
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
        // automatable: false — métrica estadística, no es matcheable a regla.
        // Para arreglar esto, el user debe ir a /transactions y categorizar manualmente.
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

    // Filtro: ocultar patrones con confianza menor al 30%
    const filtrado = resultado.filter(p => p.confianza >= 30);
    // Ordenar: alert primero, luego warning, luego info; y por confianza
    const orden = { alert: 0, warning: 1, info: 2 };
    return filtrado.sort((a, b) => orden[a.severidad] - orden[b.severidad] || b.confianza - a.confianza);
  }, [transactions, invoices, inventory, nicoPatterns, currentYear, counterpartyResolver]);

  // ── DETECTOR DE MOVIMIENTOS RECURRENTES → candidatas a regla ──────────────
  // El vacío que hacía que solo existieran 2 reglas: ninguno de los 9 análisis
  // miraba la recurrencia a nivel de transacción individual (4x1000, intereses,
  // comisiones). Agrupamos por descripción normalizada (dígitos colapsados para
  // que "C MANEJO TARJ DEB 1015 06 26" y "...07 26" sean el mismo concepto) y
  // derivamos de los datos reales: tipo (signo dominante), categoría y
  // beneficiario (si el usuario ya los venía asignando a mano consistentemente).
  const reglasSugeridas: Patron[] = useMemo(() => {
    if (!transactions.length) return [];
    const respNames = new Map(responsiblesList.map(r => [r.id, r.name]));

    type Grupo = {
      variants: Map<string, number>;
      count: number;
      ingresos: number;
      egresos: number;
      cats: Map<string, number>;
      catNames: Map<string, string>;
      resps: Map<string, number>;
      totalAbs: number;
    };
    const grupos = new Map<string, Grupo>();

    for (const tx of transactions as any[]) {
      const raw = (tx.description ?? '').trim();
      if (!raw) continue;
      const norm = normalizeForMatch(raw);
      const key = norm.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
      if (key.replace(/[^a-z]/g, '').length < 4) continue;
      const g = grupos.get(key) ?? {
        variants: new Map(), count: 0, ingresos: 0, egresos: 0,
        cats: new Map(), catNames: new Map(), resps: new Map(), totalAbs: 0,
      };
      g.count++;
      g.variants.set(norm, (g.variants.get(norm) ?? 0) + 1);
      if ((tx.amount ?? 0) >= 0) g.ingresos++; else g.egresos++;
      g.totalAbs += Math.abs(tx.amount ?? 0);
      if (tx.category_id) {
        g.cats.set(tx.category_id, (g.cats.get(tx.category_id) ?? 0) + 1);
        const cname = (tx.categories as any)?.name;
        if (cname) g.catNames.set(tx.category_id, cname);
      }
      if (tx.responsible_id) g.resps.set(tx.responsible_id, (g.resps.get(tx.responsible_id) ?? 0) + 1);
      grupos.set(key, g);
    }

    const out: Patron[] = [];
    for (const [key, g] of grupos) {
      // 2+ apariciones alcanzan para proponer — el usuario decide si le basta
      // (umbral de confianza 60%, decisión de Nico 2026-07-03).
      if (g.count < 2) continue;
      // Mixto ingreso/egreso (>20% del lado minoritario) → descripción genérica
      // tipo "TRANSFERENCIA": una regla la clasificaría mal. Se descarta.
      if (Math.min(g.ingresos, g.egresos) / g.count > 0.2) continue;
      const tipo: 'ingreso' | 'egreso' = g.egresos >= g.ingresos ? 'egreso' : 'ingreso';

      // Keyword: la variante única, o el prefijo común si difieren en números.
      const variantes = [...g.variants.keys()];
      const keyword = (variantes.length === 1 ? variantes[0] : commonPrefix(variantes)).trim();
      if (keyword.replace(/[^a-z0-9]/g, '').length < 4) continue;

      const [topCat, topCatCount] = topOf(g.cats);
      const [topResp, topRespCount] = topOf(g.resps);
      const catConsistente = !!topCat && topCatCount / g.count >= 0.6;
      const respConsistente = !!topResp && topRespCount / g.count >= 0.6;

      const confianza = Math.min(98, 55 + g.count * 6 + (catConsistente || respConsistente ? 12 : 0));
      if (confianza < 60) continue;

      const catName = catConsistente && topCat ? g.catNames.get(topCat) : undefined;
      const respName = respConsistente && topResp ? respNames.get(topResp) : undefined;
      const yaClasificado = catConsistente || respConsistente;

      out.push({
        id: `recurrente-${key}`,
        tipo: 'operativo',
        titulo: `"${keyword.toUpperCase()}" se repite ${g.count} veces`,
        descripcion:
          `${tipo === 'egreso' ? 'Egreso' : 'Ingreso'} recurrente por ${formatCurrency(g.totalAbs)} acumulado. ` +
          (yaClasificado
            ? `Lo venís clasificando a mano${catName ? ` como "${catName}"` : ''}${respName ? ` → ${respName}` : ''}. Una regla lo haría sola en cada extracto.`
            : 'Crea una regla para que Nico lo concilie automáticamente en cada extracto.'),
        severidad: 'info',
        confianza,
        automatable: true,
        suggestedKeyword: keyword,
        suggestedType: tipo,
        suggestedCategoryId: catConsistente ? topCat : undefined,
        suggestedResponsibleId: respConsistente ? topResp : undefined,
        ocurrencias: g.count,
      });
    }
    return out
      .sort((a, b) => (b.ocurrencias ?? 0) - (a.ocurrencias ?? 0))
      .slice(0, 10);
  }, [transactions, responsiblesList]);

  // ── DETECTOR DE REGLAS MAL CONFIGURADAS (tipo invertido) ──────────────────
  // Caso real: regla "Intereses" creada como egreso (default del modal) pero
  // "ABONO INTERESES AHORROS" es un ingreso → nunca matchea y parece que "las
  // reglas no funcionan". Si la keyword de una regla activa matchea 3+ TX del
  // tipo OPUESTO y 0 del tipo configurado, la marcamos para corregir.
  const reglasMalConfiguradas = useMemo(() => {
    if (!rules.length || !transactions.length) return [] as { rule: ReconciliationRule; matches: number; tipoReal: 'ingreso' | 'egreso' }[];
    const out: { rule: ReconciliationRule; matches: number; tipoReal: 'ingreso' | 'egreso' }[] = [];
    for (const r of rules) {
      if (!r.active || !r.keyword) continue;
      const tipoOpuesto: 'ingreso' | 'egreso' = r.tx_type === 'egreso' ? 'ingreso' : 'egreso';
      const flipped = { ...r, tx_type: tipoOpuesto };
      let asIs = 0;
      let flip = 0;
      for (const tx of transactions as any[]) {
        const t = { description: tx.description ?? '', amount: tx.amount, date: tx.date };
        if (matchesRule(r, t)) asIs++;
        else if (matchesRule(flipped, t)) flip++;
      }
      if (asIs === 0 && flip >= 3) out.push({ rule: r, matches: flip, tipoReal: tipoOpuesto });
    }
    return out;
  }, [rules, transactions]);

  const tipos = Object.keys(TIPO_CONFIG) as (keyof typeof TIPO_CONFIG)[];

  // Helper: check if a pattern already has a saved rule. Antes el match por
  // keyword era strict equality; si el usuario editaba la palabra clave al
  // guardar, el patrón seguía apareciendo como sugerencia "nueva". Ahora
  // matcheamos por:
  //   1. pattern_ref exacto (la regla referencia el patrón)
  //   2. titulo del patrón vs nombre de la regla (substring, case-insensitive)
  //   3. keyword del patrón contenido en el keyword de la regla (o viceversa)
  const hasExistingRule = (p: Patron) => {
    const sugKw = p.suggestedKeyword?.trim().toLowerCase();
    const titulo = p.titulo?.trim().toLowerCase() ?? '';
    return rules.some(r => {
      if (r.pattern_ref && r.pattern_ref === p.id) return true;
      const ruleKw = r.keyword?.trim().toLowerCase() ?? '';
      if (sugKw && ruleKw && (ruleKw.includes(sugKw) || sugKw.includes(ruleKw))) return true;
      const ruleName = r.name?.trim().toLowerCase() ?? '';
      if (titulo && ruleName && (ruleName.includes(titulo) || titulo.includes(ruleName))) return true;
      return false;
    });
  };

  // Reglas sugeridas = recurrencias detectadas + patrones automatables de Nico.
  // Umbral 60%: se muestra todo lo que tenga chance razonable y el usuario
  // decide si le basta para crear la regla. Excluye las que ya tienen regla.
  const sugerencias = [
    ...reglasSugeridas.filter(p => !hasExistingRule(p)),
    ...patrones.filter(p => p.automatable && p.confianza >= 60 && !hasExistingRule(p)),
  ];

  // High-confidence INSIGHTS (no son reglas — son análisis estratégicos).
  // Ej: "margen bajo", "concentración cliente", "categoría dominante".
  // Tienen confianza alta pero NO se convierten en regla; van con CTA distinto.
  const insightsClave = patrones.filter(p => !p.automatable && p.confianza >= 90);

  // IDs de patrones ya mostrados arriba en "alta confianza" — para deduplicar abajo
  const sugerenciasIds = new Set([...sugerencias.map(p => p.id), ...insightsClave.map(p => p.id)]);

  const activeRulesCount = rules.filter(r => r.active).length;

  const openCrearRegla = (p: Patron) => {
    setReglaModal({
      open: true,
      patron: {
        id: p.id,
        titulo: p.titulo,
        descripcion: p.descripcion,
        confianza: p.confianza,
        suggestedKeyword: p.suggestedKeyword,
        suggestedAmountMin: p.suggestedAmountMin,
        suggestedAmountMax: p.suggestedAmountMax,
        suggestedType: p.suggestedType,
        suggestedCategoryId: p.suggestedCategoryId,
        suggestedResponsibleId: p.suggestedResponsibleId,
      },
    });
  };

  // Abre el modal en modo edición con el tipo YA corregido — el usuario
  // solo revisa y guarda (y al guardar se retro-aplica a las TX pendientes).
  const openCorregirRegla = (rule: ReconciliationRule, tipoReal: 'ingreso' | 'egreso') => {
    setReglaModal({ open: true, editRule: { ...rule, tx_type: tipoReal } });
  };

  return (
    <div className="space-y-5">
      {/* ── RESUMEN ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-black/[0.06] bg-gradient-to-br from-white to-slate-50/60 dark:from-zinc-900 dark:to-zinc-950 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            <Zap className="h-3 w-3 text-success" /> Reglas activas
          </div>
          <div className="text-[26px] leading-tight font-bold tabular-nums text-foreground">{activeRulesCount}</div>
          <div className="text-[11px] text-muted-foreground/70">conciliando solas</div>
        </div>
        <div className="rounded-xl border border-black/[0.06] bg-gradient-to-br from-white to-slate-50/60 dark:from-zinc-900 dark:to-zinc-950 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            <Sparkles className="h-3 w-3 text-success" /> Sugerencias
          </div>
          <div className="text-[26px] leading-tight font-bold tabular-nums" style={{ color: sugerencias.length > 0 ? 'oklch(0.43 0.14 155)' : undefined }}>
            {sugerencias.length}
          </div>
          <div className="text-[11px] text-muted-foreground/70">reglas por aprobar</div>
        </div>
        <div className="rounded-xl border border-black/[0.06] bg-gradient-to-br from-white to-slate-50/60 dark:from-zinc-900 dark:to-zinc-950 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            <BarChart2 className="h-3 w-3 text-accent" /> Insights
          </div>
          <div className="text-[26px] leading-tight font-bold tabular-nums text-foreground">{patrones.length}</div>
          <div className="text-[11px] text-muted-foreground/70">patrones analizados</div>
        </div>
      </div>

      {/* ── REGLAS MAL CONFIGURADAS ──────────────────────────────── */}
      {reglasMalConfiguradas.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 bg-destructive/10 border-b border-destructive/20">
            <div className="w-7 h-7 rounded-lg bg-destructive/20 flex items-center justify-center shrink-0">
              <Wrench className="h-4 w-4 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-destructive">
                {reglasMalConfiguradas.length} regla{reglasMalConfiguradas.length > 1 ? 's' : ''} con el tipo invertido
              </p>
              <p className="text-xs text-destructive/70">
                Su palabra clave coincide con movimientos del tipo contrario — por eso nunca se aplican
              </p>
            </div>
          </div>
          <div className="divide-y divide-destructive/10">
            {reglasMalConfiguradas.map(({ rule, matches, tipoReal }) => (
              <div key={rule.id} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-sm font-medium text-foreground">{rule.name}</span>
                    <Badge variant="outline" className="text-[10px] py-0 border-destructive/40 text-destructive">
                      configurada como {rule.tx_type}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    "{rule.keyword}" coincide con <strong>{matches} {tipoReal === 'ingreso' ? 'ingresos' : 'egresos'}</strong> reales
                    y con 0 {rule.tx_type === 'ingreso' ? 'ingresos' : 'egresos'} — debería ser tipo <strong>{tipoReal}</strong>.
                  </p>
                </div>
                <div className="shrink-0 pt-0.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:border-destructive"
                    onClick={() => openCorregirRegla(rule, tipoReal)}
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    Corregir a {tipoReal}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── REGLAS SUGERIDAS (recurrencias + patrones automatables) ── */}
      {sugerencias.length > 0 && (
        <div className="rounded-xl border border-success/30 bg-success/5 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 bg-success/10 border-b border-success/20">
            <div className="w-7 h-7 rounded-lg bg-success/20 flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4 text-success" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-success">
                {sugerencias.length} regla{sugerencias.length > 1 ? 's' : ''} sugerida{sugerencias.length > 1 ? 's' : ''} — solo falta tu aprobación
              </p>
              <p className="text-xs text-success/70">
                Detectadas de tus movimientos recurrentes. Al crearlas se aplican de inmediato a lo pendiente.
              </p>
            </div>
            <Badge variant="outline" className="border-success/40 text-success text-[10px] shrink-0">
              Nuevo
            </Badge>
          </div>

          {/* Suggestions list */}
          <div className="divide-y divide-success/10">
            {sugerencias.map(p => (
              <div key={p.id} className="flex items-start gap-3 px-4 py-3">
                <div className="mt-0.5 shrink-0">
                  {p.suggestedType === 'ingreso'
                    ? <ArrowUpCircle className="h-4 w-4 text-success" />
                    : <ArrowDownCircle className="h-4 w-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-sm font-medium text-foreground">{p.titulo}</span>
                    {p.suggestedType && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                        {p.suggestedType}
                      </span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/15 text-success font-medium">
                      {p.confianza}%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {p.descripcion}
                  </p>
                </div>
                <div className="shrink-0 pt-0.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1.5 border-success/40 text-success hover:bg-success/10 hover:border-success"
                    onClick={() => openCrearRegla(p)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Crear regla
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Footer: existing rules count */}
          {activeRulesCount > 0 && (
            <div className="px-4 py-2.5 bg-muted/30 border-t border-success/10 text-xs text-muted-foreground flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-success" />
              {activeRulesCount} regla{activeRulesCount > 1 ? 's' : ''} activa{activeRulesCount > 1 ? 's' : ''} — se aplican automáticamente al subir extracto
            </div>
          )}
        </div>
      )}

      {/* ── INSIGHTS ESTRATÉGICOS DE ALTA CONFIANZA ─────────────── */}
      {/* Misma anatomía que la sección de reglas sugeridas: card blanca,
          header con chip de ícono, lista divide-y, CTA como botón outline.
          Nada de texto en color accent sobre fondo accent (era ilegible). */}
      {insightsClave.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 bg-muted/40 border-b border-border">
            <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {insightsClave.length} insight{insightsClave.length > 1 ? 's' : ''} estratégico{insightsClave.length > 1 ? 's' : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                No son reglas — son análisis que requieren tu decisión
              </p>
            </div>
          </div>
          <div className="divide-y divide-border">
            {insightsClave.map(p => {
              const SevIcon = SEV_CONFIG[p.severidad].icon;
              return (
                <div key={p.id} className="flex items-start gap-3 px-4 py-3">
                  <SevIcon className={`h-4 w-4 shrink-0 mt-0.5 ${SEV_CONFIG[p.severidad].color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-sm font-medium text-foreground">{p.titulo}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                        {p.confianza}%
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{p.descripcion}</p>
                  </div>
                  {p.preguntaNico && onPreguntarNico && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1 shrink-0"
                      onClick={() => onPreguntarNico(p.preguntaNico!)}
                    >
                      Preguntarle a Nico
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── DEMÁS PATRONES, agrupados por tipo — misma card por grupo ── */}
      {tipos.map(tipo => {
        // Excluir tanto los que están arriba como los que ya tienen regla
        // creada — esos viven en el módulo Reglas, no en Patrones.
        const patronesTipo = patrones.filter(p => p.tipo === tipo && !sugerenciasIds.has(p.id) && !hasExistingRule(p));
        if (patronesTipo.length === 0) return null;
        const cfg = TIPO_CONFIG[tipo];
        const Icon = cfg.icon;
        return (
          <div key={tipo} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-muted/40 border-b border-border">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg}`}>
                <Icon className={`h-4 w-4 ${cfg.color}`} />
              </div>
              <p className="text-sm font-semibold text-foreground">
                {cfg.label}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">({patronesTipo.length})</span>
              </p>
            </div>
            <div className="divide-y divide-border">
              {patronesTipo.map(patron => {
                const SevIcon = SEV_CONFIG[patron.severidad].icon;
                return (
                  <div key={patron.id} className="flex items-start gap-3 px-4 py-3">
                    <SevIcon className={`h-4 w-4 shrink-0 mt-0.5 ${SEV_CONFIG[patron.severidad].color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-sm font-medium text-foreground">{patron.titulo}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                          {patron.confianza}%
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{patron.descripcion}</p>
                    </div>
                    {patron.preguntaNico && onPreguntarNico && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs gap-1 shrink-0"
                        onClick={() => onPreguntarNico(patron.preguntaNico!)}
                      >
                        Preguntarle a Nico
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {patrones.length === 0 && sugerencias.length === 0 && (
        <div className="text-center py-12 rounded-xl border border-dashed border-border">
          <Sparkles className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm font-medium text-foreground mb-1">Todavía no hay patrones</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Subí más extractos bancarios y facturas — con más movimiento, Nico detecta
            recurrencias y te sugiere reglas para conciliar solo.
          </p>
        </div>
      )}

      {/* Crear/editar Regla Modal (editRule = corrección de tipo invertido) */}
      <CrearReglaModal
        open={reglaModal.open}
        onClose={() => setReglaModal({ open: false })}
        patron={reglaModal.patron}
        editRule={reglaModal.editRule}
      />
    </div>
  );
}
