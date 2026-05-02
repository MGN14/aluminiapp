// Edge function: parse-bancolombia-csv
//
// Fase 2 de la migración a conciliación semanal. Recibe movimientos ya
// parseados en el browser (a partir de un CSV o ZIP de Bancolombia) y los
// inserta como `transactions` enlazados a un `bank_statement` de
// `period_type='weekly'`.
//
// Por qué el parsing ocurre en el frontend y no acá:
//   - El usuario ve preview antes de confirmar (UX mejor).
//   - Evita duplicar el parser en Deno.
//   - El edge function queda simple: auth, validación, insert.
//
// Contrato (request body JSON):
// {
//   "statement_id": "uuid",
//   "movements": [
//     {
//       "date": "2026-03-01",
//       "amount": -100.50,
//       "description": "COMPRA EN HOSTGATOR",
//       "normalizedDescription": "COMPRA EN HOSTGATOR",
//       "dcto": "3339",
//       "sucursal": "388",
//       "rawLine": "..."
//     },
//     ...
//   ]
// }
//
// Respuesta:
// { "success": true, "transactions_count": 86 }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface IncomingMovement {
  date: string; // ISO YYYY-MM-DD
  amount: number;
  description: string;
  normalizedDescription?: string;
  dcto?: string | null;
  sucursal?: string | null;
  rawLine?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function jsonResponse(
  body: Record<string, unknown>,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validateMovement(m: unknown): IncomingMovement | string {
  if (!m || typeof m !== "object") return "no es un objeto";
  const obj = m as Record<string, unknown>;

  if (typeof obj.date !== "string" || !ISO_DATE.test(obj.date)) {
    return `fecha inválida: ${obj.date}`;
  }
  if (typeof obj.amount !== "number" || !Number.isFinite(obj.amount)) {
    return `monto inválido: ${obj.amount}`;
  }
  if (typeof obj.description !== "string" || obj.description.length === 0) {
    return "descripción vacía";
  }

  return {
    date: obj.date,
    amount: obj.amount,
    description: obj.description,
    normalizedDescription:
      typeof obj.normalizedDescription === "string"
        ? obj.normalizedDescription
        : undefined,
    dcto: typeof obj.dcto === "string" ? obj.dcto : null,
    sucursal: typeof obj.sucursal === "string" ? obj.sucursal : null,
    rawLine: typeof obj.rawLine === "string" ? obj.rawLine : null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      return jsonResponse({ error: "Service configuration error" }, 500);
    }

    // ---- Auth ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });

    if (!authRes.ok) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const authUser = (await authRes.json()) as { id?: string };
    if (!authUser?.id) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // ---- Parse body ----
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const { statement_id, movements } = body as {
      statement_id?: unknown;
      movements?: unknown;
    };

    if (typeof statement_id !== "string" || statement_id.length === 0) {
      return jsonResponse({ error: "Missing statement_id" }, 400);
    }
    if (!Array.isArray(movements) || movements.length === 0) {
      return jsonResponse({ error: "movements must be a non-empty array" }, 400);
    }

    // Validar cada movimiento antes de tocar la DB — falla rápido si hay garbage
    const validMovements: IncomingMovement[] = [];
    const errors: Array<{ index: number; reason: string }> = [];
    for (let i = 0; i < movements.length; i++) {
      const validated = validateMovement(movements[i]);
      if (typeof validated === "string") {
        errors.push({ index: i, reason: validated });
      } else {
        validMovements.push(validated);
      }
    }
    if (errors.length > 0) {
      return jsonResponse(
        {
          error: "Movimientos inválidos en el payload",
          errors: errors.slice(0, 10), // primeros 10 para no abrumar
          total_errors: errors.length,
        },
        400
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ---- Verificar que el statement exista y sea del usuario ----
    const { data: statement, error: stmtErr } = await supabase
      .from("bank_statements")
      .select("id, user_id, processed, transaction_count")
      .eq("id", statement_id)
      .single();

    if (stmtErr || !statement) {
      return jsonResponse({ error: "Statement not found" }, 404);
    }
    if (statement.user_id !== authUser.id) {
      return jsonResponse({ error: "Unauthorized" }, 403);
    }
    if (statement.processed) {
      return jsonResponse(
        {
          error:
            "Este extracto ya fue procesado. Para re-subirlo, bórralo primero.",
        },
        409
      );
    }

    // Self-heal: si hay transactions insertadas pero el statement nunca fue
    // marcado processed=true (porque el UPDATE de abajo falló en una corrida
    // previa), un reintento duplicaría las filas. Detectamos ese caso: si ya
    // hay exactamente las mismas transactions del payload esperado, marcamos
    // processed y cerramos sin re-insertar.
    const { count: existingTxCount } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("statement_id", statement_id);

    if ((existingTxCount ?? 0) > 0) {
      // Solo self-healear si el count existente coincide con el payload. Si no
      // coincide, la corrida previa quedó parcial — marcar processed=true
      // ocultaría que faltan filas. Mejor abortar y pedir borrar+resubir.
      if (existingTxCount !== validMovements.length) {
        console.warn(
          `parse-bancolombia-csv: self-heal abortado statement ${statement_id} — ` +
            `existentes=${existingTxCount}, payload=${validMovements.length}. ` +
            `Insert previo quedó parcial.`,
        );
        return jsonResponse(
          {
            error:
              `Este extracto tiene ${existingTxCount} transacciones existentes ` +
              `pero el archivo trae ${validMovements.length}. La corrida anterior ` +
              `quedó incompleta. Borrá el extracto y volvé a subirlo.`,
            existing_tx_count: existingTxCount,
            expected_tx_count: validMovements.length,
          },
          409,
        );
      }

      const { error: healErr } = await supabase
        .from("bank_statements")
        .update({
          processed: true,
          transaction_count: existingTxCount ?? 0,
        })
        .eq("id", statement_id);

      if (healErr) {
        console.error("Self-heal update error:", healErr);
        return jsonResponse(
          { error: `Failed to mark statement processed: ${healErr.message}` },
          500
        );
      }

      console.log(
        `parse-bancolombia-csv: self-healed statement ${statement_id} ` +
          `(encontró ${existingTxCount} transactions huérfanas de corrida previa, count exacto)`,
      );
      return jsonResponse({
        success: true,
        transactions_count: existingTxCount ?? 0,
        self_healed: true,
      });
    }

    // ---- Calcular balance running ----
    // El CSV de Bancolombia (semanal) NO trae columna saldo. Para que el chart
    // "Saldo en el tiempo" funcione, necesitamos popular balance en cada row.
    // Estrategia: arrancamos del último balance conocido del usuario en una
    // fecha < primer date del CSV (puede venir de un PDF previo o de otro
    // CSV ya backfilleado), y vamos sumando amounts cronológicamente.
    // Si NO hay balance previo conocido, arrancamos en 0 (el chart va a
    // mostrar saldo relativo, no absoluto — mejor que NULL que lo oculta).
    const sortedMovs = [...validMovements].sort((a, b) => {
      // Sort por date ASC, manteniendo el orden original como tie-breaker
      // (los movements vienen en el orden del CSV, que respeta el orden
      // cronológico real del banco para mismo día).
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return validMovements.indexOf(a) - validMovements.indexOf(b);
    });
    const firstDate = sortedMovs[0]?.date;

    let seedBalance = 0;
    if (firstDate) {
      const { data: priorTx } = await supabase
        .from("transactions")
        .select("balance, date, created_at")
        .eq("user_id", statement.user_id)
        .is("deleted_at", null)
        .not("balance", "is", null)
        .lt("date", firstDate)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (priorTx?.balance != null) {
        seedBalance = Number(priorTx.balance);
        console.log(
          `parse-bancolombia-csv: seed balance ${seedBalance} desde tx previa del ${priorTx.date}`,
        );
      } else {
        console.log(
          `parse-bancolombia-csv: sin balance previo conocido, arranca en 0 (saldo relativo)`,
        );
      }
    }

    // Mapeamos balance a cada movement por su lineNumber/index para preservarlo
    // en el orden original del payload (que es como nuestro insert los recibe).
    const balanceByMovIndex = new Map<number, number>();
    let running = seedBalance;
    for (const m of sortedMovs) {
      running = running + m.amount;
      balanceByMovIndex.set(validMovements.indexOf(m), running);
    }

    // ---- Construir rows para inserción ----
    const rows = validMovements.map((m, idx) => ({
      user_id: statement.user_id,
      statement_id: statement_id,
      date: m.date,
      description: m.description,
      amount: m.amount,
      balance: balanceByMovIndex.get(idx) ?? null,
      debit: m.amount < 0 ? Math.abs(m.amount) : null,
      credit: m.amount > 0 ? m.amount : null,
      dcto: m.dcto ?? null,
      sucursal: m.sucursal ?? null,
      raw_line: m.rawLine ?? null,
      type: m.amount >= 0 ? "ingreso" : "egreso",
      // Flags de impuestos en 0 — Fase 4 las va a poblar según dcto (bank_code)
      has_iva: false,
      has_retefuente: false,
      has_reteica: false,
      iva_amount: 0,
      iva_rate: 0,
      retefuente_amount: 0,
      retefuente_rate: 0,
      reteica_amount: 0,
    }));

    // ---- Insertar transactions ----
    const { error: insertErr } = await supabase
      .from("transactions")
      .insert(rows);

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return jsonResponse(
        { error: `Failed to insert transactions: ${insertErr.message}` },
        500
      );
    }

    // ---- Marcar statement como procesado ----
    const { error: updateErr } = await supabase
      .from("bank_statements")
      .update({
        processed: true,
        transaction_count: rows.length,
      })
      .eq("id", statement_id);

    if (updateErr) {
      // Las transactions ya están insertadas pero el statement quedó con
      // processed=false. Devolvemos 500 para que el cliente reintente; el
      // guard de self-heal de arriba va a detectar las transactions huérfanas
      // y marcar processed sin duplicar filas.
      console.error("Statement update error:", updateErr);
      return jsonResponse(
        {
          error:
            "Transactions insertadas pero no se pudo marcar procesado. Reintentá el upload — el sistema detectará las transactions existentes y completará la operación.",
        },
        500
      );
    }

    return jsonResponse({
      success: true,
      transactions_count: rows.length,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return jsonResponse(
      { error: "Internal server error" },
      500
    );
  }
});
