// Telegram API relay for n8n (its host cannot reach api.telegram.org).
// Deployed with verify_jwt=false; access is gated by the secret in the path instead.
//
// Two ways in:
//  1. /telegram-proxy/{SECRET}/bot<token>/<method>        the old way: the caller supplies the bot token (kept while old workflows exist)
//  2. /telegram-proxy/{SECRET}/hotel/<hotelId>/<method>   the hotel way: the relay looks up THAT hotel's bot token itself, so
//                                                         n8n never holds a token and one workflow can speak as any hotel.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SECRET = "__ENV:TELEGRAM_PROXY_SECRET__";   // filled in from .env at deploy time by execution/supabase_admin.py; never committed
const MARKER = "/telegram-proxy/";
const METHODS = new Set(["sendMessage", "answerCallbackQuery", "sendChatAction", "editMessageText", "editMessageReplyMarkup", "deleteMessage"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const tokens = new Map<string, { token: string; at: number }>();       // hotel id -> bot token, kept for a minute

async function tokenOf(hotelId: string): Promise<string | null> {
  const hit = tokens.get(hotelId);
  if (hit && Date.now() - hit.at < 60_000) return hit.token;
  const { data } = await db.from("hotel_secrets").select("telegram_bot_token").eq("hotel_id", hotelId).maybeSingle();
  const token = data?.telegram_bot_token as string | undefined;
  if (!token) return null;
  tokens.set(hotelId, { token, at: Date.now() });
  return token;
}

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const i = url.pathname.indexOf(MARKER);
  const rest = i >= 0 ? url.pathname.slice(i + MARKER.length) : "";
  if (!rest.startsWith(SECRET + "/")) return new Response("Not found", { status: 404 });
  const tail = rest.slice(SECRET.length + 1);

  // ---- the hotel way
  const m = tail.match(/^hotel\/([^/]+)\/([A-Za-z]+)$/);
  if (m) {
    const [, hotelId, method] = m;
    if (req.method !== "POST" || !UUID.test(hotelId) || !METHODS.has(method)) return json({ ok: false, description: "Not allowed" }, 400);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ ok: false, description: "Send JSON" }, 400); }
    const token = await tokenOf(hotelId.toLowerCase());
    if (!token) return json({ ok: false, description: "This hotel has no Telegram bot configured" }, 404);
    if (typeof body.reply_markup === "string") {       // n8n can only build strings; Telegram wants an object in a JSON body
      try { body.reply_markup = JSON.parse(body.reply_markup); } catch { delete body.reply_markup; }
    }
    return await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
  }

  // ---- the old way
  if (!/^(file\/)?bot/.test(tail)) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return await fetch("https://api.telegram.org/" + tail + url.search, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
  });
});
