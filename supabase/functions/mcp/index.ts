// Edge Function: mcp
// Servidor MCP (Model Context Protocol) read-only sobre HTTP JSON-RPC 2.0.
// Le permite a Claude Desktop / Cursor / cualquier cliente MCP consultar
// los datos de un usuario de AluminIA usando su API key.
//
// Auth: header `Authorization: Bearer alm_live_<...>`
//
// Protocol: implementa los métodos básicos de MCP:
//   - initialize          → handshake
//   - tools/list          → lista de tools disponibles
//   - tools/call          → ejecutar una tool
//   - notifications/initialized (notificación, no devuelve nada)
//
// Tools (todas read-only, scoped al user de la API key):
//   - list_invoices(from?, to?, status?, search?, limit?)
//   - get_invoice(id)
//   - list_clients(search?, limit?)
//   - get_client_balance(client_name)
//   - list_transactions(from?, to?, type?, limit?)
//   - financial_summary(from, to)
//   - cash_position()
//   - top_clients_by_revenue(from, to, limit?)
//   - list_remisiones(from?, to?, search?, limit?)
//   - list_expenses(from?, to?, category?, limit?)
//   - list_pending_payments(limit?)

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, mcp-session-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

const SERVER_INFO = {
  name: "aluminia-mcp",
  version: "0.1.0",
};

const PROTOCOL_VERSION = "2025-03-26";

const MAX_LIMIT = 500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // GET: discovery / health (no auth required)
  if (req.method === "GET") {
    return json({
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      description: "AluminIA MCP server (read-only). Auth: Bearer alm_live_*",
      protocol: PROTOCOL_VERSION,
    });
  }

  try {
    // Auth: Bearer alm_live_...
    const authHeader = req.headers.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(alm_live_[a-f0-9]+)$/i);
    if (!match) {
      return jsonRpcError(null, -32001, "Missing or malformed Authorization header (expected Bearer alm_live_...)", 401);
    }
    const apiKey = match[1];

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const keyHash = await sha256Hex(apiKey);
    const { data: apiKeyRow } = await admin
      .from("api_keys")
      .select("id, user_id, name, scopes, revoked_at")
      .eq("key_hash", keyHash)
      .maybeSingle();

    if (!apiKeyRow || apiKeyRow.revoked_at) {
      return jsonRpcError(null, -32001, "Invalid or revoked API key", 401);
    }

    const userId = apiKeyRow.user_id;

    // Touch last_used_at (best-effort, no await needed for response)
    admin.from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", apiKeyRow.id)
      .then(() => {});

    // Parse JSON-RPC request
    const rpc = await req.json().catch(() => null);
    if (!rpc || typeof rpc !== "object") {
      return jsonRpcError(null, -32700, "Parse error", 400);
    }

    const { id: rpcId, method, params } = rpc as { id?: number | string; method?: string; params?: unknown };

    if (!method) {
      return jsonRpcError(rpcId ?? null, -32600, "Invalid request: missing method", 400);
    }

    // --- MCP methods ---

    if (method === "initialize") {
      return jsonRpcResult(rpcId, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: {
          tools: {},
        },
      });
    }

    if (method === "notifications/initialized" || method?.startsWith("notifications/")) {
      // Notifications: no response body per JSON-RPC spec, but return 202.
      return new Response(null, { status: 202, headers: corsHeaders });
    }

    if (method === "tools/list") {
      return jsonRpcResult(rpcId, { tools: TOOLS_SCHEMA });
    }

    if (method === "tools/call") {
      const p = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const toolName = p.name;
      const args = p.arguments ?? {};
      if (!toolName) return jsonRpcError(rpcId, -32602, "Missing tool name", 400);
      const handler = TOOL_HANDLERS[toolName];
      if (!handler) return jsonRpcError(rpcId, -32601, `Tool not found: ${toolName}`, 400);

      try {
        const result = await handler(admin, userId, args);
        return jsonRpcResult(rpcId, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        return jsonRpcResult(rpcId, {
          isError: true,
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        });
      }
    }

    return jsonRpcError(rpcId, -32601, `Method not found: ${method}`, 400);
  } catch (err) {
    console.error("mcp error:", err);
    return jsonRpcError(null, -32603, (err as Error).message, 500);
  }
});

