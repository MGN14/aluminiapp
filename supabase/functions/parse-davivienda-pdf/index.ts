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
// Regex GLOBAL (flag g) + \s (incluye \n) → tolerante a saltos de línea.
const TX_GLOBAL = /(\d{2})\s+(\d{2})\s+\$\s*([\d.,]+)\s*([+-])\s+(\d{3,4})\s+/g;

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

// Dígito de verificación del NIT (algoritmo DIAN). Ej: 901445759 → 1.
function nitCheckDigit(nit: string): string {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const digits = nit.split("").reverse();
  let sum = 0;
  for (let i = 0; i < digits.length && i < weights.length; i++) sum += parseInt(digits[i], 10) * weights[i];
  const mod = sum % 11;
  return String(mod > 1 ? 11 - mod : mod);
}

// El password del extracto es el NIT, pero la forma cambia por banco: Davivienda
// usa el NIT CON dígito de verificación (10 díg), Bancolombia SIN (9 díg).
// Probamos ambas formas derivadas del NIT guardado (calculamos / quitamos el DV).
function nitVariants(raw: string): string[] {
  const d = (raw ?? "").replace(/\D/g, "");
  if (!d) return [];
  const out = new Set<string>([d]);
  if (d.length >= 2) out.add(d.slice(0, -1));          // sin último dígito (por si trae DV)
  if (d.length <= 11) out.add(d + nitCheckDigit(d));   // con DV calculado (forma Davivienda)
  return [...out].filter(Boolean);
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

  // Regex GLOBAL (tolerante a saltos de línea — unpdf reconstruye distinto que
  // pypdf). La descripción va desde el header de la transacción hasta la
  // siguiente (o un pie tipo Saldo/Total). Captura multilínea solo.
  const transactions: DaviTx[] = [];
  const matches = [...text.matchAll(TX_GLOBAL)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const description = text.slice(start, end).split(/\b(?:Saldo|Total|P[áa]gina|www\.)\b/i)[0].trim().replace(/\s+/g, " ");
    const yyyy = year ?? new Date().getFullYear();
    transactions.push({
      date: `${yyyy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`,
      description,
      dcto: m[5],
      amount: Math.round(daviNumber(m[3]) * (m[4] === "-" ? -1 : 1) * 100) / 100,
      raw_line: (m[0].trim() + " " + description).trim(),
    });
  }

  const cred = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const deb = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const near = (a: number | null, b: number) => a == null || Math.abs(a - b) <= 1;
  const balances_match = near(summary.total_abonos, cred) && near(summary.total_cargos, deb);

  return { month, year, summary, transactions, computed: { cred: Math.round(cred * 100) / 100, deb: Math.round(deb * 100) / 100 }, balances_match };
}

// ---------------------------------------------------------------------------
// Fallback UNIVERSAL con IA (Gemini sobre el TEXTO ya desencriptado).
// ---------------------------------------------------------------------------
// El regex cubre los formatos conocidos (gratis, instantáneo). Si un usuario
// sube un Davivienda con un layout distinto, el regex falla y SIN esto quedaría
// en "contactá a soporte" — inaceptable para un producto self-service. La IA
// generaliza a cualquier variante; el cuadre sigue de guarda (Σ vs resumen, o la
// identidad contable saldo_anterior + créditos − débitos = nuevo_saldo): si no
// reconcilia, NO insertamos. Así CUALQUIER extracto Davivienda entra solo.
interface DaviSummary { saldo_anterior: number | null; total_abonos: number | null; total_cargos: number | null; saldo_actual: number | null; saldo_promedio: number | null; }

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function extractJson(s: string): any {
  const t = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(t); } catch (_) { /* intentar bloque {...} */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* no-op */ } }
  return null;
}
function normDate(raw: unknown, year: number | null): string {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
  if (m) {
    const dd = m[1].padStart(2, "0"), mm = m[2].padStart(2, "0");
    const yy = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : String(year ?? new Date().getFullYear());
    return `${yy}-${mm}-${dd}`;
  }
  return s;
}

