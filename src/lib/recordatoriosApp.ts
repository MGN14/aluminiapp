/**
 * Recordatorios de tareas que el usuario dejó de hacer EN LA APP.
 *
 * Nico (2026-11-12): "créame recordatorios de cosas que no he hecho en la
 * app: no he subido el inventario actualizado y hubo muchos movimientos, no
 * he actualizado facturas de venta, Siigo…". Las obligaciones con fecha
 * (DIAN, nómina, créditos) ya viven en "Próximas obligaciones"; esto es lo
 * otro: las tareas periódicas de alimentar la app que, si se olvidan, dejan
 * los números viejos sin que nadie lo note.
 *
 * Cada regla dispara SOLO si el módulo tiene historia (alguna vez se subió un
 * extracto, se contó el inventario, se cerró la caja…): a quien no usa un
 * módulo no se le regaña por él.
 *
 * Función pura (fechas como 'YYYY-MM-DD' y `hoy` explícito) para poder
 * probarla sin reloj ni base de datos.
 */
import { findCoverageGaps, findSeriesAtrasadas, type StatementPeriodLike } from './statementGaps';

export type NivelRecordatorio = 'alarm' | 'warn';

export interface Recordatorio {
  /** Estable: sirve para posponerlo. */
  id: 'siigo' | 'facturas-venta' | 'facturas-compra' | 'extractos' | 'inventario' | 'caja-menor';
  nivel: NivelRecordatorio;
  titulo: string;
  detalle: string;
  /** A dónde lleva el clic. */
  ruta: string;
  /** Verbo del botón: "Reconectar", "Subir conteo"… */
  accion: string;
  /** Permiso que necesita la ruta ('admin' = solo el dueño de la cuenta). */
  modulo: 'admin' | 'facturas_venta' | 'facturas_compra' | 'extractos' | 'inventarios' | 'caja_menor';
  /** Días de atraso, para ordenar (lo más viejo primero dentro del nivel). */
  dias: number;
}

export interface SenalesApp {
  /** Hoy, 'YYYY-MM-DD' (hora local). */
  hoy: string;
  /** Conexión con Siigo del dueño; null = nunca la configuró (o es colaborador).
   *  `errorDeClave`: Siigo rechazó usuario/access key (no se arregla reintentando). */
  siigo: { estado: string | null; errorDeClave?: boolean } | null;
  /** issue_date de la última factura de venta, o null si no hay ninguna. */
  ultimaVenta: string | null;
  /** issue_date de la última factura de compra, o null si no hay ninguna. */
  ultimaCompra: string | null;
  /** Períodos de los extractos subidos (no borrados). */
  extractos: StatementPeriodLike[];
  /** Cuentas que el usuario pidió no avisar (desde Conciliación). */
  extractosSilenciados: string[];
  /** Fecha del último conteo/cierre de inventario, o null si nunca se contó. */
  ultimoConteo: string | null;
  /** Movimientos de inventario (remisiones, contenedores, ajustes) posteriores al último conteo. */
  movimientosDesdeConteo: number;
  /** Movimientos de caja menor que todavía no entran en ningún cierre. */
  cajaSinCerrar: { movimientos: number; masViejo: string | null };
}

// ── Umbrales (días) ─────────────────────────────────────────────────────────

/** Una distribuidora factura casi a diario: 10 días sin ventas nuevas es raro. */
const DIAS_VENTAS_QUIETAS = 10;
const DIAS_VENTAS_ALARMA = 30;
/** Las compras llegan por el buzón; 20 días sin ninguna huele a buzón roto. */
const DIAS_COMPRAS_QUIETAS = 20;
/** Inventario: cuándo pedir un conteo nuevo. */
const DIAS_CONTEO_MIN = 30;
const MOVS_CONTEO_MIN = 50;
const DIAS_CONTEO_MAX = 60;
const DIAS_CONTEO_ALARMA = 90;
const MOVS_CONTEO_ALARMA = 300;
/** Caja menor: un mes y pico sin cerrar. */
const DIAS_CAJA = 35;
const DIAS_CAJA_ALARMA = 90;
/** Gracia para subir el extracto del mes que cerró. */
const DIA_GRACIA_EXTRACTO = 7;
/** Huecos entre extractos que todavía vale la pena llenar. */
const DIAS_HUECO_RECIENTE = 120;

