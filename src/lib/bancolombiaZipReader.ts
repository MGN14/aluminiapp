/**
 * Lector de archivos subidos por el usuario desde el portal de Bancolombia.
 *
 * El banco descarga los movimientos en formato `.ZIP` que contiene un único
 * `.CSV` adentro. Este módulo aceita cualquiera de los dos formatos y
 * devuelve el texto crudo del CSV listo para parsear.
 *
 * Se ejecuta en el browser (usa `File` del navegador + `fflate` para unzip).
 */

import { unzipSync, strFromU8 } from "fflate";

export interface ReadCsvResult {
  /** Texto del CSV listo para pasar a `parseBancolombiaCsv`. */
  csvText: string;
  /** Nombre del archivo original subido por el usuario. */
  originalFilename: string;
  /** Si era un ZIP, el nombre del CSV que había adentro. */
  innerFilename: string | null;
  /** Tamaño del archivo original (bytes). */
  originalSize: number;
}

export class BancolombiaZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BancolombiaZipError";
  }
}

/**
 * Lee un File del navegador (ZIP o CSV de Bancolombia) y devuelve el texto
 * del CSV contenido.
 *
 * Reglas:
 * - Si el archivo es `.csv` (por extensión o por contenido de texto legible),
 *   devuelve su contenido directamente.
 * - Si es `.zip`, descomprime y espera encontrar **exactamente un** archivo
 *   `.csv` adentro. Si hay 0 o más de 1, tira un error claro.
 *
 * Nunca modifica el File. Retorna el texto en UTF-8.
 */
export async function readBancolombiaFile(file: File): Promise<ReadCsvResult> {
  const name = file.name;
  const lowerName = name.toLowerCase();

  // Detectar por extensión primero — es el caso real del banco
  if (lowerName.endsWith(".zip")) {
    return await extractCsvFromZip(file);
  }

  if (lowerName.endsWith(".csv")) {
    const text = await file.text();
    return {
      csvText: text,
      originalFilename: name,
      innerFilename: null,
      originalSize: file.size,
    };
  }

  // Fallback: mirar la firma de bytes. Un ZIP empieza con "PK\x03\x04".
  const sniffBuf = await file.slice(0, 4).arrayBuffer();
  const sniff = new Uint8Array(sniffBuf);
  if (
    sniff.length >= 4 &&
    sniff[0] === 0x50 &&
    sniff[1] === 0x4b &&
    (sniff[2] === 0x03 || sniff[2] === 0x05 || sniff[2] === 0x07) &&
    (sniff[3] === 0x04 || sniff[3] === 0x06 || sniff[3] === 0x08)
  ) {
    return await extractCsvFromZip(file);
  }

  // Asumimos CSV crudo (otros bancos podrían entregar CSV sin extensión)
  const text = await file.text();
  return {
    csvText: text,
    originalFilename: name,
    innerFilename: null,
    originalSize: file.size,
  };
}

/**
 * Extrae el CSV de un ZIP de Bancolombia. Exportado para tests.
 */
export async function extractCsvFromZip(file: File): Promise<ReadCsvResult> {
  const u8 = new Uint8Array(await file.arrayBuffer());

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(u8);
  } catch (err) {
    throw new BancolombiaZipError(
      `No se pudo descomprimir el ZIP: ${(err as Error).message}`
    );
  }

  // Filtrar entradas: solo CSVs (ignorar directorios y archivos hidden __MACOSX)
  const csvEntries = Object.entries(entries).filter(([entryName, data]) => {
    if (data.length === 0) return false; // directorio vacío
    if (entryName.startsWith("__MACOSX/")) return false;
    if (entryName.endsWith("/")) return false;
    return entryName.toLowerCase().endsWith(".csv");
  });

  if (csvEntries.length === 0) {
    throw new BancolombiaZipError(
      "El ZIP no contiene ningún archivo .CSV. ¿Seguro que es un archivo de movimientos de Bancolombia?"
    );
  }

  if (csvEntries.length > 1) {
    const names = csvEntries.map(([n]) => n).join(", ");
    throw new BancolombiaZipError(
      `El ZIP contiene más de un CSV (${names}). Esperaba exactamente uno.`
    );
  }

  const [innerName, data] = csvEntries[0];
  const csvText = strFromU8(data);

  return {
    csvText,
    originalFilename: file.name,
    innerFilename: innerName,
    originalSize: file.size,
  };
}