// ===========================================================================
// Tools schema (MCP tools/list response)
// ===========================================================================

const TOOLS_SCHEMA = [
  {
    name: "list_invoices",
    description: "Lista facturas del usuario. Filtrable por rango de fechas, estado y búsqueda por nombre de cliente.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Fecha desde (YYYY-MM-DD), filtra por issue_date." },
        to: { type: "string", description: "Fecha hasta (YYYY-MM-DD)." },
        status: { type: "string", description: "Filtra por status exacto, e.g. 'pagada', 'pendiente'." },
        search: { type: "string", description: "Búsqueda por counterparty_name o buyer_name (case-insensitive)." },
        limit: { type: "number", description: "Máximo de filas (default 100, max 500)." },
      },
    },
  },
  {
    name: "get_invoice",
    description: "Detalle completo de una factura por ID, con sus items.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "UUID de la factura." } },
      required: ["id"],
    },
  },
  {
    name: "list_clients",
    description: "Lista clientes activos del usuario (de tabla responsibles con tipo cliente).",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Búsqueda por nombre o NIT." },
        limit: { type: "number", description: "Default 100, max 500." },
      },
    },
  },
  {
    name: "get_client_balance",
    description: "Saldo pendiente de un cliente (suma de balance_pending de sus facturas no anuladas).",
    inputSchema: {
      type: "object",
      properties: {
        client_name: { type: "string", description: "Nombre del cliente (matchea contra counterparty_name de invoices)." },
      },
      required: ["client_name"],
    },
  },
  {
    name: "list_transactions",
    description: "Lista transacciones bancarias. Filtrable por fechas y tipo (ingreso/egreso/transferencia).",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        type: { type: "string", enum: ["ingreso", "egreso", "transferencia"] },
        limit: { type: "number", description: "Default 100, max 500." },
      },
    },
  },
  {
    name: "financial_summary",
    description: "Resumen financiero del período: total ingresos, total egresos, neto, número de transacciones, IVA y retefuente acumulados.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "cash_position",
    description: "Saldo actual de caja: suma entradas - salidas de cash_movements y petty_cash_movements (todo el histórico).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "top_clients_by_revenue",
    description: "Top N clientes por facturación en el período (agrupado por counterparty_name).",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        limit: { type: "number", description: "Default 10, max 50." },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "list_remisiones",
    description: "Lista remisiones (notas de despacho). Filtrable por fechas y beneficiario.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        search: { type: "string", description: "Búsqueda por beneficiary." },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "list_expenses",
    description: "Lista gastos (transactions type=egreso). Filtrable por fechas y categoría.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        category: { type: "string", description: "Nombre de categoría (matchea contra categories.name)." },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "list_pending_payments",
    description: "Facturas con saldo pendiente (balance_pending > 0) ordenadas por fecha de vencimiento.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Default 50, max 500." },
      },
    },
  },
  {
    name: "aging_report",
    description: "Aging report: distribuye el saldo pendiente por cliente en buckets de envejecimiento (Corriente, 1-30, 31-60, 61-90, >90 días vencidos).",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Año fiscal. Default = año actual." },
      },
    },
  },
  {
    name: "get_collection_score",
    description: "Score IA de probabilidad de pago (0-100) + categoría + acción recomendada para un cliente específico. Usa el cache calculado por el cron diario.",
    inputSchema: {
      type: "object",
      properties: {
        client_name: { type: "string", description: "Nombre del cliente." },
      },
      required: ["client_name"],
    },
  },
  {
    name: "top_collection_priorities",
    description: "Top N clientes a priorizar para cobranza hoy: los que más deben + más vencido + peor score. Devuelve la 'bandeja del día'.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Default 10, max 50." },
      },
    },
  },
  {
    name: "register_collection_touchpoint",
    description: "Registra un contacto con un cliente (llamada, email, WhatsApp, etc.) con su outcome. Útil para que la IA registre acciones tomadas en bandeja.",
    inputSchema: {
      type: "object",
      properties: {
        client_name: { type: "string" },
        channel: { type: "string", enum: ["llamada","email","whatsapp","sms","visita","reunion","otro"] },
        outcome: { type: "string", enum: ["contactado","no_contesto","prometio_pago","compromiso_parcial","disputa","sin_respuesta","otro"] },
        notes: { type: "string", description: "Notas opcionales del contacto." },
      },
      required: ["client_name", "channel", "outcome"],
    },
  },
  {
    name: "list_recent_touchpoints",
    description: "Lista los últimos N touchpoints registrados, opcionalmente filtrados por cliente.",
    inputSchema: {
      type: "object",
      properties: {
        client_name: { type: "string", description: "Filtra por cliente (opcional)." },
        limit: { type: "number", description: "Default 20, max 200." },
      },
    },
  },
];

