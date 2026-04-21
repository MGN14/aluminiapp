import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseBancolombiaCsv,
  normalizeDescription,
  parseDateDDMMYYYY,
  parseAmount,
} from "./bancolombiaCsvParser";

// -----------------------------------------------------------------------------
// Tests unitarios de helpers puros
// -----------------------------------------------------------------------------

describe("normalizeDescription", () => {
  it("trimea, colapsa espacios, quita asterisco final y uppercase", () => {
    expect(normalizeDescription("  compra en  hostgator*  ")).toBe(
      "COMPRA EN HOSTGATOR"
    );
  });

  it("maneja descripciones ya limpias sin cambiarlas de forma destructiva", () => {
    expect(normalizeDescription("TRANSFERENCIA VIRTUAL")).toBe(
      "TRANSFERENCIA VIRTUAL"
    );
  });

  it("colapsa múltiples espacios consecutivos a uno", () => {
    expect(normalizeDescription("PAGO PSE    SIIGO S.A.")).toBe(
      "PAGO PSE SIIGO S.A."
    );
  });

  it("quita múltiples asteriscos finales", () => {
    expect(normalizeDescription("COMPRA **")).toBe("COMPRA");
  });

  it("preserva asteriscos intermedios, solo quita los finales", () => {
    expect(normalizeDescription("FOO*BAR*")).toBe("FOO*BAR");
  });

  it("HOSTGATOR matchea con y sin asterisco final (regla del análisis)", () => {
    expect(normalizeDescription("COMPRA EN  HOSTGATOR")).toBe(
      normalizeDescription("COMPRA EN  HOSTGATOR*")
    );
  });
});

