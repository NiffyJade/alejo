// Receives demo requests from the Alejo website, stores them, and pings the team on Telegram.
// Deployed with verify_jwt=false (it is a public form); it defends itself with validation,
// a honeypot field and a per-IP rate limit. Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_STAFF_CHAT_ID, ALLOWED_ORIGINS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
// Filled in by execution/supabase_admin.py at deploy time from .env (N8N_BASE_URL + DEMO_ALERT_PATH); never committed.
const ALERT_URL = "__ENV:N8N_BASE_URL__/webhook/__ENV:DEMO_ALERT_PATH__";
// Sites allowed to call this from a browser. Add the custom domain here when there is one.
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://alejo-nine.vercel.app,http://127.0.0.1:8077,http://localhost:8077").split(",").map((s) => s.trim()).filter(Boolean);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const cors = (origin: string | null) => {
  const ok = ALLOWED.includes("*") || (origin !== null && ALLOWED.includes(origin));
  return {
    "access-control-allow-origin": ok ? (origin ?? "*") : ALLOWED[0] ?? "",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "origin",
  };
};
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors(origin) } });

const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!ALLOWED.includes("*") && (origin === null || !ALLOWED.includes(origin))) return json({ error: "Not allowed" }, 403, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Send JSON." }, 400, origin); }

  if (clean(body.website, 200)) return json({ ok: true }, 200, origin);          // honeypot: bots fill it, people never see it

  const email = clean(body.email, 200).toLowerCase();
  const hotel = clean(body.hotel, 120);
  const rooms = clean(body.rooms, 40);
  if (!EMAIL.test(email)) return json({ error: "That email address does not look right." }, 400, origin);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ip_hash = await sha256("alejo|" + ip);
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await db.from("demo_requests").select("id", { count: "exact", head: true }).eq("ip_hash", ip_hash).gte("created_at", since);
  if ((count ?? 0) >= 3) return json({ error: "Too many requests. Please try again in a few minutes." }, 429, origin);

  const { error } = await db.from("demo_requests").insert({ email, hotel, rooms, ip_hash });
  if (error) { console.error("insert failed", error.message); return json({ error: "Something went wrong. Please try again." }, 500, origin); }

  // Telling the team is best effort: the request is already saved. n8n holds the Telegram credential.
  try {
    await fetch(ALERT_URL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ hotel, email, rooms }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) { console.error("alert failed", String(e)); }
  return json({ ok: true }, 200, origin);
});