// Cuadre ESTRICTO (sin vacuidad): exige que al menos UNA validación real pase.
function crossCheck(summary: DaviSummary, txs: DaviTx[]) {
  const cred = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const deb = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const sumOk = summary.total_abonos != null && summary.total_cargos != null &&
    Math.abs(summary.total_abonos - cred) <= 1 && Math.abs(summary.total_cargos - deb) <= 1;
  const identityOk = summary.saldo_anterior != null && summary.saldo_actual != null &&
    Math.abs(summary.saldo_anterior + cred - deb - summary.saldo_actual) <= 1;
  return { cred: Math.round(cred * 100) / 100, deb: Math.round(deb * 100) / 100, balances_match: sumOk || identityOk };
}

async function geminiExtract(text: string): Promise<{ summary: DaviSummary; transactions: DaviTx[]; period: { month: number | null; year: number | null } } | null> {
  const KEY = Deno.env.get("GEMINI_API_KEY");
  if (!KEY) return null;
  const system = "Sos un extractor de datos de extractos bancarios Davivienda (Colombia). Respondé SOLO con JSON válido, sin markdown ni texto extra.";
  const user = [
    "Extraé del texto de este extracto Davivienda EXACTAMENTE este JSON:",
    '{"periodo":{"mes":<1-12|null>,"anio":<YYYY|null>},"saldo_anterior":<num>,"mas_creditos":<num>,"menos_debitos":<num>,"nuevo_saldo":<num>,"transacciones":[{"fecha":"YYYY-MM-DD","valor":<num con signo>,"dcto":"<doc|>","descripcion":"<texto>"}]}',
    "REGLAS: 'valor' POSITIVO si es crédito/abono/consignación/nota crédito (entra plata), NEGATIVO si es débito/cargo/retiro/nota débito (sale plata). Montos como número plano (sin $, sin separador de miles, punto decimal). Una entrada por movimiento. NO inventes datos; si un campo no aparece, null. 'mas_creditos' = suma de abonos del resumen; 'menos_debitos' = suma de cargos.",
    "TEXTO DEL EXTRACTO:",
    text.slice(0, 60000),
  ].join("\n");
  for (const model of ["gemini-2.0-flash", "gemini-2.5-flash"]) {
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") continue;
      const parsed = extractJson(content);
      if (!parsed) continue;
      const year = numOrNull(parsed?.periodo?.anio);
      const txs: DaviTx[] = (Array.isArray(parsed.transacciones) ? parsed.transacciones : []).map((t: any) => {
        const amount = Math.round((numOrNull(t.valor) ?? 0) * 100) / 100;
        const description = String(t.descripcion ?? "").trim().replace(/\s+/g, " ");
        return { date: normDate(t.fecha, year), description, dcto: String(t.dcto ?? "").trim(), amount, raw_line: `${t.fecha ?? ""} ${t.valor ?? ""} ${t.dcto ?? ""} ${description}`.trim() };
      }).filter((t: DaviTx) => t.amount !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date));
      if (!txs.length) continue;
      const summary: DaviSummary = {
        saldo_anterior: numOrNull(parsed.saldo_anterior),
        total_abonos: numOrNull(parsed.mas_creditos),
        total_cargos: numOrNull(parsed.menos_debitos),
        saldo_actual: numOrNull(parsed.nuevo_saldo),
        saldo_promedio: null,
      };
      return { summary, transactions: txs, period: { month: numOrNull(parsed?.periodo?.mes), year } };
    } catch (_) { /* siguiente modelo */ }
  }
  return null;
}

