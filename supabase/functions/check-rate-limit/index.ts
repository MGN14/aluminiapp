// Edge function: check-rate-limit
// Called by the frontend BEFORE signInWithPassword to decide whether the
// (email, ip) pair is currently allowed to attempt a login.
//
// Also used by the frontend AFTER a failed login to register the attempt.
//
// Policy:
//   - Window = 10 minutes
//   - Threshold = 5 failed attempts
//   - Block duration = 15 minutes after reaching threshold
//
// Actions:
//   POST /functions/v1/check-rate-limit
//   Body: { "action": "check", "email": "..." }
//     → { allowed: boolean, remainingSeconds?: number, attemptsInWindow: number }
//
//   POST /functions/v1/check-rate-limit
//   Body: { "action": "record_failure", "email": "...", "reason"?: "..." }
//     → { recorded: true, attemptsInWindow: number }
//
//   POST /functions/v1/check-rate-limit
//   Body: { "action": "record_success", "email": "..." }
//     → { cleared: true }  // wipes the rolling window for that (email, ip)
//
// This function uses verify_jwt = false because anonymous login forms need
// to call it. It identifies the caller by IP from the request headers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const WINDOW_MINUTES = 10;
const THRESHOLD = 5;
const BLOCK_MINUTES = 15;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  action: "check" | "record_failure" | "record_success";
  email?: string;
  reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body || !body.action) {
      return json({ error: "Body must include action" }, 400);
    }
    const email = String(body.email ?? "").toLowerCase().trim();
    if (!email) {
      return json({ error: "Body must include email" }, 400);
    }

    const ip = extractClientIp(req);
    const userAgent = req.headers.get("user-agent") ?? null;

    const admin = createClient(supabaseUrl, serviceRoleKey);

    if (body.action === "check") {
      const attemptsInWindow = await countRecentAttempts(admin, email, ip);
      if (attemptsInWindow >= THRESHOLD) {
        const oldestInBlock = await oldestAttemptTimestamp(admin, email, ip);
        // Block period starts from the last attempt that pushed it over.
        // Simpler approach: block for BLOCK_MINUTES since the most recent attempt.
        const mostRecent = await mostRecentAttemptTimestamp(admin, email, ip);
        const unblockAt = new Date(
          (mostRecent ?? Date.now()) + BLOCK_MINUTES * 60 * 1000,
        );
        const remainingMs = unblockAt.getTime() - Date.now();
        if (remainingMs > 0) {
          return json({
            allowed: false,
            remainingSeconds: Math.ceil(remainingMs / 1000),
            attemptsInWindow,
          }, 200);
        }
      }
      return json({ allowed: true, attemptsInWindow }, 200);
    }

    if (body.action === "record_failure") {
      const { error: insertErr } = await admin
        .from("auth_failed_attempts")
        .insert({
          email,
          ip,
          user_agent: userAgent,
          reason: body.reason ?? null,
        });
      if (insertErr) {
        return json({ error: `insert failed: ${insertErr.message}` }, 500);
      }
      const attemptsInWindow = await countRecentAttempts(admin, email, ip);
      return json({ recorded: true, attemptsInWindow }, 200);
    }

    if (body.action === "record_success") {
      // On success, clear the rolling window so a legitimate user who
      // fat-fingered their password a few times doesn't stay near the cap.
      await admin
        .from("auth_failed_attempts")
        .delete()
        .eq("email", email)
        .eq("ip", ip)
        .gte("attempted_at", new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString());
      return json({ cleared: true }, 200);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("check-rate-limit error", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function extractClientIp(req: Request): string {
  // Supabase puts the real client IP in x-forwarded-for; first entry is the user.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

async function countRecentAttempts(
  admin: ReturnType<typeof createClient>,
  email: string,
  ip: string,
): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from("auth_failed_attempts")
    .select("*", { count: "exact", head: true })
    .eq("email", email)
    .eq("ip", ip)
    .gte("attempted_at", since);
  if (error) {
    console.error("[check-rate-limit] count error", error);
    return 0;
  }
  return count ?? 0;
}

async function mostRecentAttemptTimestamp(
  admin: ReturnType<typeof createClient>,
  email: string,
  ip: string,
): Promise<number | null> {
  const { data, error } = await admin
    .from("auth_failed_attempts")
    .select("attempted_at")
    .eq("email", email)
    .eq("ip", ip)
    .order("attempted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return new Date(data.attempted_at as string).getTime();
}

async function oldestAttemptTimestamp(
  admin: ReturnType<typeof createClient>,
  email: string,
  ip: string,
): Promise<number | null> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("auth_failed_attempts")
    .select("attempted_at")
    .eq("email", email)
    .eq("ip", ip)
    .gte("attempted_at", since)
    .order("attempted_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return new Date(data.attempted_at as string).getTime();
}

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
