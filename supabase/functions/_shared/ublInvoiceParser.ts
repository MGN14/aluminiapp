/**
 * Parser determinístico de factura electrónica colombiana (UBL 2.1 / DIAN).
 *
 * Entrada típica: el XML que viene dentro del ZIP que el proveedor envía por
 * email — un AttachedDocument cuyo cbc:Description lleva el Invoice real
 * embebido en CDATA (o escapado con &lt;). También acepta un Invoice "pelado".
 *
 * Cero dependencias y cero DOMParser a propósito: este archivo corre igual en
 * el browser (Vite) y en Deno (edge functions). Extracción por regex tolerante
 * a prefijos de namespace (cbc:/cac:/fe:/ninguno).
 *
 * KEEP IN SYNC: src/lib/ublInvoiceParser.ts es copia literal de este archivo
 * (solo cambia este header). Si tocás uno, tocá el otro.
 */

export interface ParsedUblInvoice {
  /** 'Invoice' | 'CreditNote' | 'DebitNote' — solo Invoice se importa como compra */
  docType: string;
  cufe: string | null;
  invoiceNumber: string;
  prefix: string | null;
  numberInt: number | null;
  /** YYYY-MM-DD */
  issueDate: string | null;
  /** YYYY-MM-DD — PaymentMeans/PaymentDueDate o cbc:DueDate; null si no viene */
  dueDate: string | null;
  supplierName: string | null;
  /** NIT sin DV, solo dígitos */
  supplierNit: string | null;
  /** NIT con DV ("900123456-7") si el XML trae schemeID; si no, igual a supplierNit */
  supplierNitFull: string | null;
  customerName: string | null;
  customerNit: string | null;
  customerNitFull: string | null;
  /** LineExtensionAmount */
  subtotal: number;
  /** Suma de TaxTotal nivel factura con TaxScheme 01/IVA */
  ivaAmount: number;
  /** Decimal (0.19 = 19%) */
  ivaRate: number;
  /** PayableAmount */
  total: number;
  /** 'Contado' | 'Crédito' | null (PaymentMeans/cbc:ID 1|2) */
  paymentMethod: string | null;
}

/**
 * Campos opcionales en vez de unión discriminada a propósito: el tsconfig del
 * frontend compila con strict:false, donde `if (!res.ok)` NO narrowea la
 * unión. ok=true ⇒ invoice presente; ok=false ⇒ reason presente.
 */
export interface UblParseResult {
  ok: boolean;
  invoice?: ParsedUblInvoice;
  reason?: string;
}

/** CUFE (SHA-384 → 96 hex) o CUDE/CUFE viejos (SHA-1/256 → 40/64 hex). */
export const CUFE_RE = /^[0-9a-fA-F]{40,96}$/;

// ─── Helpers de extracción tolerantes a namespace ───

