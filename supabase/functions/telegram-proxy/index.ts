// Telegram API relay for n8n (its host cannot reach api.telegram.org).
// Deployed with verify_jwt=false; access is gated by the secret in the path instead.
// n8n Telegram credential baseUrl = https://<project>.supabase.co/functions/v1/telegram-proxy/{SECRET}
const SECRET = "__ENV:TELEGRAM_PROXY_SECRET__";   // filled in from .env at deploy time by execution/supabase_admin.py; never committed
const MARKER = "/telegram-proxy/";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const i = url.pathname.indexOf(MARKER);
  const rest = i >= 0 ? url.pathname.slice(i + MARKER.length) : "";
  if (!rest.startsWith(SECRET + "/")) return new Response("Not found", { status: 404 });
  const tail = rest.slice(SECRET.length + 1);
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
