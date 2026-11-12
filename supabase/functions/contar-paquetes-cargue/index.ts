// Cuenta los PAQUETES de perfiles de aluminio que se ven en la foto del
// camión cargado (estación de cargue de la remisión). Sirve de segundo par de
// ojos: si la IA ve muchos menos paquetes que los que contó la bodega, la app
// avisa antes de despachar. El resultado queda guardado con la foto para
// buscarlo si hay un reclamo.
//
// Auth: se usa el JWT del usuario (cliente con su token), así que la RLS de
// remision_cargue_fotos y del bucket "cargues" decide qué foto puede leer y
// actualizar. Sin service_role.
//
// Proveedor: Claude (visión) y, si falla o no hay llave, Gemini por la API
// compatible con OpenAI — el mismo patrón de parse-bancolombia-pdf.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PROMPT = `Esta es una foto de un camión (o de una carga lista para subir) en una distribuidora de perfiles de aluminio en Colombia.
Los perfiles se despachan en PAQUETES: atados de varias piezas largas, normalmente envueltos en plástico, papel o cinta, y amarrados.
Contá cuántos paquetes se ven. Contá cada atado una sola vez aunque se vea por un extremo. No cuentes piezas sueltas dentro de un paquete.
Si parte de la carga está tapada o fuera de la foto, contá solo lo visible y decilo en las notas.
Respondé SOLO un JSON, sin texto antes ni después, con esta forma exacta:
{"paquetes": <entero>, "confianza": "alta" | "media" | "baja", "notas": "<una frase corta en español>"}`;

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function parseResultado(text: string): { paquetes: number; confianza: string; notas: string } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const n = Math.round(Number(o.paquetes));
    if (!Number.isFinite(n) || n < 0) return null;
    const conf = ["alta", "media", "baja"].includes(o.confianza) ? o.confianza : "baja";
    return { paquetes: n, confianza: conf, notas: String(o.notas ?? "").slice(0, 300) };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || (!ANTHROPIC_API_KEY && !GEMINI_API_KEY)) {
      return json({ error: "Service configuration error" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    // Cliente con el token del usuario: la RLS decide qué puede ver.
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { foto_id } = await req.json().catch(() => ({}));
    if (!foto_id || typeof foto_id !== "string") return json({ error: "Falta foto_id" }, 400);

    const { data: foto, error: fotoErr } = await supabase
      .from("remision_cargue_fotos")
      .select("id, storage_path")
      .eq("id", foto_id)
      .maybeSingle();
    if (fotoErr) return json({ error: fotoErr.message }, 400);
    if (!foto) return json({ error: "No se encontró la foto" }, 404);

    const { data: file, error: dlErr } = await supabase.storage.from("cargues").download(foto.storage_path);
    if (dlErr || !file) return json({ error: "No se pudo leer la foto" }, 404);
    const mime = file.type && file.type.startsWith("image/") ? file.type : "image/jpeg";
    const b64 = toBase64(await file.arrayBuffer());

    type Intento = { proveedor: "claude" | "gemini"; modelo: string };
    const intentos: Intento[] = [
      ...(ANTHROPIC_API_KEY ? [{ proveedor: "claude" as const, modelo: "claude-sonnet-5-5" }] : []),
      ...(GEMINI_API_KEY ? [{ proveedor: "gemini" as const, modelo: "gemini-2.5-flash" }] : []),
    ];

    let resultado: { paquetes: number; confianza: string; notas: string } | null = null;
    let modeloUsado = "";
    let ultimoError = "";

    for (const it of intentos) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort("timeout"), 45_000);
      try {
        let res: Response;
        if (it.proveedor === "claude") {
          res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            signal: ctrl.signal,
            headers: {
              "x-api-key": ANTHROPIC_API_KEY ?? "",
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: it.modelo,
              max_tokens: 400,
              messages: [{
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
                  { type: "text", text: PROMPT },
                ],
              }],
            }),
          });
        } else {
          res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
            method: "POST",
            signal: ctrl.signal,
            headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: it.modelo,
              messages: [{
                role: "user",
                content: [
                  { type: "text", text: PROMPT },
                  { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
                ],
              }],
            }),
          });
        }
        if (!res.ok) {
          ultimoError = `${it.modelo}: ${res.status}`;
          console.warn("contar-paquetes-cargue", ultimoError, await res.text().catch(() => ""));
          if (RETRYABLE.has(res.status) || res.status === 404 || res.status === 400) continue;
          break;
        }
        const body = await res.json();
        const texto: string = it.proveedor === "claude"
          ? (body?.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("")
          : body?.choices?.[0]?.message?.content ?? "";
        resultado = parseResultado(texto);
        if (resultado) { modeloUsado = it.modelo; break; }
        ultimoError = `${it.modelo}: respuesta sin JSON`;
      } catch (e) {
        ultimoError = `${it.modelo}: ${(e as Error).message ?? e}`;
        console.warn("contar-paquetes-cargue", ultimoError);
      } finally {
        clearTimeout(timer);
      }
    }

    if (!resultado) return json({ error: "La IA no pudo contar los paquetes de esta foto. Probá con otra foto más de frente." , detalle: ultimoError }, 503);

    const { error: upErr } = await supabase
      .from("remision_cargue_fotos")
      .update({
        conteo_ia: resultado.paquetes,
        conteo_ia_detalle: { confianza: resultado.confianza, notas: resultado.notas, modelo: modeloUsado },
        conteo_ia_at: new Date().toISOString(),
      })
      .eq("id", foto.id);
    if (upErr) console.warn("contar-paquetes-cargue: no se guardó el conteo", upErr.message);

    return json({ ...resultado, modelo: modeloUsado });
  } catch (e) {
    console.error("contar-paquetes-cargue error:", e);
    return json({ error: "Error interno contando paquetes" }, 500);
  }
});
