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