describe("parseDateDDMMYYYY", () => {
  it("parsea fecha válida a ISO", () => {
    expect(parseDateDDMMYYYY("31032026")).toBe("2026-03-31");
    expect(parseDateDDMMYYYY("01012026")).toBe("2026-01-01");
  });

  it("primeros 2 chars son día, NO año (caso borde documentado)", () => {
    // Si se interpretara al revés, 31032026 sería 2031-03-20 (inválido)
    // o 3103-20-26 (inválido). Con la regla correcta da 2026-03-31.
    const r = parseDateDDMMYYYY("31032026");
    expect(r).toBe("2026-03-31");
    expect(r?.startsWith("2026-")).toBe(true);
  });

  it("rechaza fechas inexistentes (31 de febrero)", () => {
    expect(parseDateDDMMYYYY("31022026")).toBeNull();
  });

  it("rechaza formato incorrecto", () => {
    expect(parseDateDDMMYYYY("2026-03-31")).toBeNull();
    expect(parseDateDDMMYYYY("31/03/2026")).toBeNull();
    expect(parseDateDDMMYYYY("1032026")).toBeNull();
    expect(parseDateDDMMYYYY("")).toBeNull();
    expect(parseDateDDMMYYYY("abcdefgh")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("parsea números estándar", () => {
    expect(parseAmount("1234.56")).toBe(1234.56);
    expect(parseAmount("-1234.56")).toBe(-1234.56);
    expect(parseAmount("0")).toBe(0);
  });

  it("maneja valores con decimal sin entero (casos borde de Bancolombia)", () => {
    expect(parseAmount("-.52")).toBe(-0.52);
    expect(parseAmount(".07")).toBe(0.07);
  });

  it("rechaza no-numéricos", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1,234.56")).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Tests contra fixture real de Bancolombia (marzo 2026)
// -----------------------------------------------------------------------------

const FIXTURE_PATH = join(
  process.cwd(),
  "test-fixtures/bancolombia/movimientos_marzo_2026.csv"
);

const fixtureExists = existsSync(FIXTURE_PATH);

describe.skipIf(!fixtureExists)(
  "parseBancolombiaCsv — fixture real de marzo 2026",
  () => {
    const text = fixtureExists ? readFileSync(FIXTURE_PATH, "utf-8") : "";
    const result = fixtureExists
      ? parseBancolombiaCsv(text)
      : { movements: [], errors: [], summary: null as any };

    it("parsea exactamente 86 movimientos sin errores", () => {
      expect(result.errors).toEqual([]);
      expect(result.movements).toHaveLength(86);
      expect(result.summary.rowCount).toBe(86);
    });

    it("totales cuadran con el análisis manual", () => {
      // Valores verificados con awk en el fixture
      expect(result.summary.totalCredits).toBe(220387040.63);
      expect(result.summary.totalDebits).toBe(-85087354.37);
      expect(result.summary.netFlow).toBe(135299686.26);
    });

    it("rango de fechas es todo marzo 2026", () => {
      expect(result.summary.dateRange).toEqual({
        start: "2026-03-01",
        end: "2026-03-31",
      });
    });

    it("todas las transacciones son de la misma cuenta", () => {
      expect(result.summary.accountsSeen).toEqual(["38800002200"]);
    });

    it("identifica correctamente débitos vs créditos", () => {
      const credits = result.movements.filter((m) => m.credit !== null);
      const debits = result.movements.filter((m) => m.debit !== null);
      // Todos los movimientos deben ser o credit o debit, nunca ambos, nunca ninguno
      expect(credits.length + debits.length).toBe(86);
      // Suma parcial de credits
      const sumC = credits.reduce((s, m) => s + (m.credit ?? 0), 0);
      expect(Math.round(sumC * 100) / 100).toBe(220387040.63);
    });

    it("extrae bank_code (dcto) correctamente", () => {
      const dctos = new Set(result.movements.map((m) => m.dcto));
      // Al menos los códigos documentados en ANALISIS_CONCILIACION_SEMANAL.md
      expect(dctos.has("2715")).toBe(true); // TRANSFERENCIA VIRTUAL saliente
      expect(dctos.has("2999")).toBe(true); // ABONO INTERESES AHORROS
      expect(dctos.has("3339")).toBe(true); // IMPTO GOBIERNO 4X1000
      expect(dctos.has("4160")).toBe(true); // TRANSFERENCIA CTA SUC VIRTUAL entrante
    });

    it("el 4x1000 (dcto=3339) siempre es débito", () => {
      const impuestos = result.movements.filter((m) => m.dcto === "3339");
      expect(impuestos.length).toBeGreaterThan(0);
      for (const imp of impuestos) {
        expect(imp.debit).not.toBeNull();
        expect(imp.credit).toBeNull();
      }
    });

    it("los abonos de intereses (dcto=2999) siempre son créditos", () => {
      const intereses = result.movements.filter((m) => m.dcto === "2999");
      expect(intereses.length).toBeGreaterThan(0);
      for (const i of intereses) {
        expect(i.credit).not.toBeNull();
        expect(i.debit).toBeNull();
      }
    });

    it("todas las fechas son ISO válidas YYYY-MM-DD", () => {
      for (const m of result.movements) {
        expect(m.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it("todas las descripciones normalizadas están en uppercase sin asterisco final", () => {
      for (const m of result.movements) {
        expect(m.normalizedDescription).toBe(
          m.normalizedDescription.toUpperCase()
        );
        expect(m.normalizedDescription.endsWith("*")).toBe(false);
        expect(m.normalizedDescription).not.toMatch(/  +/); // sin dobles espacios
      }
    });
  }
);

// -----------------------------------------------------------------------------
// Tests sintéticos para casos borde (no dependen del fixture real)
// -----------------------------------------------------------------------------

describe("parseBancolombiaCsv — casos borde", () => {
  it("acepta CRLF (line endings Windows)", () => {
    const csv =
      "38800002200,388,7,01032026,,100.00,2715,TEST,00\r\n" +
      "38800002200,388,7,02032026,,-50.00,3339,IMPTO,00\r\n";
    const r = parseBancolombiaCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.movements).toHaveLength(2);
  });

  it("salta líneas vacías finales sin error", () => {
    const csv =
      "38800002200,388,7,01032026,,100.00,2715,TEST,00\n\n\n";
    const r = parseBancolombiaCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.movements).toHaveLength(1);
  });

  it("remueve BOM de archivos Windows/Excel", () => {
    const csv =
      "\uFEFF38800002200,388,7,01032026,,100.00,2715,TEST,00\n";
    const r = parseBancolombiaCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.movements).toHaveLength(1);
    expect(r.movements[0].account).toBe("38800002200");
  });

  it("acumula errores por fila mal formada en vez de tirar", () => {
    const csv = [
      "38800002200,388,7,01032026,,100.00,2715,OK,00",
      "solo,tres,cols", // mal
      "38800002200,388,7,FECHAMAL,,100.00,2715,DESC,00", // fecha inválida
      "38800002200,388,7,03032026,,notanumber,2715,DESC,00", // monto inválido
      "38800002200,388,7,04032026,,200.00,2715,OK2,00",
    ].join("\n");
    const r = parseBancolombiaCsv(csv);
    expect(r.movements).toHaveLength(2);
    expect(r.errors).toHaveLength(3);
    expect(r.errors[0].reason).toContain("columnas");
    expect(r.errors[1].reason).toContain("Fecha inválida");
    expect(r.errors[2].reason).toContain("Monto inválido");
  });

  it("resumen queda en cero si no hay movimientos válidos", () => {
    const r = parseBancolombiaCsv("");
    expect(r.movements).toEqual([]);
    expect(r.summary.rowCount).toBe(0);
    expect(r.summary.dateRange).toBeNull();
  });
});
