// Edge Function: parse-davivienda-pdf
// Lee extractos de Davivienda: descarga el PDF, lo DESENCRIPTA (prueba clave
// vacía → NIT de la empresa) y EXTRAE TEXTO con pdfjs, detecta el banco, y si
// es Davivienda lo parsea determinísticamente (formato validado contra extractos
// reales) e inserta las transacciones.
//
// SEGURO POR DISEÑO: ante cualquier fallo o si NO es Davivienda, devuelve
// { not_davivienda: true } sin tocar nada → el cliente cae al parser de
// Bancolombia (flujo intacto). El cuadre (Σcréditos/Σdébitos vs resumen) actúa
// de guarda: si una mala extracción de texto descuadra, NO inserta basura.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
// NOTA: pdfjs se importa LAZY dentro de extractText (no a nivel módulo) para que
// un fallo de carga en el runtime Deno NO tumbe el arranque de la función. Si
// pdfjs no carga, extractText lanza → el handler devuelve not_davivienda y el
// cliente cae a Bancolombia (flujo intacto).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Parser determinístico (espejo de src/lib/daviviendaParser.ts, validado)
// ---------------------------------------------------------------------------
const SPANISH_MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const TX_LINE = /^(\d{2})\s+(\d{2})\s+\$\s*([\d.,]+)([+-])\s+(\d{3,4})\s+(.*)$/;

function daviNumber(raw: string): number {
  return parseFloat(raw.replace(/,/g, "")) || 0;
}
function moneyField(text: string, label: string): number | null {
  const m = text.match(new RegExp(label + "\\s*\\$\\s*([\\d,]+\\.\\d{2})", "i"));
  return m ? daviNumber(m[1]) : null;
}
function detectBank(text: string): "davivienda" | "bancolombia" | null {
  const t = text.toLowerCase();
  if (/davivienda/.test(t) || (/m[áa]s cr[eé]ditos/.test(t) && /menos d[eé]bitos/.test(t))) return "davivienda";
  if (/bancolombia/.test(t)) return "bancolombia";
  return null;
}

interface DaviTx { date: string; description: string; dcto: string; amount: number; raw_line: string; }

function parseDavivienda(text: string) {
  const pm = text.match(/DEL MES:\s*([A-Za-zÁÉÍÓÚáéíóúñ]+)\s*\/\s*(\d{4})/i);
  const month = pm ? (SPANISH_MONTHS[pm[1].toLowerCase()] ?? null) : null;
  const year = pm ? parseInt(pm[2], 10) : null;

  const summary = {
    saldo_anterior: moneyField(text, "Saldo Anterior"),
    total_abonos: moneyField(text, "M[áa]s Cr[ée]ditos"),
    total_cargos: moneyField(text, "Menos D[ée]bitos"),
    saldo_actual: moneyField(text, "Nuevo Saldo"),
    saldo_promedio: moneyField(text, "Saldo Promedio"),
  };

  const lines = text.split("\n");
  const transactions: DaviTx[] = [];
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!inTable) { if (/Fecha\s+Valor\s+Doc/i.test(line)) inTable = true; continue; }
    if (/^(Saldo|Total|P[áa]gina|www\.|Banco Davivienda)/i.test(line)) { if (transactions.length) break; continue; }
    const m = line.match(TX_LINE);
    if (m) {
      const yyyy = year ?? new Date().getFullYear();
      transactions.push({
        date: `${yyyy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`,
        description: m[6].trim(),
        dcto: m[5],
        amount: Math.round(daviNumber(m[3]) * (m[4] === "-" ? -1 : 1) * 100) / 100,
        raw_line: line,
      });
    } else if (transactions.length && line) {
      transactions[transactions.length - 1].description += " " + line;
    }
  }

  const cred = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const deb = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const near = (a: number | null, b: number) => a == null || Math.abs(a - b) <= 1;
  const balances_match = near(summary.total_abonos, cred) && near(summary.total_cargos, deb);

  return { month, year, summary, transactions, computed: { cred: Math.round(cred * 100) / 100, deb: Math.round(deb * 100) / 100 }, balances_match };
}

