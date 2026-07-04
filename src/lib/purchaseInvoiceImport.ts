/**
 * Importación masiva de facturas de compra (backfill desde Drive).
 *
 * Toma ZIP/XML/PDF de factura electrónica DIAN, parsea el XML UBL de forma
 * determinística (src/lib/ublInvoiceParser.ts — sin IA), dedupea por CUFE,
 * matchea el proveedor contra responsibles por NIT/nombre normalizado y crea
 * la factura type='compra' status='confirmed' con balance_pending = total.
 *
 * Los PDF sin XML caen al pipeline existente de extracción con Gemini
 * (start-invoice-processing) y quedan "Pendiente de validar" en la lista.
 */
import { unzipSync } from 'fflate';
import { supabase } from '@/integrations/supabase/client';
import { parseUblInvoice, nitsMatch, type ParsedUblInvoice } from '@/lib/ublInvoiceParser';
import { normalizeCompanyName } from '@/lib/stringUtils';

const MAX_ENTRY_BYTES = 20 * 1024 * 1024; // 20MB por archivo interno del ZIP

export interface ImportCandidate {
  /** Nombre visible para reportar resultado (archivo o entrada del zip) */
  label: string;
  xmlText?: string;
  pdfBytes?: Uint8Array;
  pdfName?: string;
  /** PDF suelto (sin XML) → fallback IA */
  standalonePdf?: { bytes: Uint8Array; name: string };
  error?: string;
}

export type ImportStatus = 'imported' | 'duplicate' | 'pdf_queued' | 'error';

export interface ImportResultItem {
  label: string;
  status: ImportStatus;
  detail?: string;
  supplierName?: string;
  invoiceNumber?: string;
  total?: number;
}

function decodeXmlBytes(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // Si el decode UTF-8 metió replacement chars, el archivo venía en latin1
  // (pasa con XMLs viejos de algunos facturadores).
  if (utf8.includes('�')) {
    return new TextDecoder('iso-8859-1').decode(bytes);
  }
  return utf8;
}

function isJunkEntry(name: string): boolean {
  return (
    name.endsWith('/') ||
    name.startsWith('__MACOSX') ||
    name.split('/').pop()!.startsWith('.')
  );
}

