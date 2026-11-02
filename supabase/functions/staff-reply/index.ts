// Lets signed-in Alejo staff answer a guest from the dashboard.
// Flow: dashboard -> this function (checks the caller's token and that their email is in staff_users) -> n8n "Alejo - Dashboard Reply"
// (forwards to the guest on Telegram, marks the escalation answered, optionally saves the answer to the knowledge base).
// Deployed with verify_jwt=true, but the anon key is also a valid JWT, so the staff check below is what really gates access.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Filled in by execution/supabase_admin.py at deploy time from .env; never committed.
const REPLY_URL = "__ENV:N8N_BASE_URL__/webhook/__ENV:DASH_REPLY_PATH__";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
// Sites allowed to call this from a browser. Add the custom domain here when there is one.
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://alejo-nine.vercel.app,http://127.0.0.1:8077,http://localhost:8077").split(",").map((s) => s.trim()).filter(Boolean);
const cors = (origin: string | null) => ({
  "access-control-allow-origin": ALLOWED.includes("*") ? "*" : (origin !== null && ALLOWED.includes(origin) ? origin : ALLOWED[0] ?? ""),
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "vary": "origin",
});
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors(origin) } });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await db.auth.getUser(token);
  const email = auth?.user?.email?.toLowerCase();
  if (authErr || !email) return json({ error: "Please sign in again." }, 401, origin);

  const { data: staff } = await db.from("staff_users").select("name").ilike("email", email).maybeSingle();
  if (!staff) return json({ error: "This account is not on the staff list." }, 403, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Send JSON." }, 400, origin); }
  const escalation_id = String(body.escalation_id ?? "");
  const answer = String(body.answer ?? "").trim().slice(0, 1500);
  if (!/^[0-9a-f-]{36}$/i.test(escalation_id) || !answer) return json({ error: "Write a reply first." }, 400, origin);

  try {
    const r = await fetch(REPLY_URL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ escalation_id, answer, learn: body.learn === true, by: staff.name || email }),
      signal: AbortSignal.timeout(20000),
    });
    const out = await r.json().catch(() => ({}));
    return json(r.ok ? { ok: true } : { error: out.error ?? "Could not send the reply." }, r.ok ? 200 : r.status, origin);
  } catch (e) {
    console.error("reply failed", String(e));
    return json({ error: "Could not reach the messaging service. Try again." }, 502, origin);
  }
});