// ── Fechas sin zona horaria ─────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function utc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** Días completos entre `desde` y `hasta` (ambos 'YYYY-MM-DD'). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((utc(hasta) - utc(desde)) / DAY_MS);
}

/** "25 jun" — y "25 jun 2025" si no es del año de `hoy`. */
export function fechaCorta(iso: string, hoy: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const anioHoy = Number(hoy.slice(0, 4));
  return `${d} ${MESES[m - 1]}${y !== anioHoy ? ` ${y}` : ''}`;
}

function plural(n: number, uno: string, varios: string): string {
  return `${n.toLocaleString('es-CO')} ${n === 1 ? uno : varios}`;
}

function nombreCuenta(bank: string): string {
  // "Tarjeta de crédito Bancolombia" → "Tarjeta de crédito": en una tarjeta
  // de 300 px el banco ya se sobreentiende por el resto de la lista.
  return bank.length > 22 ? bank.replace(/\s+(Bancolombia|Davivienda|BBVA|Bogotá|Occidente)$/i, '') : bank;
}

// ── Reglas ──────────────────────────────────────────────────────────────────

function reglaSiigoYVentas(s: SenalesApp): Recordatorio[] {
  const estado = s.siigo?.estado ?? null;
  const siigoCaido = estado === 'error' || estado === 'revoked';
  const diasVentas = s.ultimaVenta ? diasEntre(s.ultimaVenta, s.hoy) : null;

  if (siigoCaido) {
    // Con Siigo caído no entra NADA de Siigo (ni ventas ni inventario): un
    // solo aviso, con la fecha de la última venta como evidencia.
    const deClave = estado === 'revoked' || !!s.siigo?.errorDeClave;
    const desde = s.ultimaVenta
      ? `No entran facturas de venta desde el ${fechaCorta(s.ultimaVenta, s.hoy)}.`
      : 'No se actualizan las facturas ni el inventario de Siigo.';
    return [{
      id: 'siigo',
      nivel: 'alarm',
      titulo: deClave ? 'Siigo rechaza la clave' : 'Siigo desconectado',
      // Un error pasajero lo reintenta sola la app (useSiigoAutoSync); uno de
      // clave solo se arregla escribiendo usuario y access key correctos.
      detalle: deClave
        ? `${desde} Revisá el usuario y la access key en Ajustes.`
        : `${desde} La app reintenta sola; si sigue, reintentá en Ajustes.`,
      ruta: '/settings#siigo',
      accion: deClave ? 'Revisar clave' : 'Reintentar',
      modulo: 'admin',
      dias: diasVentas ?? 0,
    }];
  }

  if (diasVentas != null && diasVentas >= DIAS_VENTAS_QUIETAS) {
    // Con Siigo conectado la app ya trae todo lo que hay allá (auto-sync cada
    // 4 h): si no hay nuevas es porque en Siigo tampoco las hay. No pedir
    // "traer de Siigo" (caso real 2026-11-12: la última era la FV-2-330).
    const conSiigo = estado === 'connected';
    const cuando = `${fechaCorta(s.ultimaVenta!, s.hoy)} (hace ${plural(diasVentas, 'día', 'días')})`;
    return [{
      id: 'facturas-venta',
      nivel: diasVentas >= DIAS_VENTAS_ALARMA ? 'alarm' : 'warn',
      titulo: 'Sin facturas de venta nuevas',
      detalle: conSiigo
        ? `La última que hay en Siigo es del ${cuando}. Si facturaste después, revisá que esté emitida en Siigo.`
        : `La última es del ${cuando}. Subí las facturas que faltan.`,
      ruta: '/invoices/venta',
      accion: conSiigo ? 'Ver facturas' : 'Subir facturas',
      modulo: 'facturas_venta',
      dias: diasVentas,
    }];
  }
  return [];
}

