// Endpoint público de solo lectura para que un agente externo (Claude) lea
// un snapshot del estado de AluminIA. Protegido por bearer token custom (no
// usa la auth de Supabase). Solo expone datos de un único OWNER_USER_ID.
//
// Forma del JSON devuelto (acordada con Nico):
//
//   {
//     "smm_aluminio_actual": { "precio_usd_ton": number, "fecha": ISO },
//     "trm_usd_cop":         { "valor": number, "fecha": ISO },
//     "pedidos_abiertos":    [{ id, proveedor, estado, precio_smm_cerrado,
//                                saldo_pendiente_usd, fecha_estimada_llegada }],
//     "vencimientos_proximos":[{ concepto, monto_usd, fecha_vencimiento, proveedor }],
//     "_meta":               { generated_at, source_notes }
//   }
//
// Estado actual del schema vs lo que pide el JSON:
// - smm_aluminio_actual + trm_usd_cop → REAL (tabla macro_indicators).
// - pedidos_abiertos → PROXY: invoices type='compra' con balance_pending>0.
//   No existe módulo de importaciones con flujo cotización→aduana en el schema.
//   Se devuelve estado mapeado mejor-esfuerzo desde invoices.status.
//   precio_smm_cerrado siempre 0 (no hay campo). USD calculado dividiendo el
//   balance COP entre la TRM actual (aproximado).
// - vencimientos_proximos → invoices type='compra' con due_date en los
//   próximos 60 días + cuotas de credit_payments proyectadas.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Auth: Bearer <PUBLIC_SNAPSHOT_TOKEN>
  const expectedToken = Deno.env.get("PUBLIC_SNAPSHOT_TOKEN");
  if (!expectedToken) {
    return json({ error: "PUBLIC_SNAPSHOT_TOKEN no configurado en el server" }, 500);
  }
  const authHeader = req.headers.get("Authorization") ?? "";
  const provided = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!provided || provided !== expectedToken) {
    return json({ error: "Unauthorized" }, 401);
  }

  // user_id del dueño cuyos datos exponemos (single-tenant snapshot).
  const ownerUserId = Deno.env.get("OWNER_USER_ID");
  if (!ownerUserId) {
    return json({ error: "OWNER_USER_ID no configurado" }, 500);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase env vars missing" }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ====================================================================
    // 1. SMM aluminio + TRM (tabla macro_indicators)
    // ====================================================================
    const [aluminioRes, trmRes] = await Promise.all([
      admin
        .from("macro_indicators")
        .select("value, period_date, fetched_at")
        .eq("indicator_type", "aluminio")
        .order("period_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("macro_indicators")
        .select("value, period_date, fetched_at")
        .eq("indicator_type", "trm")
        .order("period_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const smmAluminio = aluminioRes.data
      ? {
          precio_usd_ton: Number(aluminioRes.data.value) || 0,
          fecha: (aluminioRes.data.period_date as string) ?? null,
        }
      : { precio_usd_ton: 0, fecha: null };

    const trm = trmRes.data
      ? {
          valor: Number(trmRes.data.value) || 0,
          fecha: (trmRes.data.period_date as string) ?? null,
        }
      : { valor: 0, fecha: null };

    const trmCurrent = trm.valor > 0 ? trm.valor : null;
    const toUsd = (cop: number): number =>
      trmCurrent ? Math.round((cop / trmCurrent) * 100) / 100 : 0;

    // ====================================================================
    // 2. Pedidos abiertos — PROXY: invoices type='compra' con balance_pending>0
    //    No hay módulo de importaciones con flujo cotización→aduana.
    // ====================================================================
    const { data: openInvoices, error: invErr } = await admin
      .from("invoices")
      .select("id, counterparty_name, responsible_id, status, balance_pending, total_amount, due_date, issue_date")
      .eq("user_id", ownerUserId)
      .eq("type", "compra")
      .gt("balance_pending", 0)
      .order("issue_date", { ascending: false });
    if (invErr) throw invErr;

    // Resolver nombre del proveedor desde responsible_id si counterparty_name está vacío.
    const respIds = Array.from(
      new Set((openInvoices ?? []).map((i: { responsible_id: string | null }) => i.responsible_id).filter(Boolean)),
    ) as string[];
    let respNames = new Map<string, string>();
    if (respIds.length > 0) {
      const { data: resps } = await admin
        .from("responsibles")
        .select("id, name")
        .in("id", respIds);
      respNames = new Map((resps ?? []).map((r: { id: string; name: string }) => [r.id, r.name]));
    }

    const mapEstado = (status: string | null, balancePending: number, total: number): string => {
      // Mapeo aproximado de invoice.status → enum del JSON. Si el schema
      // gana un campo de fase real, cambiar acá.
      if (!status || status === "draft") return "cotizacion";
      if (balancePending >= total) return "anticipo";
      if (balancePending > 0) return "produccion";
      return "entregado";
    };

    const pedidosAbiertos = (openInvoices ?? []).map((inv) => {
      const row = inv as {
        id: string;
        counterparty_name: string | null;
        responsible_id: string | null;
        status: string | null;
        balance_pending: number | null;
        total_amount: number | null;
        due_date: string | null;
        issue_date: string | null;
      };
      const proveedor = row.counterparty_name
        ?? (row.responsible_id ? respNames.get(row.responsible_id) ?? "" : "")
        ?? "";
      const saldoCop = Number(row.balance_pending ?? 0);
      return {
        id: row.id,
        proveedor,
        estado: mapEstado(row.status, saldoCop, Number(row.total_amount ?? 0)),
        precio_smm_cerrado: 0, // no hay campo en el schema
        saldo_pendiente_usd: toUsd(saldoCop),
        fecha_estimada_llegada: row.due_date ?? row.issue_date ?? null,
      };
    });

    // ====================================================================
    // 3. Vencimientos próximos (≤ 60 días) — invoices type='compra' con due_date
    //    cercano + cuotas de créditos pendientes.
    // ====================================================================
    const today = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 60);
    const todayIso = today.toISOString().split("T")[0];
    const horizonIso = horizon.toISOString().split("T")[0];

    const { data: dueInvoices } = await admin
      .from("invoices")
      .select("id, counterparty_name, responsible_id, balance_pending, due_date, invoice_number")
      .eq("user_id", ownerUserId)
      .eq("type", "compra")
      .gt("balance_pending", 0)
      .not("due_date", "is", null)
      .gte("due_date", todayIso)
      .lte("due_date", horizonIso)
      .order("due_date", { ascending: true });

    const vencimientosInvoices = ((dueInvoices ?? []) as Array<{
      id: string;
      counterparty_name: string | null;
      responsible_id: string | null;
      balance_pending: number | null;
      due_date: string;
      invoice_number: string | null;
    }>).map((row) => ({
      concepto: `Factura compra ${row.invoice_number ?? row.id.slice(0, 8)}`,
      monto_usd: toUsd(Number(row.balance_pending ?? 0)),
      fecha_vencimiento: row.due_date,
      proveedor:
        row.counterparty_name
        ?? (row.responsible_id ? respNames.get(row.responsible_id) ?? "" : "")
        ?? "",
    }));

    // Cuotas de crédito: leer credits + credit_payments. Si la tabla
    // credit_payments registra solo pagos hechos, las próximas cuotas se
    // calcularían por amortización — out of scope para este snapshot.
    // Como aproximación, devolvemos solo invoices.due_date por ahora.
    // (Si Nico quiere proyección de cuotas, agregar acá.)

    const vencimientosProximos = vencimientosInvoices;

    // ====================================================================
    // Respuesta
    // ====================================================================
    const body = {
      smm_aluminio_actual: smmAluminio,
      trm_usd_cop: trm,
      pedidos_abiertos: pedidosAbiertos,
      vencimientos_proximos: vencimientosProximos,
      _meta: {
        generated_at: new Date().toISOString(),
        source_notes: {
          smm_aluminio_actual: "macro_indicators.indicator_type='aluminio' último period_date",
          trm_usd_cop: "macro_indicators.indicator_type='trm' último period_date",
          pedidos_abiertos:
            "PROXY: invoices type='compra' con balance_pending>0. No hay módulo de importaciones aún — estado mapeado mejor-esfuerzo desde invoices.status, precio_smm_cerrado=0 (no hay campo), saldo USD = balance_pending COP / TRM actual.",
          vencimientos_proximos:
            "invoices type='compra' con due_date en los próximos 60 días. Cuotas de crédito proyectadas no incluidas todavía.",
        },
      },
    };

    return json(body, 200);
  } catch (err) {
    return json({ error: (err as Error).message ?? "Internal error" }, 500);
  }
});
