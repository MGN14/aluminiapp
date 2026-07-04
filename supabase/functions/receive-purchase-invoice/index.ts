// receive-purchase-invoice — buzón permanente de facturas de compra.
//
// Cloudflare Email Routing recibe facturas@aluminiapp.com → Email Worker
// (/cloudflare/email-worker/) parsea el MIME y POSTea acá los adjuntos en
// base64. Esta función:
//   1. Autentica por header x-inbox-secret (env INVOICE_INBOX_SECRET) —
//      patrón x-cron-secret de sync-macro-indicators. verify_jwt=false.
//   2. Resuelve el user dueño por la dirección destino (inbound_invoice_addresses).
//   3. Procesa SOLO adjuntos .zip/.xml (límite de tamaño y cantidad), extrae
//      el XML UBL y lo parsea con el parser determinístico compartido
//      (_shared/ublInvoiceParser.ts — el mismo del uploader de backfill).
//   4. Dedupea por CUFE, matchea/crea el proveedor en responsibles e inserta
//      la factura type='compra' status='confirmed' balance_pending=total,
//      source='email'. El PDF que venga en el ZIP se sube a storage.
//
// Siempre responde 200 con el resumen (salvo auth/config) para que el Worker
// no reintente: un email con adjuntos inválidos no es un error del sistema.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";
import {
  parseUblInvoice,
  nitsMatch,
  type ParsedUblInvoice,
} from "../_shared/ublInvoiceParser.ts";

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15MB binarios por adjunto

interface InboundAttachment {
  filename?: string;
  content_base64?: string;
}

interface InboundPayload {
  to?: string;
  from?: string;
  subject?: string;
  text?: string;
  attachments?: InboundAttachment[];
}