// pdfjs: reconstruye líneas agrupando items por coordenada Y.
async function extractText(data: Uint8Array, password: string): Promise<string> {
  const { getDocument } = await import("https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs");
  const doc = await getDocument({ data, password, useSystemFonts: true, isEvalSupported: false }).promise;
  let out = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const lines = new Map<number, { x: number; s: string }[]>();
    for (const it of tc.items as Array<{ str?: string; transform?: number[] }>) {
      if (typeof it.str !== "string" || !it.transform) continue;
      const y = Math.round(it.transform[5]);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y)!.push({ x: it.transform[4], s: it.str });
    }
    const ys = [...lines.keys()].sort((a, b) => b - a); // arriba → abajo
    out += ys.map(y => lines.get(y)!.sort((a, b) => a.x - b.x).map(i => i.s).join(" ")).join("\n") + "\n";
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let statementId: string | null = null;
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const file_path = body.file_path as string;
    statementId = (body.statement_id as string) ?? null;
    if (!file_path || !statementId) return json({ error: "file_path y statement_id requeridos" }, 400);

    const { data: statement } = await supabase.from("bank_statements").select("user_id").eq("id", statementId).maybeSingle();
    if (!statement) return json({ error: "Statement no encontrado" }, 404);

    // Descargar PDF
    const { data: fileData, error: dlErr } = await supabase.storage.from("bank-statements").download(file_path);
    if (dlErr || !fileData) return json({ not_davivienda: true, reason: "no se pudo descargar el PDF" });
    const bytes = new Uint8Array(await fileData.arrayBuffer());

    // NIT de la empresa (para extractos encriptados como los de MGN)
    const { data: prof } = await supabase.from("profiles").select("company_nit").eq("user_id", statement.user_id).maybeSingle();
    const nit = (prof?.company_nit ?? "").toString().replace(/\D/g, "");

    // Desencriptar + extraer texto: probar clave vacía → NIT. Si nada funciona,
    // caemos a Bancolombia (graceful).
    let text = "";
    for (const pwd of ["", nit].filter((p, i) => i === 0 || p)) {
      try { text = await extractText(bytes, pwd); if (text.trim().length > 50) break; } catch (_e) { /* probar siguiente */ }
    }
    if (text.trim().length <= 50) return json({ not_davivienda: true, reason: "no se pudo extraer texto (¿escaneado o clave?)" });

    if (detectBank(text) !== "davivienda") return json({ not_davivienda: true, reason: "no es un extracto Davivienda" });

    // Es Davivienda → parsear
    const r = parseDavivienda(text);
    if (r.transactions.length === 0) {
      await supabase.from("bank_statements").update({ processing_error: "Davivienda detectado pero no se hallaron transacciones (revisar extracción de texto)." }).eq("id", statementId);
      return json({ error: "Davivienda detectado pero sin transacciones. Contactanos con el archivo." }, 422);
    }
    if (!r.balances_match) {
      await supabase.from("bank_statements").update({ processing_error: `Cuadre Davivienda no coincide: parser créditos ${r.computed.cred} / débitos ${r.computed.deb} vs extracto ${r.summary.total_abonos}/${r.summary.total_cargos}.` }).eq("id", statementId);
      return json({ error: "Davivienda: el cuadre no coincide con el resumen del extracto. No insertamos para no meter datos errados.", computed: r.computed, summary: r.summary }, 422);
    }

    // Insertar transacciones (sin inferencia de categoría — el usuario concilia luego)
    const rows = r.transactions.map((t) => ({
      user_id: statement.user_id,
      statement_id: statementId,
      date: t.date,
      description: t.description,
      amount: t.amount,
      debit: t.amount < 0 ? Math.abs(t.amount) : null,
      credit: t.amount > 0 ? t.amount : null,
      dcto: t.dcto || null,
      raw_line: t.raw_line || null,
      type: t.amount >= 0 ? "ingreso" : "egreso",
      has_iva: false, has_retefuente: false, has_reteica: false,
      iva_rate: 0.19, retefuente_rate: 0.025, iva_amount: 0, retefuente_amount: 0, reteica_amount: 0,
    }));
    const { data: inserted, error: insErr } = await supabase.from("transactions").insert(rows).select("id");
    if (insErr) {
      await supabase.from("bank_statements").update({ processing_error: `Falló insertar: ${insErr.message}` }).eq("id", statementId);
      return json({ error: `No se pudieron insertar las transacciones: ${insErr.message}` }, 500);
    }

    const periodStart = r.month && r.year ? `${r.year}-${String(r.month).padStart(2, "0")}-01` : null;
    const periodEnd = r.month && r.year ? new Date(r.year, r.month, 0).toISOString().split("T")[0] : null;
    await supabase.from("bank_statements").update({
      bank_name: "Davivienda",
      statement_month: r.month, statement_year: r.year,
      period_start: periodStart, period_end: periodEnd,
      saldo_anterior: r.summary.saldo_anterior, saldo_actual: r.summary.saldo_actual,
      saldo_promedio: r.summary.saldo_promedio,
      total_abonos: r.summary.total_abonos, total_cargos: r.summary.total_cargos,
      processed: true, processing_error: null,
    }).eq("id", statementId);

    return json({ bank: "davivienda", transactions_count: inserted?.length ?? 0, balances_match: true });
  } catch (err) {
    // Cualquier error inesperado → graceful fallback a Bancolombia.
    return json({ not_davivienda: true, reason: `error inesperado: ${(err as Error).message}` });
  }
});
