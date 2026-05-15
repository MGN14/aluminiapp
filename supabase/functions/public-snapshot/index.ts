// Endpoint público de solo lectura para que un agente externo (Claude) lea
// un snapshot del estado de AluminIA. Protegido por bearer token custom (no
// usa la auth de Supabase). Solo expone datos de un único OWNER_USER_ID.
//
// Forma del JSON devuelto:
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
// Fuentes:
// - smm_aluminio_actual + trm_usd_cop → macro_indicators (sync diario).
// - pedidos_abiertos → tabla imports (módulo de importaciones), estado en
//   {cotizacion, anticipo, produccion, transito, aduana, entregado, cancelado}.
// - vencimientos_proximos → imports con fecha_estimada_llegada en próx 60 días
//   y saldo > 0.

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
    // =====================================================================
    // 1. SMM aluminio + TRM
    //    SMM se guarda como indicator_type='aluminio_lme' por el sync de
    //    sync-macro-indicators (LME spot via Yahoo Finance ALI=F).
    // =====================================================================
    const [aluminioRes, trmRes] = await Promise.all([
      admin
        .from("macro_indicators")
        .select("value, period_date")
        .eq("indicator_type", "aluminio_lme")
        .order("period_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("macro_indicators")
        .select("value, period_date")
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

    // =====================================================================
    // 2. Pedidos abiertos — tabla `imports`, estado != entregado/cancelado.
    // =====================================================================
    type ImportRow = {
      id: string;
      proveedor_nombre: string;
      estado: string;
      precio_smm_cerrado_usd_ton: number | null;
      saldo_pendiente_usd: number | null;
      monto_total_usd: number | null;
      anticipo_pagado_usd: number | null;
      fecha_estimada_llegada: string | null;
      fecha_anticipo: string | null;
      ref_pedido: string | null;
    };
    const { data: importsRows, error: impErr } = await admin
      .from("imports")
      .select("id, proveedor_nombre, estado, precio_smm_cerrado_usd_ton, saldo_pendiente_usd, monto_total_usd, anticipo_pagado_usd, fecha_estimada_llegada, fecha_anticipo, ref_pedido")
      .eq("user_id", ownerUserId)
      .not("estado", "in", "(entregado,cancelado)")
      .order("fecha_estimada_llegada", { ascending: true, nullsFirst: false });
    if (impErr) throw impErr;

    const pedidosAbiertos = ((importsRows as ImportRow[] | null) ?? []).map((r) => ({
      id: r.id,
      proveedor: r.proveedor_nombre,
      estado: r.estado, // 'cotizacion'|'anticipo'|'produccion'|'transito'|'aduana'|'entregado'
      precio_smm_cerrado: Number(r.precio_smm_cerrado_usd_ton ?? 0),
      saldo_pendiente_usd: Number(r.saldo_pendiente_usd ?? 0),
      fecha_estimada_llegada: r.fecha_estimada_llegada,
    }));

    // =====================================================================
    // 3. Vencimientos próximos — imports con ETA en próx 60 días y saldo > 0.
    // =====================================================================
    const today = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 60);
    const todayIso = today.toISOString().split("T")[0];
    const horizonIso = horizon.toISOString().split("T")[0];

    const vencimientosProximos = ((importsRows as ImportRow[] | null) ?? [])
      .filter((r) =>
        r.fecha_estimada_llegada
        && r.fecha_estimada_llegada >= todayIso
        && r.fecha_estimada_llegada <= horizonIso
        && Number(r.saldo_pendiente_usd ?? 0) > 0
      )
      .map((r) => ({
        concepto: r.ref_pedido
          ? `Saldo importación ${r.ref_pedido}`
          : `Saldo importación ${r.id.slice(0, 8)}`,
        monto_usd: Number(r.saldo_pendiente_usd ?? 0),
        fecha_vencimiento: r.fecha_estimada_llegada,
        proveedor: r.proveedor_nombre,
      }));

    const body = {
      smm_aluminio_actual: smmAluminio,
      trm_usd_cop: trm,
      pedidos_abiertos: pedidosAbiertos,
      vencimientos_proximos: vencimientosProximos,
      _meta: {
        generated_at: new Date().toISOString(),
        source_notes: {
          smm_aluminio_actual: "macro_indicators.indicator_type='aluminio_lme' último period_date (Yahoo Finance ALI=F / Trading Economics)",
          trm_usd_cop: "macro_indicators.indicator_type='trm' último period_date (datos.gov.co Superfinanciera)",
          pedidos_abiertos: "tabla imports con estado != entregado/cancelado",
          vencimientos_proximos: "imports con fecha_estimada_llegada en próx 60 días y saldo_pendiente_usd > 0",
        },
      },
    };

    return json(body, 200);
  } catch (err) {
    return json({ error: (err as Error).message ?? "Internal error" }, 500);
  }
});