function tagRe(tag: string, flags = ''): RegExp {
  // <cbc:Tag attr="...">contenido</cbc:Tag> — prefijo opcional, attrs opcionales.
  return new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${tag}>`,
    flags,
  );
}

function tagContent(xml: string, tag: string): string | null {
  const m = xml.match(tagRe(tag));
  return m ? m[1].trim() : null;
}

function tagBlock(xml: string, tag: string): string | null {
  return tagContent(xml, tag);
}

function allTagBlocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = tagRe(tag, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function stripBlocks(xml: string, tag: string): string {
  return xml.replace(tagRe(tag, 'g'), '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function num(s: string | null): number {
  if (!s) return 0;
  const n = parseFloat(s.trim());
  return Number.isFinite(n) ? n : 0;
}

function cleanText(s: string | null): string | null {
  if (!s) return null;
  const t = decodeEntities(s).replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : null;
}

/** Solo dígitos — para comparar NITs entre fuentes (con/sin DV, puntos, guiones). */
export function normalizeNitDigits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

/**
 * Dos NITs matchean si sus dígitos son iguales, o si uno es el otro + DV
 * (diferencia de exactamente 1 dígito al final: "900123456" vs "9001234567").
 */
export function nitsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = normalizeNitDigits(a);
  const db = normalizeNitDigits(b);
  if (da.length < 6 || db.length < 6) return false;
  if (da === db) return true;
  const [longer, shorter] = da.length >= db.length ? [da, db] : [db, da];
  return longer.length - shorter.length === 1 && longer.startsWith(shorter);
}

// ─── AttachedDocument → Invoice embebido ───

function rootDocType(xml: string): string | null {
  // Primer elemento que no sea la declaración <?xml?> ni comentarios.
  const m = xml.match(/<(?:[A-Za-z0-9_]+:)?(AttachedDocument|Invoice|CreditNote|DebitNote)[\s>]/);
  return m ? m[1] : null;
}

function extractEmbeddedDocument(xml: string): string | null {
  // 1. CDATA que contenga un documento UBL completo.
  const cdataRe = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let m: RegExpExecArray | null;
  while ((m = cdataRe.exec(xml)) !== null) {
    if (/<(?:[A-Za-z0-9_]+:)?(Invoice|CreditNote|DebitNote)[\s>]/.test(m[1])) return m[1];
  }
  // 2. cbc:Description con el XML escapado (&lt;Invoice&gt;...).
  for (const desc of allTagBlocks(xml, 'Description')) {
    if (/&lt;(?:[A-Za-z0-9_]+:)?(Invoice|CreditNote|DebitNote)[\s&]/.test(desc)) {
      return decodeEntities(desc);
    }
  }
  return null;
}

// ─── Parser principal ───

export function parseUblInvoice(xmlText: string): UblParseResult {
  if (!xmlText || xmlText.trim().length === 0) {
    return { ok: false, reason: 'Archivo XML vacío' };
  }

  let root = rootDocType(xmlText);
  let docXml = xmlText;

  if (root === 'AttachedDocument') {
    const embedded = extractEmbeddedDocument(xmlText);
    if (!embedded) {
      return { ok: false, reason: 'AttachedDocument sin factura embebida (CDATA no encontrado)' };
    }
    docXml = embedded;
    root = rootDocType(embedded);
  }

  if (!root) return { ok: false, reason: 'No parece un XML UBL de factura electrónica' };
  if (root !== 'Invoice') {
    return { ok: false, reason: `Documento ${root} (nota crédito/débito) — no se importa como compra` };
  }

  // Las extensiones DIAN (firmas, QR, control de numeración) traen IDs y montos
  // propios que contaminan la extracción por regex: fuera antes de leer nada.
  let headerXml = stripBlocks(docXml, 'UBLExtensions');
  // Las líneas tienen sus propios TaxTotal/ID — solo nos interesa la cabecera.
  headerXml = stripBlocks(headerXml, 'InvoiceLine');

  const supplierBlock = tagBlock(headerXml, 'AccountingSupplierParty') ?? '';
  const customerBlock = tagBlock(headerXml, 'AccountingCustomerParty') ?? '';
  // ID de la factura: primer cbc:ID de la cabecera FUERA de los bloques de las
  // partes (que traen CompanyID/ID propios en algunos emisores).
  const idScope = headerXml
    .replace(supplierBlock, '')
    .replace(customerBlock, '');
  const invoiceNumber = cleanText(tagContent(idScope, 'ID')) ?? '';

  const cufeRaw = cleanText(tagContent(headerXml, 'UUID'));
  const cufe = cufeRaw && CUFE_RE.test(cufeRaw) ? cufeRaw.toLowerCase() : null;

  const issueDate = cleanText(tagContent(headerXml, 'IssueDate'));

  const paymentMeansBlock = tagBlock(headerXml, 'PaymentMeans');
  let dueDate: string | null = null;
  let paymentMethod: string | null = null;
  if (paymentMeansBlock) {
    dueDate = cleanText(tagContent(paymentMeansBlock, 'PaymentDueDate'));
    const pmId = cleanText(tagContent(paymentMeansBlock, 'ID'));
    if (pmId === '1') paymentMethod = 'Contado';
    else if (pmId === '2') paymentMethod = 'Crédito';
  }
  if (!dueDate) dueDate = cleanText(tagContent(headerXml, 'DueDate'));

  function partyNameAndNit(block: string): { name: string | null; nit: string | null; nitFull: string | null } {
    const name =
      cleanText(tagContent(block, 'RegistrationName')) ??
      cleanText(tagContent(block, 'Name'));
    const companyIdM = block.match(
      /<(?:[A-Za-z0-9_]+:)?CompanyID((?:\s[^>]*)?)>([^<]*)<\/(?:[A-Za-z0-9_]+:)?CompanyID>/,
    );
    let nit: string | null = null;
    let nitFull: string | null = null;
    if (companyIdM) {
      nit = normalizeNitDigits(companyIdM[2]) || null;
      const dvM = companyIdM[1].match(/schemeID="(\d)"/);
      nitFull = nit ? (dvM ? `${nit}-${dvM[1]}` : nit) : null;
    }
    return { name, nit, nitFull };
  }

  const supplier = partyNameAndNit(supplierBlock);
  const customer = partyNameAndNit(customerBlock);

  const totalsBlock = tagBlock(headerXml, 'LegalMonetaryTotal') ?? '';
  const subtotal = num(tagContent(totalsBlock, 'LineExtensionAmount'));
  const total = num(tagContent(totalsBlock, 'PayableAmount'));

  // IVA: TaxTotal a nivel factura cuyo TaxScheme sea 01/IVA. Si no hay scheme
  // identificable pero hay un único TaxTotal, se usa ese.
  let ivaAmount = 0;
  let ivaRate = 0;
  const taxTotals = allTagBlocks(headerXml, 'TaxTotal');
  const ivaBlocks = taxTotals.filter((t) => {
    const scheme = tagBlock(t, 'TaxScheme');
    if (!scheme) return false;
    const schemeId = cleanText(tagContent(scheme, 'ID'));
    const schemeName = (cleanText(tagContent(scheme, 'Name')) ?? '').toUpperCase();
    return schemeId === '01' || schemeName === 'IVA';
  });
  const useBlocks = ivaBlocks.length > 0 ? ivaBlocks : taxTotals.length === 1 ? taxTotals : [];
  for (const t of useBlocks) {
    // En UBL el TaxAmount de primer nivel viene ANTES de los TaxSubtotal,
    // así que el primer match es el total del bloque.
    ivaAmount += num(tagContent(t, 'TaxAmount'));
    if (!ivaRate) {
      const pct = num(tagContent(t, 'Percent'));
      if (pct > 0) ivaRate = pct / 100;
    }
  }

  let prefix: string | null = null;
  let numberInt: number | null = null;
  const numM = invoiceNumber.match(/^([A-Za-z]+)?[\s-]*0*(\d+)$/);
  if (numM) {
    prefix = numM[1] ?? null;
    numberInt = parseInt(numM[2], 10);
  }

  if (!invoiceNumber && !cufe) {
    return { ok: false, reason: 'XML sin número de factura ni CUFE — no parece una factura DIAN' };
  }

  return {
    ok: true,
    invoice: {
      docType: 'Invoice',
      cufe,
      invoiceNumber,
      prefix,
      numberInt,
      issueDate,
      dueDate,
      supplierName: supplier.name,
      supplierNit: supplier.nit,
      supplierNitFull: supplier.nitFull,
      customerName: customer.name,
      customerNit: customer.nit,
      customerNitFull: customer.nitFull,
      subtotal,
      ivaAmount,
      ivaRate,
      total,
      paymentMethod,
    },
  };
}

/** Heurística barata para decidir si un archivo de texto es un UBL DIAN. */
export function looksLikeUblXml(text: string): boolean {
  return /<(?:[A-Za-z0-9_]+:)?(AttachedDocument|Invoice|CreditNote|DebitNote)[\s>]/.test(
    text.slice(0, 6000),
  );
}
