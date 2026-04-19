// Edge function: send-password-reset
// Sends a Supabase password-recovery email via Supabase's built-in SMTP
// (Free tier) to one or more emails. Also flips public.profiles.force_password_change
// = true for the matched users so they land on /change-password after logging
// in with the new password.
//
// Invocation:
//   POST /functions/v1/send-password-reset
//   Headers: Authorization: Bearer <SERVICE_ROLE_KEY>
//   Body: { "emails": ["user@example.com"], "redirectTo"?: "https://.../reset-password" }
//
// Security: this function REQUIRES the SERVICE_ROLE_KEY as the bearer token.
// Never expose this endpoint to anon clients.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  emails: string[];
  redirectTo?: string;
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

    // Require the caller to present the service role key.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || token !== serviceRoleKey) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body || !Array.isArray(body.emails) || body.emails.length === 0) {
      return json({ error: "Body must include emails: string[]" }, 400);
    }

    const origin =
      req.headers.get("origin") ||
      Deno.env.get("APP_URL") ||
      "https://aluminiapp.lovable.app";
    const redirectTo = body.redirectTo ?? `${origin}/reset-password`;

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const results: Array<{
      email: string;
      status: "sent" | "skipped" | "error";
      error?: string;
    }> = [];

    for (const rawEmail of body.emails) {
      const email = String(rawEmail ?? "").toLowerCase().trim();
      if (!email) {
        results.push({ email: rawEmail as string, status: "error", error: "empty email" });
        continue;
      }

      try {
        // 1) Flip the force_password_change flag on the user's profile.
        //    Look up the user id via admin API (by email) so we can update the flag.
        const { data: userList, error: listErr } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });

        if (listErr) {
          results.push({ email, status: "error", error: `list users: ${listErr.message}` });
          continue;
        }

        const user = userList?.users?.find(
          (u) => (u.email ?? "").toLowerCase() === email,
        );

        if (!user) {
          results.push({ email, status: "skipped", error: "user not found" });
          continue;
        }

        const { error: flagErr } = await admin
          .from("profiles")
          .update({ force_password_change: true })
          .eq("user_id", user.id);

        if (flagErr) {
          // Non-fatal: still send the email.
          console.error("[send-password-reset] flag update failed", email, flagErr);
        }

        // 2) Ask Supabase Auth to send the recovery email via its built-in SMTP.
        //    This works on Free tier and can deliver to any email address.
        const { error: resetErr } = await admin.auth.resetPasswordForEmail(email, {
          redirectTo,
        });

        if (resetErr) {
          results.push({ email, status: "error", error: resetErr.message });
          continue;
        }

        results.push({ email, status: "sent" });
      } catch (err) {
        results.push({ email, status: "error", error: (err as Error).message });
      }
    }

    return json({ results }, 200);
  } catch (err) {
    console.error("send-password-reset error", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