function reglaCompras(s: SenalesApp): Recordatorio[] {
  if (!s.ultimaCompra) return [];
  const dias = diasEntre(s.ultimaCompra, s.hoy);
  if (dias < DIAS_COMPRAS_QUIETAS) return [];
  return [{
    id: 'facturas-compra',
    nivel: 'warn',
    titulo: 'Sin facturas de compra nuevas',
    detalle: `La última es del ${fechaCorta(s.ultimaCompra, s.hoy)}. Revisá que el buzón esté recibiendo o subí las que faltan.`,
    ruta: '/invoices/compra',
    accion: 'Revisar',
    modulo: 'facturas_compra',
    dias,
  }];
}

function reglaExtractos(s: SenalesApp): Recordatorio[] {
  const silenciadas = new Set(s.extractosSilenciados);
  const extractos = s.extractos.filter((e) => !silenciadas.has(e.bank_name || 'Banco'));
  if (extractos.length === 0) return [];

  const partes: string[] = [];
  let dias = 0;

  // 1) Cuentas que se quedaron atrás de la más al día (tarjeta en junio
  //    mientras la cuenta principal va en octubre).
  const atrasadas = findSeriesAtrasadas(extractos);
  for (const a of atrasadas) {
    partes.push(`${nombreCuenta(a.bank)} va hasta el ${fechaCorta(a.hasta, s.hoy)}`);
    dias = Math.max(dias, diasEntre(a.hasta, s.hoy));
  }

  // 2) El mes que ya cerró no está completo en la cuenta más al día.
  const finales = extractos.map((e) => e.period_end).filter((x): x is string => !!x).sort();
  const masAlDia = finales[finales.length - 1];
  const [y, m, d] = s.hoy.split('-').map(Number);
  const finMesAnterior = new Date(Date.UTC(y, m - 1, 0)); // día 0 = último del mes anterior
  const finMesAnteriorIso = finMesAnterior.toISOString().slice(0, 10);
  const faltaMesAnterior = !!masAlDia && d > DIA_GRACIA_EXTRACTO && masAlDia < finMesAnteriorIso;
  if (faltaMesAnterior) {
    partes.unshift(`Falta ${MESES_LARGOS[finMesAnterior.getUTCMonth()]}: lo último cargado es del ${fechaCorta(masAlDia, s.hoy)}`);
    dias = Math.max(dias, diasEntre(masAlDia, s.hoy));
  }

  // 3) Días sin datos ENTRE extractos, solo si son recientes (los huecos
  //    viejos ya no se van a llenar y serían ruido permanente).
  const huecos = findCoverageGaps(extractos).filter((g) => diasEntre(g.to, s.hoy) <= DIAS_HUECO_RECIENTE);
  if (huecos.length) {
    const diasHueco = huecos.reduce((acc, g) => acc + g.days, 0);
    partes.push(`${plural(diasHueco, 'día', 'días')} sin cargar entre extractos`);
  }

  if (partes.length === 0) return [];
  const cuentas = atrasadas.length;
  return [{
    id: 'extractos',
    nivel: dias >= 90 ? 'alarm' : 'warn',
    // Títulos cortos: a ~350 px el verbo de la derecha les come espacio.
    titulo: cuentas > 1
      ? `Extractos atrasados (${cuentas} cuentas)`
      : cuentas === 1
        ? 'Extractos atrasados'
        : faltaMesAnterior
          ? 'Falta subir el extracto del mes'
          : 'Hay días sin extracto',
    detalle: partes.join(' · ') + '.',
    ruta: '/statement-upload',
    accion: 'Subir extractos',
    modulo: 'extractos',
    dias,
  }];
}