function ext(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

/**
 * Expande un "contenedor" (un zip descomprimido) en candidatos: cada XML es
 * una factura; si el contenedor trae exactamente un PDF (o uno con el mismo
 * basename), se asocia como archivo adjunto de esa factura.
 */
function candidatesFromContainer(
  containerLabel: string,
  entries: Record<string, Uint8Array>,
): ImportCandidate[] {
  const out: ImportCandidate[] = [];
  const names = Object.keys(entries).filter((n) => !isJunkEntry(n) && entries[n].length > 0);
  const xmls = names.filter((n) => ext(n) === 'xml');
  const pdfs = names.filter((n) => ext(n) === 'pdf');

  for (const xmlName of xmls) {
    if (entries[xmlName].length > MAX_ENTRY_BYTES) {
      out.push({ label: `${containerLabel}/${xmlName}`, error: 'XML demasiado grande' });
      continue;
    }
    const base = xmlName.replace(/\.xml$/i, '').split('/').pop();
    const paired =
      pdfs.find((p) => p.replace(/\.pdf$/i, '').split('/').pop() === base) ??
      (pdfs.length === 1 ? pdfs[0] : undefined);
    out.push({
      label: `${containerLabel}/${xmlName}`.replace(/^\//, ''),
      xmlText: decodeXmlBytes(entries[xmlName]),
      pdfBytes: paired ? entries[paired] : undefined,
      pdfName: paired ? paired.split('/').pop() : undefined,
    });
  }

  // PDFs sin ningún XML en el contenedor → fallback IA
  if (xmls.length === 0) {
    for (const p of pdfs) {
      out.push({
        label: `${containerLabel}/${p}`.replace(/^\//, ''),
        standalonePdf: { bytes: entries[p], name: p.split('/').pop()! },
      });
    }
  }
  return out;
}

/**
 * Expande los archivos que soltó el usuario en candidatos de importación.
 * Soporta: .xml suelto, .pdf suelto, .zip de una factura (xml+pdf) y .zip
 * de zips (el "descargar carpeta" de Drive) — un nivel de anidamiento.
 */
export async function expandFilesToCandidates(files: File[]): Promise<ImportCandidate[]> {
  const out: ImportCandidate[] = [];
  for (const file of files) {
    const e = ext(file.name);
    try {
      if (e === 'xml') {
        out.push({ label: file.name, xmlText: decodeXmlBytes(new Uint8Array(await file.arrayBuffer())) });
      } else if (e === 'pdf') {
        out.push({ label: file.name, standalonePdf: { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name } });
      } else if (e === 'zip') {
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
        // Zips anidados (Drive baja la carpeta como zip-de-zips)
        const nestedZips = Object.keys(entries).filter((n) => !isJunkEntry(n) && ext(n) === 'zip');
        const flat: Record<string, Uint8Array> = {};
        for (const [name, bytes] of Object.entries(entries)) {
          if (!isJunkEntry(name) && ext(name) !== 'zip') flat[name] = bytes;
        }
        out.push(...candidatesFromContainer(file.name, flat));
        for (const nested of nestedZips) {
          try {
            const inner = unzipSync(entries[nested]);
            out.push(...candidatesFromContainer(`${file.name}/${nested}`, inner));
          } catch {
            out.push({ label: `${file.name}/${nested}`, error: 'ZIP interno corrupto' });
          }
        }
      } else {
        out.push({ label: file.name, error: 'Formato no soportado (solo ZIP, XML o PDF)' });
      }
    } catch {
      out.push({ label: file.name, error: 'No se pudo leer el archivo (¿ZIP corrupto?)' });
    }
  }
  return out;
}

interface ResponsibleRow {
  id: string;
  name: string;
  nit: string | null;
}

/**
 * Matchea o crea el responsible (proveedor) para una factura parseada.
 * Orden: NIT (con/sin DV) → nombre normalizado → crear nuevo.
 * `cache` evita crear el mismo proveedor dos veces dentro del batch.
 */
async function resolveResponsible(
  userId: string,
  parsed: ParsedUblInvoice,
  responsibles: ResponsibleRow[],
  cache: Map<string, string>,
): Promise<string | null> {
  const cacheKey = parsed.supplierNit ?? normalizeCompanyName(parsed.supplierName);
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey)!;

  let match: ResponsibleRow | undefined;
  if (parsed.supplierNit) {
    match = responsibles.find((r) => nitsMatch(r.nit, parsed.supplierNit));
  }
  if (!match && parsed.supplierName) {
    const target = normalizeCompanyName(parsed.supplierName);
    if (target) match = responsibles.find((r) => normalizeCompanyName(r.name) === target);
  }
  if (match) {
    if (cacheKey) cache.set(cacheKey, match.id);
    return match.id;
  }

  if (!parsed.supplierName) return null;
  const { data, error } = await supabase
    .from('responsibles')
    .insert({
      user_id: userId,
      name: parsed.supplierName,
      nit: parsed.supplierNitFull ?? parsed.supplierNit,
      responsible_type: 'banking',
      active: true,
    } as never)
    .select('id')
    .single();
  if (error || !data) {
    console.error('resolveResponsible insert error:', error);
    return null;
  }
  const row = data as { id: string };
  responsibles.push({ id: row.id, name: parsed.supplierName, nit: parsed.supplierNitFull ?? parsed.supplierNit });
  if (cacheKey) cache.set(cacheKey, row.id);
  return row.id;
}

async function fetchExistingCufes(userId: string, cufes: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let i = 0; i < cufes.length; i += 150) {
    const chunk = cufes.slice(i, i + 150);
    const { data, error } = await supabase
      .from('invoices')
      .select('cufe')
      .eq('user_id', userId)
      .in('cufe', chunk);
    if (error) throw new Error(`No se pudieron consultar duplicados: ${error.message}`);
    for (const row of (data ?? []) as Array<{ cufe: string | null }>) {
      if (row.cufe) existing.add(row.cufe.toLowerCase());
    }
  }
  return existing;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T00:00:00`);
  const d = Math.round((to.getTime() - from.getTime()) / 86400000);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}

async function uploadPdf(userId: string, bytes: Uint8Array, name: string): Promise<string | null> {
  const path = `${userId}/compras/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${sanitizeFilename(name)}`;
  const { error } = await supabase.storage
    .from('invoices')
    .upload(path, new Blob([bytes.slice().buffer], { type: 'application/pdf' }));
  if (error) {
    console.error('uploadPdf error (no bloquea la importación):', error);
    return null;
  }
  return path;
}

/** PDF sin XML → pipeline existente de extracción con IA (queda en revisión). */
async function queuePdfForAiExtraction(
  userId: string,
  bytes: Uint8Array,
  name: string,
): Promise<{ ok: boolean; detail?: string }> {
  const path = await uploadPdf(userId, bytes, name);
  if (!path) return { ok: false, detail: 'No se pudo subir el PDF' };
  const { data, error } = await supabase
    .from('invoices')
    .insert({
      user_id: userId,
      storage_path: path,
      pdf_path: path,
      original_filename: name,
      display_name: name.replace(/\.pdf$/i, ''),
      invoice_number: 'Pendiente',
      issue_date: new Date().toISOString().slice(0, 10),
      status: 'uploading',
      type: 'compra',
    } as never)
    .select('id')
    .single();
  if (error || !data) return { ok: false, detail: 'No se pudo crear el borrador' };
  const invoiceId = (data as { id: string }).id;
  // Fire-and-forget: el estado avanza solo (processing → ready) y la lista lo muestra.
  void supabase.functions
    .invoke('start-invoice-processing', { body: { invoice_id: invoiceId } })
    .catch(() => { /* la fila queda en 'uploading' y se puede reintentar desde la lista */ });
  return { ok: true };
}

export interface BulkImportSummary {
  results: ImportResultItem[];
  imported: number;
  duplicates: number;
  pdfQueued: number;
  errors: number;
}

/**
 * Corre la importación completa sobre los candidatos expandidos.
 * Secuencial a propósito: atribuye errores por archivo y no satura Supabase.
 */
export async function runBulkImport(
  userId: string,
  candidates: ImportCandidate[],
  onProgress: (done: number, total: number, label: string) => void,
): Promise<BulkImportSummary> {
  const results: ImportResultItem[] = [];

  // 1. Parsear todos los XML primero (rápido, local)
  const parsedOk: Array<{ label: string; parsed: ParsedUblInvoice; pdfBytes?: Uint8Array; pdfName?: string }> = [];
  const pdfFallbacks: Array<{ label: string; bytes: Uint8Array; name: string }> = [];

  for (const c of candidates) {
    if (c.error) {
      results.push({ label: c.label, status: 'error', detail: c.error });
    } else if (c.standalonePdf) {
      pdfFallbacks.push({ label: c.label, bytes: c.standalonePdf.bytes, name: c.standalonePdf.name });
    } else if (c.xmlText) {
      const res = parseUblInvoice(c.xmlText);
      if (!res.ok || !res.invoice) {
        results.push({ label: c.label, status: 'error', detail: res.reason ?? 'XML inválido' });
      } else if (!res.invoice.cufe) {
        results.push({ label: c.label, status: 'error', detail: 'XML sin CUFE válido — no se puede deduplicar' });
      } else {
        parsedOk.push({ label: c.label, parsed: res.invoice, pdfBytes: c.pdfBytes, pdfName: c.pdfName });
      }
    }
  }

  // 2. Dedupe: contra la base y dentro del mismo batch
  const existingCufes = await fetchExistingCufes(userId, parsedOk.map((p) => p.parsed.cufe!));
  const seenInBatch = new Set<string>();

  // 3. Responsibles precargados una sola vez
  const { data: respData, error: respError } = await supabase
    .from('responsibles')
    .select('id, name, nit')
    .eq('user_id', userId);
  if (respError) throw new Error(`No se pudieron cargar los proveedores: ${respError.message}`);
  const responsibles = (respData ?? []) as ResponsibleRow[];
  const responsibleCache = new Map<string, string>();

  const total = parsedOk.length + pdfFallbacks.length;
  let done = 0;

  // 4. Insertar facturas desde XML
  for (const { label, parsed, pdfBytes, pdfName } of parsedOk) {
    onProgress(done, total, label);
    const cufe = parsed.cufe!;
    if (existingCufes.has(cufe) || seenInBatch.has(cufe)) {
      results.push({
        label,
        status: 'duplicate',
        supplierName: parsed.supplierName ?? undefined,
        invoiceNumber: parsed.invoiceNumber,
        detail: existingCufes.has(cufe) ? 'Ya existe en la app (mismo CUFE)' : 'Repetida dentro del lote',
      });
      done++;
      continue;
    }
    seenInBatch.add(cufe);

    try {
      const responsibleId = await resolveResponsible(userId, parsed, responsibles, responsibleCache);
      const storagePath = pdfBytes ? await uploadPdf(userId, pdfBytes, pdfName ?? `${parsed.invoiceNumber}.pdf`) : null;
      const issueDate = parsed.issueDate ?? new Date().toISOString().slice(0, 10);

      const { error } = await supabase.from('invoices').insert({
        user_id: userId,
        type: 'compra',
        status: 'confirmed',
        source: 'xml',
        invoice_number: parsed.invoiceNumber || `CUFE-${cufe.slice(0, 8)}`,
        prefix: parsed.prefix,
        number_int: parsed.numberInt,
        issue_date: issueDate,
        due_date: parsed.dueDate,
        dias_credito: parsed.dueDate ? daysBetween(issueDate, parsed.dueDate) : 0,
        counterparty_name: parsed.supplierName,
        counterparty_nit: parsed.supplierNitFull,
        seller_name: parsed.supplierName,
        seller_nit: parsed.supplierNitFull,
        buyer_name: parsed.customerName,
        buyer_nit: parsed.customerNitFull,
        subtotal_base: parsed.subtotal,
        iva_rate: parsed.ivaRate,
        iva_amount: parsed.ivaAmount,
        total_amount: parsed.total,
        balance_pending: parsed.total,
        cufe,
        payment_method: parsed.paymentMethod,
        responsible_id: responsibleId,
        display_name: `${parsed.supplierName ?? 'Proveedor'} ${parsed.invoiceNumber}`.trim(),
        original_filename: label.split('/').pop() ?? label,
        storage_path: storagePath,
        pdf_path: storagePath,
      } as never);

      if (error) {
        // 23505 = índice único (user_id, cufe): otra pestaña/el buzón la insertó primero
        if ((error as { code?: string }).code === '23505') {
          results.push({ label, status: 'duplicate', detail: 'Ya existe en la app (mismo CUFE)', invoiceNumber: parsed.invoiceNumber });
        } else {
          results.push({ label, status: 'error', detail: error.message });
        }
      } else {
        results.push({
          label,
          status: 'imported',
          supplierName: parsed.supplierName ?? undefined,
          invoiceNumber: parsed.invoiceNumber,
          total: parsed.total,
        });
      }
    } catch (e) {
      results.push({ label, status: 'error', detail: e instanceof Error ? e.message : 'Error inesperado' });
    }
    done++;
  }

  // 5. PDFs sueltos → IA
  for (const { label, bytes, name } of pdfFallbacks) {
    onProgress(done, total, label);
    try {
      const res = await queuePdfForAiExtraction(userId, bytes, name);
      results.push(
        res.ok
          ? { label, status: 'pdf_queued', detail: 'Extracción con IA en curso — queda "Pendiente de validar"' }
          : { label, status: 'error', detail: res.detail },
      );
    } catch (e) {
      results.push({ label, status: 'error', detail: e instanceof Error ? e.message : 'Error inesperado' });
    }
    done++;
  }
  onProgress(total, total, '');

  return {
    results,
    imported: results.filter((r) => r.status === 'imported').length,
    duplicates: results.filter((r) => r.status === 'duplicate').length,
    pdfQueued: results.filter((r) => r.status === 'pdf_queued').length,
    errors: results.filter((r) => r.status === 'error').length,
  };
}
