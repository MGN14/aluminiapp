import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { strToU8 } from "fflate";
import {
  readBancolombiaFile,
  extractCsvFromZip,
  BancolombiaZipError,
} from "./bancolombiaZipReader";
import { parseBancolombiaCsv } from "./bancolombiaCsvParser";

/**
 * Construye un File para los tests. jsdom provee `File` globalmente, pero su
 * implementación de `text()` y `arrayBuffer()` es incompleta en v20; los
 * polyfills viven en `src/test/setup.ts` (via FileReader).
 *
 * Ojo: jsdom 20 interpreta `new File([Uint8Array], name)` como texto y
 * corrompe bytes binarios. Envolvemos en Blob explícito para preservarlos.
 */
function makeFile(name: string, bytes: Uint8Array): File {
  const blob = new Blob([bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer]);
  return new File([blob], name);
}

const FIXTURE_ZIP = join(
  process.cwd(),
  "test-fixtures/bancolombia/movimientos_marzo_2026.zip"
);

/**
 * NOTA sobre tests sintéticos de ZIP:
 * En Node puro, `fflate.zipSync → fflate.unzipSync` funciona perfecto. Pero
 * dentro de vitest+jsdom hay una interacción conocida donde unzipSync devuelve
 * entries corrompidos (con barras espurias: `mov.csv/`, `mov.csv/0/`, etc).
 * Por eso aquí usamos EXCLUSIVAMENTE el ZIP real de Bancolombia como fixture
 * — el que realmente importa en producción. Los casos de error igual se
 * cubren con inputs inválidos.
 */
describe("readBancolombiaFile — archivos ZIP", () => {
  it.skipIf(!existsSync(FIXTURE_ZIP))(
    "extrae el CSV del ZIP real de Bancolombia (marzo 2026)",
    async () => {
      const bytes = readFileSync(FIXTURE_ZIP);
      const file = makeFile(
        "M_CTA_000000901445759_585080.ZIP",
        new Uint8Array(bytes)
      );
      const result = await readBancolombiaFile(file);

      expect(result.csvText.length).toBeGreaterThan(0);
      expect(result.innerFilename).toMatch(/\.CSV$/i);
      expect(result.originalFilename).toBe("M_CTA_000000901445759_585080.ZIP");

      // Debe producir el mismo resultado que parsear el CSV directamente
      const parsed = parseBancolombiaCsv(result.csvText);
      expect(parsed.errors).toEqual([]);
      expect(parsed.movements).toHaveLength(86);
      expect(parsed.summary.totalCredits).toBe(220387040.63);
    }
  );

  it.skipIf(!existsSync(FIXTURE_ZIP))(
    "detecta ZIP por magic bytes aunque la extensión sea rara",
    async () => {
      const bytes = readFileSync(FIXTURE_ZIP);
      // Mismo ZIP pero con nombre que no termina en .zip ni .csv
      const file = makeFile("descarga_sin_extension", new Uint8Array(bytes));
      const result = await readBancolombiaFile(file);
      expect(result.csvText.length).toBeGreaterThan(0);
    }
  );

  it("rechaza archivo que no es ZIP ni CSV", async () => {
    const file = makeFile("rara.zip", strToU8("esto no es un zip"));
    await expect(readBancolombiaFile(file)).rejects.toBeInstanceOf(
      BancolombiaZipError
    );
  });
});

describe("readBancolombiaFile — archivos CSV directos", () => {
  it("lee CSV sin tocar nada", async () => {
    const csvText =
      "38800002200,388,7,01032026,,100.00,2715,TEST,00\n" +
      "38800002200,388,7,02032026,,-50.00,3339,IMPTO,00\n";
    const file = makeFile("movimientos.csv", strToU8(csvText));

    const result = await readBancolombiaFile(file);
    expect(result.csvText).toBe(csvText);
    expect(result.innerFilename).toBeNull();
    expect(result.originalFilename).toBe("movimientos.csv");
  });

  it("reconoce extensión .CSV en mayúsculas", async () => {
    const csvText = "38800002200,388,7,01032026,,100.00,2715,TEST,00\n";
    const file = makeFile("MOV.CSV", strToU8(csvText));

    const result = await readBancolombiaFile(file);
    expect(result.csvText).toBe(csvText);
  });
});

describe("extractCsvFromZip (helper directo)", () => {
  it("tira BancolombiaZipError si el archivo no es un ZIP válido", async () => {
    const file = makeFile("fake.zip", strToU8("esto no es un zip"));
    await expect(extractCsvFromZip(file)).rejects.toBeInstanceOf(
      BancolombiaZipError
    );
  });
});
