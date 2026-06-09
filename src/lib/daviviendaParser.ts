// ============================================================================
// Parser determinístico de extractos Davivienda (texto extraído del PDF).
// ============================================================================
// Formato (validado contra extractos reales):
//   Header: "INFORME DEL MES: MARZO /2026"
//   Resumen: Saldo Anterior / Más Créditos / Menos Débitos / Nuevo Saldo / Saldo Promedio
//   Tabla: "Fecha Valor Doc. Clase de Movimiento Oficina"
//     fila: "DD MM $ N,NNN.NN±  DOC  Clase de movimiento ... Oficina"
//       - signo SUFIJO: '+' crédito (entra), '-' débito (sale).
//       - las líneas que NO arrancan con "DD MM $" son continuación de la
//         descripción anterior (ej. "PORTAL PYMES").
//   Números: coma=miles, punto=decimales ("1,609,476.00").
//
// El cuadre (Σ créditos == Más Créditos, Σ |débitos| == Menos Débitos) sirve
// de guarda: si no cuadra, no se confía en el parseo.

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

export interface DaviviendaTransaction {
  /** YYYY-MM-DD */
  date: string;
  description: string;
  /** Código "Doc." de 4 dígitos del extracto. */
  dcto: string;
  /** Positivo = crédito/abono (entra); negativo = débito/cargo (sale). */
  amount: number;
  raw_line: string;
}

export interface DaviviendaStatement {
  bank: 'davivienda';
  period: { month: number | null; year: number | null; period_text: string | null };
  summary: {
    saldo_anterior: number | null;
    total_abonos: number | null;   // "Más Créditos"
    total_cargos: number | null;   // "Menos Débitos"
    saldo_actual: number | null;   // "Nuevo Saldo"
    saldo_promedio: number | null;
  };
  transactions: DaviviendaTransaction[];
  /** Σ créditos y Σ |débitos| calculados desde las transacciones. */
  computed: { total_creditos: number; total_debitos: number };
  /** true si computed cuadra (±$1) con el resumen del extracto. */
  balances_match: boolean;
}

/** Detecta el banco del extracto por marcas de texto. */
export function detectBankFromText(text: string): 'davivienda' | 'bancolombia' | null {
  const t = text.toLowerCase();
  if (/davivienda/.test(t) || (/más cr[eé]ditos/.test(t) && /menos d[eé]bitos/.test(t))) {
    return 'davivienda';
  }
  if (/bancolombia/.test(t) || /grupo bancolombia/.test(t)) {
    return 'bancolombia';
  }
  return null;
}

function parseDaviviendaNumber(raw: string): number {
  // "1,609,476.00" -> 1609476.00  (coma = miles, punto = decimal)
  return parseFloat(raw.replace(/,/g, '')) || 0;
}

function parseMoneyField(text: string, label: string): number | null {
  // label puede traer acentos; permitimos é/e indistinto en el caller.
  const m = text.match(new RegExp(label + '\\s*\\$\\s*([\\d,]+\\.\\d{2})', 'i'));
  return m ? parseDaviviendaNumber(m[1]) : null;
}

// fila de transacción: "02 03 $ 14,104,000.00- 4286 Retiro Efectivo ..."
const TX_LINE = /^(\d{2})\s+(\d{2})\s+\$\s*([\d.,]+)([+-])\s+(\d{3,4})\s+(.*)$/;

export function parseDaviviendaStatement(text: string): DaviviendaStatement {
  // --- Período ---
  const pm = text.match(/DEL MES:\s*([A-Za-zÁÉÍÓÚáéíóúñ]+)\s*\/\s*(\d{4})/i);
  const month = pm ? (SPANISH_MONTHS[pm[1].toLowerCase()] ?? null) : null;
  const year = pm ? parseInt(pm[2], 10) : null;
  const period_text = pm ? `${pm[1]} ${pm[2]}` : null;

  // --- Resumen ---
  const saldo_anterior = parseMoneyField(text, 'Saldo Anterior');
  const total_abonos = parseMoneyField(text, 'M[áa]s Cr[ée]ditos');
  const total_cargos = parseMoneyField(text, 'Menos D[ée]bitos');
  const saldo_actual = parseMoneyField(text, 'Nuevo Saldo');
  const saldo_promedio = parseMoneyField(text, 'Saldo Promedio');

  // --- Transacciones ---
  const lines = text.split('\n');
  const transactions: DaviviendaTransaction[] = [];
  let inTable = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!inTable) {
      if (/Fecha\s+Valor\s+Doc/i.test(line)) inTable = true;
      continue;
    }
    // Cortar la tabla si llegamos a un pie/sección posterior.
    if (/^(Saldo|Total|P[áa]gina|www\.|Banco Davivienda)/i.test(line)) {
      if (transactions.length > 0) break;
      continue;
    }
    const m = line.match(TX_LINE);
    if (m) {
      const day = m[1];
      const mon = m[2];
      const amountAbs = parseDaviviendaNumber(m[3]);
      const sign = m[4] === '-' ? -1 : 1;
      const yyyy = year ?? new Date().getFullYear();
      transactions.push({
        date: `${yyyy}-${mon.padStart(2, '0')}-${day.padStart(2, '0')}`,
        description: m[6].trim(),
        dcto: m[5],
        amount: Math.round(amountAbs * sign * 100) / 100,
        raw_line: line,
      });
    } else if (transactions.length > 0 && line) {
      // Continuación de la descripción de la transacción anterior.
      transactions[transactions.length - 1].description += ' ' + line;
    }
  }

  const total_creditos = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const total_debitos = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  const near = (a: number | null, b: number) => a == null || Math.abs(a - b) <= 1;
  const balances_match = near(total_abonos, total_creditos) && near(total_cargos, total_debitos);

  return {
    bank: 'davivienda',
    period: { month, year, period_text },
    summary: { saldo_anterior, total_abonos, total_cargos, saldo_actual, saldo_promedio },
    transactions,
    computed: {
      total_creditos: Math.round(total_creditos * 100) / 100,
      total_debitos: Math.round(total_debitos * 100) / 100,
    },
    balances_match,
  };
}
