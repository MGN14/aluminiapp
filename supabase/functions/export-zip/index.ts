// Edge Function: export-zip
// Genera un ZIP con CSVs de las tablas core del usuario, filtradas por rango de fechas.
// Devuelve un blob binario (application/zip) listo para descargar.
//
// Autorización (mismo patrón que send-export-email):
//   - Owner siempre puede.
//   - Colaborador requiere collaborator_permissions.access_level = 'edit' para module_key='exportar'.
//
// Body: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
//   - from/to opcionales; si faltan, exporta TODO sin filtro de fecha.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Tablas a exportar. dateField: columna usada para filtrar por rango de fechas.
// Si dateField es null, se exporta toda la tabla (filtrada por RLS al user actual).
type TableSpec = { table: string; dateField: string | null };

const TABLES: TableSpec[] = [
  { table: "invoices", dateField: "issue_date" },
  { table: "invoice_items", dateField: null }, // hijo de invoices, sin fecha propia
  { table: "remisiones", dateField: "date" },
  { table: "remision_items", dateField: null },
  { table: "remision_payments", dateField: null },
  { table: "transactions", dateField: "date" },
  { table: "bank_statements", dateField: "period_start" },
  { table: "cash_movements", dateField: "date" },
  { table: "petty_cash_movements", dateField: "date" },
  { table: "credits", dateField: "date" },
  { table: "credit_payments", dateField: null },
  { table: "inventory_movements", dateField: "date" },
  { table: "expected_payments", dateField: "date" },
  { table: "categories", dateField: null },
  { table: "responsibles", dateField: null },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonError("No authorization header", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return jsonError("Unauthorized", 401);
    }

    const body = await req.json().catch(() => ({}));
    const from: string | undefined = body?.from;
    const to: string | undefined = body?.to;

    // Validar formato de fechas si vinieron
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (from && !dateRegex.test(from)) return jsonError("from debe ser YYYY-MM-DD", 400);
    if (to && !dateRegex.test(to)) return jsonError("to debe ser YYYY-MM-DD", 400);

    // Chequear permisos: si es colaborador, requiere 'exportar' = 'edit'
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: asCollaborator } = await admin
      .from("collaborators")
      .select("id, owner_user_id")
      .eq("collaborator_user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (asCollaborator) {
      const { data: perm } = await admin
        .from("collaborator_permissions")
        .select("access_level")
        .eq("collaborator_id", asCollaborator.id)
        .eq("module_key", "exportar")
        .maybeSingle();

      if (perm?.access_level !== "edit") {
        return jsonError(
          "No tenés permiso para exportar. Solicitalo al administrador.",
          403,
        );
      }
    }

    // Profile (para metadata)
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, company_name")
      .eq("user_id", user.id)
      .maybeSingle();

    // Armar ZIP
    const zip = new JSZip();
    const tableStats: Record<string, { rows: number; skipped?: string }> = {};

    for (const spec of TABLES) {
      try {
        let query = userClient.from(spec.table).select("*");
        if (spec.dateField && from) query = query.gte(spec.dateField, from);
        if (spec.dateField && to) query = query.lte(spec.dateField, to);

        const { data, error } = await query;

        if (error) {
          // Tabla no existe o RLS bloquea: la marcamos como skipped y seguimos
          tableStats[spec.table] = { rows: 0, skipped: error.message };
          continue;
        }

        const rows = data ?? [];
        const csv = rowsToCsv(rows);
        zip.file(`${spec.table}.csv`, csv);
        tableStats[spec.table] = { rows: rows.length };
      } catch (err) {
        tableStats[spec.table] = { rows: 0, skipped: (err as Error).message };
      }
    }

    // profile.json (info del usuario)
    zip.file(
      "profile.json",
      JSON.stringify(
        {
          user_id: user.id,
          email: user.email,
          full_name: profile?.full_name ?? null,
          company_name: profile?.company_name ?? null,
        },
        null,
        2,
      ),
    );

    // manifest.json
    const manifest = {
      export_version: "1.0",
      app: "AluminIA",
      app_url: "https://aluminiapp.com",
      exported_at: new Date().toISOString(),
      exported_by: {
        user_id: user.id,
        email: user.email,
        company_name: profile?.company_name ?? null,
      },
      date_range: {
        from: from ?? null,
        to: to ?? null,
        applies_to: TABLES.filter((t) => t.dateField).map((t) => ({
          table: t.table,
          field: t.dateField,
        })),
      },
      tables: tableStats,
      total_rows: Object.values(tableStats).reduce((s, t) => s + t.rows, 0),
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    // README.txt
    zip.file(
      "README.txt",
      `Exportación de datos de AluminIA
================================

Generado: ${new Date().toISOString()}
Usuario: ${user.email}
${from || to ? `Rango: ${from ?? "inicio"} → ${to ?? "hoy"}` : "Rango: completo (sin filtro)"}

Archivos incluidos:
- manifest.json: metadata del export (rango, totales, versión).
- profile.json: datos del usuario y empresa.
- <tabla>.csv: una fila por registro, encabezados en la primera fila.

Tablas con filtro de fecha:
${TABLES.filter((t) => t.dateField).map((t) => `  - ${t.table} (campo: ${t.dateField})`).join("\n")}

Tablas sin filtro (se exporta todo):
${TABLES.filter((t) => !t.dateField).map((t) => `  - ${t.table}`).join("\n")}

Uso recomendado:
- Backup local de tus datos.
- Subir a Claude / ChatGPT / Gemini para analizar con tu propia IA.
- Importar en Excel/Google Sheets para análisis manual.

Aviso: los datos son informativos. No reemplazan la asesoría contable.
`,
    );

    const zipBlob = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const dateStamp = new Date().toISOString().slice(0, 10);
    const fileName = `aluminia-export-${dateStamp}.zip`;

    return new Response(zipBlob, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(zipBlob.byteLength),
      },
    });
  } catch (err) {
    console.error("export-zip error:", err);
    return jsonError((err as Error).message, 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Convierte un array de objects a CSV (RFC 4180-ish).
// - Headers = unión de todas las keys de las rows.
// - Escape: wrappea en " si contiene , " \n \r; dobla las " internas.
// - null/undefined → "".
// - objetos/arrays → JSON.stringify.
function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";

  const headersSet = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) headersSet.add(k);
  }
  const headers = [...headersSet];

  const lines: string[] = [headers.map(escapeCsv).join(",")];
  for (const row of rows) {
    const line = headers.map((h) => escapeCsv(row[h])).join(",");
    lines.push(line);
  }
  return lines.join("\n");
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str: string;
  if (typeof value === "object") {
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