function extractEmail(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

function ext(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeXmlBytes(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (utf8.includes("�")) return new TextDecoder("iso-8859-1").decode(bytes);
  return utf8;
}

// Espejo de normalizeCompanyName de src/lib/stringUtils.ts (sin deps de src/).
function normalizeCompanyName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+s\.?a\.?s\.?\s*$/i, "")
    .replace(/\s+ltda\.?\s*$/i, "")
    .replace(/\s+s\.?a\.?\s*$/i, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isJunkEntry(name: string): boolean {
  return name.endsWith("/") || name.startsWith("__MACOSX") ||
    (name.split("/").pop() ?? "").startsWith(".");
}

interface Candidate {
  label: string;
  xmlText: string;
  pdfBytes?: Uint8Array;
  pdfName?: string;
}

/** ZIP → candidatos XML (+ PDF asociado si el zip trae uno). */
function candidatesFromZip(label: string, bytes: Uint8Array): Candidate[] {
  const entries = unzipSync(bytes);
  const names = Object.keys(entries).filter((n) => !isJunkEntry(n) && entries[n].length > 0);
  const xmls = names.filter((n) => ext(n) === "xml");
  const pdfs = names.filter((n) => ext(n) === "pdf");
  const out: Candidate[] = [];
  for (const xmlName of xmls) {
    const base = xmlName.replace(/\.xml$/i, "").split("/").pop();
    const paired = pdfs.find((p) => p.replace(/\.pdf$/i, "").split("/").pop() === base) ??
      (pdfs.length === 1 ? pdfs[0] : undefined);
    out.push({
      label: `${label}/${xmlName}`,
      xmlText: decodeXmlBytes(entries[xmlName]),
      pdfBytes: paired ? entries[paired] : undefined,
      pdfName: paired ? paired.split("/").pop() : undefined,
    });
  }
  return out;
}

function daysBetween(fromIso: string, toIso: string): number {
  const d = Math.round(
    (new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86400000,
  );
  return Number.isFinite(d) && d > 0 ? d : 0;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  const INBOX_SECRET = Deno.env.get("INVOICE_INBOX_SECRET");
  if (!INBOX_SECRET) {
    console.error("receive-purchase-invoice: INVOICE_INBOX_SECRET no configurado");
    return new Response(JSON.stringify({ error: "Buzón no configurado" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (req.headers.get("x-inbox-secret") !== INBOX_SECRET) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const payload = (await req.json()) as InboundPayload;
    const toAddress = extractEmail(payload.to);
    const fromAddress = extractEmail(payload.from) ?? "desconocido";

    if (!toAddress) {
      console.warn("receive-purchase-invoice: email sin destino identificable");
      return new Response(JSON.stringify({ ok: true, ignored: "sin destino" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: mapping } = await supabase
      .from("inbound_invoice_addresses")
      .select("user_id")
      .eq("address", toAddress)
      .maybeSingle();

    if (!mapping?.user_id) {
      console.warn(`receive-purchase-invoice: dirección sin dueño: ${toAddress}`);
      return new Response(JSON.stringify({ ok: true, ignored: "dirección no registrada" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    const userId = mapping.user_id as string;

    // ── Expandir adjuntos → candidatos XML ──
    const attachments = (payload.attachments ?? []).slice(0, MAX_ATTACHMENTS);
    const candidates: Candidate[] = [];
    const errors: Array<{ label: string; reason: string }> = [];

    for (const att of attachments) {
      const name = att.filename ?? "adjunto";
      const e = ext(name);
      if (e !== "zip" && e !== "xml") continue; // seguridad: solo zip/xml
      if (!att.content_base64) continue;
      // base64 ≈ 4/3 del binario
      if (att.content_base64.length > MAX_ATTACHMENT_BYTES * 1.4) {
        errors.push({ label: name, reason: "Adjunto demasiado grande" });
        continue;
      }
      try {
        const bytes = b64ToBytes(att.content_base64);
        if (e === "xml") {
          candidates.push({ label: name, xmlText: decodeXmlBytes(bytes) });
        } else {
          candidates.push(...candidatesFromZip(name, bytes));
        }
      } catch (err) {
        console.error(`receive-purchase-invoice: adjunto ilegible ${name}:`, err);
        errors.push({ label: name, reason: "Adjunto ilegible (¿ZIP corrupto?)" });
      }
    }

    if (candidates.length === 0) {
      // Sin XMLs procesables: log del asunto/cuerpo para no perder emails de
      // control — acá aparece el código de confirmación del reenvío de Gmail.
      console.log(
        `receive-purchase-invoice: email de ${fromAddress} sin facturas. Asunto: "${payload.subject ?? ""}". Cuerpo: ${(payload.text ?? "").slice(0, 1500)}`,
      );
      return new Response(
        JSON.stringify({ ok: true, imported: 0, duplicates: 0, errors }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Parsear + dedupe + insertar ──
    let responsibles: Array<{ id: string; name: string; nit: string | null }> | null = null;
    let imported = 0;
    let duplicates = 0;

    for (const c of candidates) {
      const res = parseUblInvoice(c.xmlText);
      if (!res.ok || !res.invoice) {
        errors.push({ label: c.label, reason: res.reason ?? "XML inválido" });
        continue;
      }
      const parsed: ParsedUblInvoice = res.invoice;
      if (!parsed.cufe) {
        errors.push({ label: c.label, reason: "XML sin CUFE válido" });
        continue;
      }

      const { data: existing } = await supabase
        .from("invoices")
        .select("id")
        .eq("user_id", userId)
        .eq("cufe", parsed.cufe)
        .limit(1)
        .maybeSingle();
      if (existing) {
        duplicates++;
        continue;
      }

      // Responsible: cargar una vez, matchear por NIT → nombre normalizado → crear
      if (responsibles === null) {
        const { data } = await supabase
          .from("responsibles")
          .select("id, name, nit")
          .eq("user_id", userId);
        responsibles = (data ?? []) as Array<{ id: string; name: string; nit: string | null }>;
      }
      let responsibleId: string | null = null;
      let match = parsed.supplierNit
        ? responsibles.find((r) => nitsMatch(r.nit, parsed.supplierNit))
        : undefined;
      if (!match && parsed.supplierName) {
        const target = normalizeCompanyName(parsed.supplierName);
        if (target) match = responsibles.find((r) => normalizeCompanyName(r.name) === target);
      }
      if (match) {
        responsibleId = match.id;
      } else if (parsed.supplierName) {
        const { data: created, error: respErr } = await supabase
          .from("responsibles")
          .insert({
            user_id: userId,
            name: parsed.supplierName,
            nit: parsed.supplierNitFull ?? parsed.supplierNit,
            responsible_type: "banking",
            active: true,
          })
          .select("id")
          .single();
        if (respErr) console.error("receive-purchase-invoice: no se pudo crear responsible:", respErr);
        if (created) {
          responsibleId = created.id as string;
          responsibles.push({ id: responsibleId, name: parsed.supplierName, nit: parsed.supplierNitFull ?? parsed.supplierNit });
        }
      }

      // PDF del ZIP → storage (no bloquea si falla)
      let storagePath: string | null = null;
      if (c.pdfBytes && c.pdfBytes.length > 0 && c.pdfBytes.length <= MAX_ATTACHMENT_BYTES) {
        const path = `${userId}/inbox/${Date.now()}_${sanitizeFilename(c.pdfName ?? "factura.pdf")}`;
        const { error: upErr } = await supabase.storage
          .from("invoices")
          .upload(path, c.pdfBytes, { contentType: "application/pdf" });
        if (upErr) console.error("receive-purchase-invoice: upload PDF falló:", upErr);
        else storagePath = path;
      }

      const issueDate = parsed.issueDate ?? new Date().toISOString().slice(0, 10);
      const { error: insErr } = await supabase.from("invoices").insert({
        user_id: userId,
        type: "compra",
        status: "confirmed",
        source: "email",
        invoice_number: parsed.invoiceNumber || `CUFE-${parsed.cufe.slice(0, 8)}`,
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
        cufe: parsed.cufe,
        payment_method: parsed.paymentMethod,
        responsible_id: responsibleId,
        display_name: `${parsed.supplierName ?? "Proveedor"} ${parsed.invoiceNumber}`.trim(),
        original_filename: c.label.split("/").pop() ?? c.label,
        storage_path: storagePath,
        pdf_path: storagePath,
        notes: `Recibida por email de ${fromAddress}`,
      });

      if (insErr) {
        if ((insErr as { code?: string }).code === "23505") {
          duplicates++; // carrera con el uploader/otro email — mismo CUFE
        } else {
          console.error(`receive-purchase-invoice: insert falló para ${c.label}:`, insErr);
          errors.push({ label: c.label, reason: insErr.message });
        }
      } else {
        imported++;
        console.log(
          `receive-purchase-invoice: importada ${parsed.invoiceNumber} de ${parsed.supplierName} por $${parsed.total} (CUFE ${parsed.cufe.slice(0, 12)}…)`,
        );
      }
    }

    console.log(
      `receive-purchase-invoice: ${fromAddress} → ${imported} importadas, ${duplicates} duplicadas, ${errors.length} errores`,
    );
    return new Response(
      JSON.stringify({ ok: true, imported, duplicates, errors }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("receive-purchase-invoice error:", err);
    return new Response(JSON.stringify({ error: "Error interno" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