// ===========================================================================
// Tool handlers
// ===========================================================================

type ToolHandler = (
  db: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

function clampLimit(n: unknown, def: number): number {
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num) || num <= 0) return def;
  return Math.min(Math.floor(num), MAX_LIMIT);
}

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  async list_invoices(db, userId, args) {
    const limit = clampLimit(args.limit, 100);
    let q = db.from("invoices")
      .select("id, invoice_number, prefix, issue_date, due_date, counterparty_name, counterparty_nit, total_amount, balance_pending, status, payment_method, voided_at")
      .eq("user_id", userId)
      .is("voided_at", null)
      .order("issue_date", { ascending: false })
      .limit(limit);
    if (args.from) q = q.gte("issue_date", String(args.from));
    if (args.to) q = q.lte("issue_date", String(args.to));
    if (args.status) q = q.eq("status", String(args.status));
    if (args.search) q = q.or(`counterparty_name.ilike.%${args.search}%,buyer_name.ilike.%${args.search}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { count: data?.length ?? 0, invoices: data ?? [] };
  },

  async get_invoice(db, userId, args) {
    const id = String(args.id ?? "");
    if (!id) throw new Error("id es requerido");
    const { data: inv, error } = await db.from("invoices")
      .select("*")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Factura no encontrada");
    const { data: items } = await db.from("invoice_items")
      .select("*")
      .eq("invoice_id", id);
    return { invoice: inv, items: items ?? [] };
  },

  async list_clients(db, userId, args) {
    const limit = clampLimit(args.limit, 100);
    let q = db.from("responsibles")
      .select("id, name, nit, tipo_documento, email, phone, ciudad, responsible_type, active")
      .eq("user_id", userId)
      .eq("active", true)
      .ilike("responsible_type", "%cliente%")
      .order("name", { ascending: true })
      .limit(limit);
    if (args.search) {
      const s = String(args.search);
      q = q.or(`name.ilike.%${s}%,nit.ilike.%${s}%`);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { count: data?.length ?? 0, clients: data ?? [] };
  },

  async get_client_balance(db, userId, args) {
    const name = String(args.client_name ?? "").trim();
    if (!name) throw new Error("client_name es requerido");
    const { data, error } = await db.from("invoices")
      .select("id, invoice_number, issue_date, due_date, total_amount, balance_pending, status")
      .eq("user_id", userId)
      .is("voided_at", null)
      .ilike("counterparty_name", `%${name}%`);
    if (error) throw new Error(error.message);
    const invoices = data ?? [];
    const totalBalance = invoices.reduce((s, i) => s + (Number(i.balance_pending) || 0), 0);
    const totalInvoiced = invoices.reduce((s, i) => s + (Number(i.total_amount) || 0), 0);
    return {
      client_search: name,
      invoice_count: invoices.length,
      total_invoiced: totalBalance + (totalInvoiced - totalBalance), // == totalInvoiced
      total_balance_pending: totalBalance,
      invoices_pending: invoices.filter((i) => Number(i.balance_pending) > 0),
    };
  },

  async list_transactions(db, userId, args) {
    const limit = clampLimit(args.limit, 100);
    let q = db.from("transactions")
      .select("id, date, description, type, amount, debit, credit, has_iva, iva_amount, has_retefuente, retefuente_amount, category_id, responsible_id, notes")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .limit(limit);
    if (args.from) q = q.gte("date", String(args.from));
    if (args.to) q = q.lte("date", String(args.to));
    if (args.type) q = q.eq("type", String(args.type));
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { count: data?.length ?? 0, transactions: data ?? [] };
  },

  async financial_summary(db, userId, args) {
    const from = String(args.from ?? "");
    const to = String(args.to ?? "");
    if (!from || !to) throw new Error("from y to son requeridos");
    const { data, error } = await db.from("transactions")
      .select("type, amount, debit, credit, iva_amount, retefuente_amount")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .gte("date", from)
      .lte("date", to);
    if (error) throw new Error(error.message);
    const txs = data ?? [];
    let totalIngresos = 0, totalEgresos = 0, totalIva = 0, totalRetefuente = 0;
    for (const t of txs) {
      const amt = Math.abs(Number(t.amount ?? t.credit ?? t.debit ?? 0));
      if (t.type === "ingreso") totalIngresos += amt;
      else if (t.type === "egreso") totalEgresos += amt;
      totalIva += Number(t.iva_amount ?? 0);
      totalRetefuente += Number(t.retefuente_amount ?? 0);
    }
    return {
      period: { from, to },
      transaction_count: txs.length,
      total_ingresos: round2(totalIngresos),
      total_egresos: round2(totalEgresos),
      neto: round2(totalIngresos - totalEgresos),
      total_iva: round2(totalIva),
      total_retefuente: round2(totalRetefuente),
    };
  },

  async cash_position(db, userId) {
    const [cash, petty] = await Promise.all([
      db.from("cash_movements").select("type, amount").eq("user_id", userId),
      db.from("petty_cash_movements").select("kind, amount").eq("user_id", userId),
    ]);
    let cashBalance = 0;
    for (const m of cash.data ?? []) {
      const amt = Number(m.amount ?? 0);
      cashBalance += String(m.type).toLowerCase() === "entrada" ? amt : -amt;
    }
    let pettyBalance = 0;
    for (const m of petty.data ?? []) {
      const amt = Number(m.amount ?? 0);
      // En petty_cash, 'kind' generalmente es 'ingreso'/'egreso' o similar.
      const kind = String(m.kind).toLowerCase();
      pettyBalance += (kind === "ingreso" || kind === "entrada") ? amt : -amt;
    }
    return {
      cash_movements_balance: round2(cashBalance),
      petty_cash_balance: round2(pettyBalance),
      total: round2(cashBalance + pettyBalance),
      note: "Suma de todo el histórico (entradas - salidas). No incluye saldos bancarios.",
    };
  },

  async top_clients_by_revenue(db, userId, args) {
    const from = String(args.from ?? "");
    const to = String(args.to ?? "");
    if (!from || !to) throw new Error("from y to son requeridos");
    const limit = Math.min(clampLimit(args.limit, 10), 50);

    const { data, error } = await db.from("invoices")
      .select("counterparty_name, total_amount, balance_pending")
      .eq("user_id", userId)
      .is("voided_at", null)
      .gte("issue_date", from)
      .lte("issue_date", to);
    if (error) throw new Error(error.message);

    const map = new Map<string, { total: number; pending: number; count: number }>();
    for (const inv of data ?? []) {
      const key = (inv.counterparty_name as string) ?? "(sin nombre)";
      const cur = map.get(key) ?? { total: 0, pending: 0, count: 0 };
      cur.total += Number(inv.total_amount ?? 0);
      cur.pending += Number(inv.balance_pending ?? 0);
      cur.count += 1;
      map.set(key, cur);
    }
    const sorted = [...map.entries()]
      .map(([name, v]) => ({
        client_name: name,
        total_invoiced: round2(v.total),
        total_pending: round2(v.pending),
        invoice_count: v.count,
      }))
      .sort((a, b) => b.total_invoiced - a.total_invoiced)
      .slice(0, limit);
    return { period: { from, to }, top_clients: sorted };
  },

  async list_remisiones(db, userId, args) {
    const limit = clampLimit(args.limit, 100);
    let q = db.from("remisiones")
      .select("id, number, date, beneficiary, total_manual, status, remision_type, notes")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(limit);
    if (args.from) q = q.gte("date", String(args.from));
    if (args.to) q = q.lte("date", String(args.to));
    if (args.search) q = q.ilike("beneficiary", `%${args.search}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { count: data?.length ?? 0, remisiones: data ?? [] };
  },

  async list_expenses(db, userId, args) {
    const limit = clampLimit(args.limit, 100);
    let q = db.from("transactions")
      .select("id, date, description, amount, debit, category_id, responsible_id, notes, categories:category_id(name)")
      .eq("user_id", userId)
      .eq("type", "egreso")
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .limit(limit);
    if (args.from) q = q.gte("date", String(args.from));
    if (args.to) q = q.lte("date", String(args.to));
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    let expenses = data ?? [];
    if (args.category) {
      const cat = String(args.category).toLowerCase();
      expenses = expenses.filter((e: any) => String(e.categories?.name ?? "").toLowerCase().includes(cat));
    }
    return { count: expenses.length, expenses };
  },

  async list_pending_payments(db, userId, args) {
    const limit = clampLimit(args.limit, 50);
    const { data, error } = await db.from("invoices")
      .select("id, invoice_number, counterparty_name, issue_date, due_date, total_amount, balance_pending, status")
      .eq("user_id", userId)
      .is("voided_at", null)
      .gt("balance_pending", 0)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    const total = (data ?? []).reduce((s, i) => s + Number(i.balance_pending ?? 0), 0);
    return {
      count: data?.length ?? 0,
      total_pending: round2(total),
      invoices: data ?? [],
    };
  },

  async aging_report(db, userId, args) {
    const year = (typeof args.year === "number" ? args.year : new Date().getFullYear());
    const { data, error } = await db.from("invoices")
      .select("id, counterparty_name, responsible_id, issue_date, due_date, dias_credito, balance_pending")
      .eq("user_id", userId)
      .eq("type", "venta")
      .is("voided_at", null)
      .gt("balance_pending", 0)
      .gte("issue_date", `${year}-01-01`)
      .lte("issue_date", `${year}-12-31`);
    if (error) throw new Error(error.message);

    const today = new Date();
    type Bucket = { corriente: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; total: number; oldest_overdue_days: number };
    const groups = new Map<string, Bucket & { name: string }>();
    const totalBuckets: Bucket = { corriente: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0, oldest_overdue_days: 0 };

    for (const inv of (data ?? []) as any[]) {
      const pending = Number(inv.balance_pending) || 0;
      if (pending <= 0) continue;
      const issue = new Date(inv.issue_date);
      let venc = issue;
      if (inv.due_date) venc = new Date(inv.due_date);
      else if (inv.dias_credito) { venc = new Date(issue); venc.setDate(venc.getDate() + inv.dias_credito); }
      const daysOverdue = Math.floor((today.getTime() - venc.getTime()) / 86400000);
      const name = inv.counterparty_name ?? "(sin nombre)";
      const key = name;
      const g = groups.get(key) ?? { name, corriente: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0, oldest_overdue_days: 0 };
      if (daysOverdue <= 0) g.corriente += pending;
      else if (daysOverdue <= 30) g.d1_30 += pending;
      else if (daysOverdue <= 60) g.d31_60 += pending;
      else if (daysOverdue <= 90) g.d61_90 += pending;
      else g.d90_plus += pending;
      g.total += pending;
      if (daysOverdue > g.oldest_overdue_days) g.oldest_overdue_days = daysOverdue;
      groups.set(key, g);
    }

    const clients = [...groups.values()]
      .sort((a, b) => b.oldest_overdue_days - a.oldest_overdue_days || b.total - a.total)
      .map(g => ({
        client_name: g.name,
        oldest_overdue_days: g.oldest_overdue_days,
        corriente: round2(g.corriente),
        d1_30: round2(g.d1_30),
        d31_60: round2(g.d31_60),
        d61_90: round2(g.d61_90),
        d90_plus: round2(g.d90_plus),
        total: round2(g.total),
      }));

    for (const c of clients) {
      totalBuckets.corriente += c.corriente;
      totalBuckets.d1_30 += c.d1_30;
      totalBuckets.d31_60 += c.d31_60;
      totalBuckets.d61_90 += c.d61_90;
      totalBuckets.d90_plus += c.d90_plus;
      totalBuckets.total += c.total;
    }

    const safeDiv = (n: number, d: number) => d > 0 ? Math.round((n / d) * 1000) / 10 : 0;

    return {
      year,
      totals: {
        corriente: round2(totalBuckets.corriente),
        d1_30: round2(totalBuckets.d1_30),
        d31_60: round2(totalBuckets.d31_60),
        d61_90: round2(totalBuckets.d61_90),
        d90_plus: round2(totalBuckets.d90_plus),
        total: round2(totalBuckets.total),
      },
      pct: {
        corriente: safeDiv(totalBuckets.corriente, totalBuckets.total),
        d1_30: safeDiv(totalBuckets.d1_30, totalBuckets.total),
        d31_60: safeDiv(totalBuckets.d31_60, totalBuckets.total),
        d61_90: safeDiv(totalBuckets.d61_90, totalBuckets.total),
        d90_plus: safeDiv(totalBuckets.d90_plus, totalBuckets.total),
        vencido_total: safeDiv(totalBuckets.d1_30 + totalBuckets.d31_60 + totalBuckets.d61_90 + totalBuckets.d90_plus, totalBuckets.total),
      },
      clients,
    };
  },

  async get_collection_score(db, userId, args) {
    const name = String(args.client_name ?? "").trim();
    if (!name) throw new Error("client_name requerido");
    const { data, error } = await db.from("client_collection_scores")
      .select("client_name, score, category, reasoning, recommended_action, total_owed, oldest_overdue_days, invoices_count, scored_at")
      .eq("user_id", userId)
      .ilike("client_name", `%${name}%`)
      .order("scored_at", { ascending: false })
      .limit(5);
    if (error) throw new Error(error.message);
    return {
      query: name,
      matches: data ?? [],
      note: data?.length === 0 ? "Sin score calculado todavía. Pedile al usuario que toque 'Recalcular scores IA' en el Módulo de Cobranza." : null,
    };
  },

  async top_collection_priorities(db, userId, args) {
    const limit = Math.min(clampLimit(args.limit, 10), 50);
    // Estrategia: facturas más viejas + score bajo si existe
    const { data: invs, error } = await db.from("invoices")
      .select("counterparty_name, responsible_id, issue_date, due_date, dias_credito, balance_pending")
      .eq("user_id", userId)
      .eq("type", "venta")
      .is("voided_at", null)
      .gt("balance_pending", 0);
    if (error) throw new Error(error.message);

    const today = new Date();
    const byClient = new Map<string, { name: string; total: number; oldest: number; invoices_count: number }>();
    for (const inv of (invs ?? []) as any[]) {
      const pending = Number(inv.balance_pending) || 0;
      if (pending <= 0) continue;
      const issue = new Date(inv.issue_date);
      let venc = issue;
      if (inv.due_date) venc = new Date(inv.due_date);
      else if (inv.dias_credito) { venc = new Date(issue); venc.setDate(venc.getDate() + inv.dias_credito); }
      const overdue = Math.floor((today.getTime() - venc.getTime()) / 86400000);
      const name = inv.counterparty_name ?? "(sin nombre)";
      const c = byClient.get(name) ?? { name, total: 0, oldest: 0, invoices_count: 0 };
      c.total += pending;
      c.invoices_count += 1;
      if (overdue > c.oldest) c.oldest = overdue;
      byClient.set(name, c);
    }

    // Traer scores
    const { data: scores } = await db.from("client_collection_scores")
      .select("client_name, score, category, recommended_action")
      .eq("user_id", userId);
    const scoreByName = new Map<string, any>();
    for (const s of (scores ?? []) as any[]) {
      scoreByName.set(s.client_name.toLowerCase(), s);
    }

    const priorities = [...byClient.values()]
      .map(c => {
        const s = scoreByName.get(c.name.toLowerCase());
        // Score de prioridad: vencimiento + monto - confianza_pago
        const urgency = Math.min(100, c.oldest); // 0-100
        const confidence = s?.score ?? 50; // default 50 si sin score
        const priorityScore = urgency + (100 - confidence) + Math.min(50, c.total / 1000000); // ad-hoc
        return {
          client_name: c.name,
          total_owed: round2(c.total),
          oldest_overdue_days: c.oldest,
          invoices_count: c.invoices_count,
          ai_score: s?.score ?? null,
          ai_category: s?.category ?? null,
          ai_recommended_action: s?.recommended_action ?? null,
          priority_score: round2(priorityScore),
        };
      })
      .sort((a, b) => b.priority_score - a.priority_score)
      .slice(0, limit);

    return {
      generated_at: new Date().toISOString(),
      priorities,
      note: "Ordenado por urgencia (días vencido + monto + score IA inverso). Atender de arriba abajo.",
    };
  },

  async register_collection_touchpoint(db, userId, args) {
    const validChannels = ["llamada","email","whatsapp","sms","visita","reunion","otro"];
    const validOutcomes = ["contactado","no_contesto","prometio_pago","compromiso_parcial","disputa","sin_respuesta","otro"];
    const clientName = String(args.client_name ?? "").trim();
    const channel = String(args.channel ?? "");
    const outcome = String(args.outcome ?? "");
    if (!clientName) throw new Error("client_name requerido");
    if (!validChannels.includes(channel)) throw new Error(`channel inválido. Opciones: ${validChannels.join(", ")}`);
    if (!validOutcomes.includes(outcome)) throw new Error(`outcome inválido. Opciones: ${validOutcomes.join(", ")}`);

    // Buscar responsible_id si existe
    const { data: resp } = await db.from("responsibles")
      .select("id")
      .eq("user_id", userId)
      .ilike("name", clientName)
      .limit(1)
      .maybeSingle();

    const { data, error } = await db.from("collection_touchpoints").insert({
      user_id: userId,
      responsible_id: resp?.id ?? null,
      client_name: clientName,
      channel,
      outcome,
      notes: args.notes ? String(args.notes) : null,
    }).select("id, contacted_at").single();

    if (error) throw new Error(error.message);
    return { success: true, touchpoint_id: data?.id, contacted_at: data?.contacted_at };
  },

  async list_recent_touchpoints(db, userId, args) {
    const limit = clampLimit(args.limit, 20);
    let q = db.from("collection_touchpoints")
      .select("client_name, channel, outcome, notes, contacted_at")
      .eq("user_id", userId)
      .order("contacted_at", { ascending: false })
      .limit(limit);
    if (args.client_name) q = q.ilike("client_name", `%${args.client_name}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { count: data?.length ?? 0, touchpoints: data ?? [] };
  },
};

// ===========================================================================
// Helpers
// ===========================================================================

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonRpcResult(id: number | string | null | undefined, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonRpcError(
  id: number | string | null | undefined,
  code: number,
  message: string,
  httpStatus = 200,
) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }),
    {
      status: httpStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