// pdfjs: reconstruye líneas agrupando items por coordenada Y.
async function extractText(data: Uint8Array, password: string): Promise<string> {
  // unpdf = pdfjs empaquetado para serverless/Deno SIN canvas. (pdfjs-dist
  // directo NO compila en Deno: intenta cargar canvas.node nativo.)
  // getDocumentProxy pasa las opciones a getDocument → soporta `password`.
  const { getDocumentProxy } = await import("https://esm.sh/unpdf");
  const doc = await getDocumentProxy(data, { password });
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

    // Claves a probar: la que el usuario ingresó (prompt) → vacía → NIT del perfil.
    const providedPwd = ((body.password as string) ?? "").toString();
    const { data: prof } = await supabase.from("profiles").select("company_nit").eq("user_id", statement.user_id).maybeSingle();
    // Claves a probar: la del usuario (prompt) → vacía → el NIT del perfil en
    // TODAS sus formas (con y sin dígito de verificación) → así Davivienda (10
    // díg) y Bancolombia (9 díg) funcionan sin que el usuario piense en el DV.
    const candidates = [providedPwd, "", ...nitVariants((prof?.company_nit ?? "").toString())]
      .filter((p, i, a) => p != null && a.indexOf(p) === i);

    let text = "";
    let sawPasswordError = false;
    for (const pwd of candidates) {
      try {
        text = await extractText(bytes, pwd);
        if (text.trim().length > 50) break;
      } catch (e) {
        const msg = `${(e as Error)?.name ?? ""} ${(e as Error)?.message ?? ""}`.toLowerCase();
        if (msg.includes("password") || msg.includes("encrypt")) sawPasswordError = true;
      }
    }
    if (text.trim().length <= 50) {
      // Encriptado y ninguna clave funcionó → pedirla al usuario (NO caer a
      // Bancolombia, que tampoco puede leer un PDF cifrado).
      if (sawPasswordError) {
        return json({ needs_password: true, error: "El extracto está protegido. Ingresá la contraseña (suele ser el NIT del titular; probá con y sin dígito de verificación)." });
      }
      return json({ not_davivienda: true, reason: "no se pudo extraer texto (¿escaneado?)" });
    }

    if (detectBank(text) !== "davivienda") return json({ not_davivienda: true, reason: "no es un extracto Davivienda" });

    // Es Davivienda → parsear (determinístico primero: gratis e instantáneo)
    let r = parseDavivienda(text);
    let usedAI = false;

    // FALLBACK UNIVERSAL: si el regex no cubre este layout (0 tx o descuadre), la
    // IA parsea el texto ya desencriptado y el cuadre estricto valida. Así un
    // formato Davivienda que nunca vi igual entra solo, sin "acudir a soporte".
    if (r.transactions.length === 0 || !r.balances_match) {
      const ai = await geminiExtract(text);
      if (ai && ai.transactions.length) {
        const xc = crossCheck(ai.summary, ai.transactions);
        if (xc.balances_match) {
          r = {
            month: ai.period.month ?? r.month,
            year: ai.period.year ?? r.year,
            summary: { ...ai.summary, saldo_promedio: r.summary.saldo_promedio ?? null },
            transactions: ai.transactions,
            computed: { cred: xc.cred, deb: xc.deb },
            balances_match: true,
          };
          usedAI = true;
        }
      }
    }

    if (r.transactions.length === 0) {
      await supabase.from("bank_statements").update({ processing_error: "Davivienda detectado pero no se hallaron transacciones (regex+IA)." }).eq("id", statementId);
      return json({ error: "Detectamos un extracto Davivienda pero no pudimos leer los movimientos. Volvé a descargarlo desde tu banca virtual como PDF original (no una foto ni un escaneo) y subilo de nuevo." }, 422);
    }
    if (!r.balances_match) {
      await supabase.from("bank_statements").update({ processing_error: `Cuadre Davivienda no coincide (regex+IA): créditos ${r.computed.cred} / débitos ${r.computed.deb} vs ${r.summary.total_abonos}/${r.summary.total_cargos}.` }).eq("id", statementId);
      return json({ error: "Leímos el extracto pero las sumas no cuadran con el resumen del banco; no insertamos para no cargar datos errados. Verificá que sea el PDF original de Davivienda y volvé a intentar.", computed: r.computed, summary: r.summary }, 422);
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

    return json({ bank: "davivienda", transactions_count: inserted?.length ?? 0, balances_match: true, via: usedAI ? "ia" : "regex" });
  } catch (err) {
    // Cualquier error inesperado → graceful fallback a Bancolombia.
    return json({ not_davivienda: true, reason: `error inesperado: ${(err as Error).message}` });
  }
});