function reglaInventario(s: SenalesApp): Recordatorio[] {
  if (!s.ultimoConteo || s.movimientosDesdeConteo <= 0) return [];
  const dias = diasEntre(s.ultimoConteo, s.hoy);
  const movs = s.movimientosDesdeConteo;
  const toca = (dias >= DIAS_CONTEO_MIN && movs >= MOVS_CONTEO_MIN) || dias >= DIAS_CONTEO_MAX;
  if (!toca) return [];
  return [{
    id: 'inventario',
    nivel: dias >= DIAS_CONTEO_ALARMA || movs >= MOVS_CONTEO_ALARMA ? 'alarm' : 'warn',
    titulo: `Inventario sin contar desde el ${fechaCorta(s.ultimoConteo, s.hoy)}`,
    detalle: `${plural(movs, 'movimiento', 'movimientos')} desde entonces (remisiones y contenedores). Subí un conteo para que el stock cuadre.`,
    ruta: '/inventarios?tab=conteo',
    accion: 'Subir conteo',
    modulo: 'inventarios',
    dias,
  }];
}

function reglaCaja(s: SenalesApp): Recordatorio[] {
  const { movimientos, masViejo } = s.cajaSinCerrar;
  if (movimientos <= 0 || !masViejo) return [];
  const dias = diasEntre(masViejo, s.hoy);
  if (dias < DIAS_CAJA) return [];
  return [{
    id: 'caja-menor',
    nivel: dias >= DIAS_CAJA_ALARMA ? 'alarm' : 'warn',
    titulo: 'Caja menor sin cerrar',
    detalle: `${plural(movimientos, 'movimiento', 'movimientos')} sin cierre desde el ${fechaCorta(masViejo, s.hoy)}. Hacé el cierre para cuadrar el efectivo.`,
    ruta: '/caja-menor',
    accion: 'Cerrar caja',
    modulo: 'caja_menor',
    dias,
  }];
}

/** Todos los recordatorios que aplican, lo más urgente primero. */
export function construirRecordatorios(s: SenalesApp): Recordatorio[] {
  const todos = [
    ...reglaSiigoYVentas(s),
    ...reglaInventario(s),
    ...reglaExtractos(s),
    ...reglaCaja(s),
    ...reglaCompras(s),
  ];
  const peso: Record<NivelRecordatorio, number> = { alarm: 0, warn: 1 };
  // Siigo caído va primero entre las alarmas aunque sea reciente: mientras
  // no conecte, ventas e inventario de Siigo se siguen quedando viejos.
  const primero = (r: Recordatorio) => (r.id === 'siigo' ? 0 : 1);
  // sort es estable: a igual nivel y días, queda el orden de arriba.
  return todos.sort((a, b) => peso[a.nivel] - peso[b.nivel] || primero(a) - primero(b) || b.dias - a.dias);
}

// ── Posponer (por navegador) ────────────────────────────────────────────────

/** id → 'YYYY-MM-DD' hasta cuándo no mostrarlo. */
export type Pospuestos = Record<string, string>;

export function filtrarPospuestos(recs: Recordatorio[], pospuestos: Pospuestos, hoy: string): Recordatorio[] {
  return recs.filter((r) => {
    const hasta = pospuestos[r.id];
    return !hasta || hasta <= hoy;
  });
}

export function posponer(pospuestos: Pospuestos, id: string, hoy: string, dias = 7): Pospuestos {
  const hasta = new Date(utc(hoy) + dias * DAY_MS).toISOString().slice(0, 10);
  // De paso se limpian los vencidos para que la llave no crezca para siempre.
  const vigentes = Object.fromEntries(Object.entries(pospuestos).filter(([, h]) => h > hoy));
  return { ...vigentes, [id]: hasta };
}
