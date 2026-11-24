// @ts-nocheck (the block between the pure:start and pure:end markers is plain JavaScript so Node can test it: execution/test_staff_team.js)
// The owner's Team screen: list the hotel's team, add a person, change a role, remove a person, reset a password.
// Flow: dashboard -> this function (checks the caller's token, and that the caller is the OWNER of that hotel or Alejo's admin) -> staff_users
// and the login (Supabase auth admin API, which only the service role may use). Nothing here is reachable from the browser's own database access.
// New and reset logins get a one-time password that the owner hands over; the account is flagged so the person MUST choose their own
// password the first time they sign in (so the owner never keeps a working password, and cannot reach another hotel the person joins later).
// Deployed with verify_jwt=true, but the anon key is also a valid JWT, so the owner check below is what really gates access.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://alejo-nine.vercel.app,http://127.0.0.1:8077,http://localhost:8077").split(",").map((s) => s.trim()).filter(Boolean);
const cors = (origin: string | null) => ({
  "access-control-allow-origin": ALLOWED.includes("*") ? "*" : (origin !== null && ALLOWED.includes(origin) ? origin : ALLOWED[0] ?? ""),
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "vary": "origin",
});
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors(origin) } });

// ---- pure:start (plain JavaScript on purpose: execution/test_staff_team.js runs this block in Node)
const ROLES = ["staff", "manager", "owner"];
const EMAIL = /^[^\s@'"<>,;]+@[^\s@'"<>,;]+\.[^\s@'"<>,;]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const no = (error, status) => ({ error, status });

// May this caller do this? caller = { email, role } (role 'owner' or 'admin' at THIS hotel), team = every staff row of the hotel,
// target = { email, isAdmin (a platform admin), otherHotels (how many OTHER hotels they work at) }, role = the role being given.
function decide(a) {
  if (!a.caller || (a.caller.role !== "owner" && a.caller.role !== "admin")) return no("Only the hotel's owner can manage the team.", 403);
  if (a.action === "list") return { ok: true };
  const email = a.target && a.target.email, onTeam = (a.team || []).find((t) => t.email === email);
  const self = email === a.caller.email, owners = (a.team || []).filter((t) => t.role === "owner").length;
  if (a.action === "add") {
    if (!EMAIL.test(email || "") || email.length > 120) return no("Enter a valid email address.", 400);
    if (!ROLES.includes(a.role)) return no("Choose staff, manager or owner.", 400);
    if (onTeam) return no("That person is already on the team.", 409);
    return { ok: true };
  }
  if (!onTeam) return no("That person is not on this hotel's team.", 404);
  if (a.target.isAdmin && a.caller.role !== "admin") return no("That account belongs to Alejo's own team and cannot be changed here.", 403);
  if (a.action === "set_role") {
    if (!ROLES.includes(a.role)) return no("Choose staff, manager or owner.", 400);
    if (self) return no("You cannot change your own role.", 400);
    if (onTeam.role === "owner" && a.role !== "owner" && owners <= 1) return no("A hotel needs at least one owner.", 400);
    return { ok: true };
  }
  if (a.action === "remove") {
    if (self) return no("You cannot remove yourself.", 400);
    if (onTeam.role === "owner" && owners <= 1) return no("A hotel needs at least one owner.", 400);
    return { ok: true };
  }
  if (a.action === "reset_password") {
    if (self) return no("Use Change password in the header to change your own password.", 400);
    if (a.target.otherHotels > 0) return no("This person also works at another hotel, so only they can change their password.", 403);
    return { ok: true };
  }
  return no("Unknown action.", 400);
}
function newPassword() {                                     // 14 characters, no look-alikes (0/O, 1/l/I), from a secure random source
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", out = [], buf = new Uint8Array(32);
  while (out.length < 14) { crypto.getRandomValues(buf); for (const b of buf) { if (b < 228 && out.length < 14) out.push(A[b % A.length]); } }   // 228 = 57 x 4: no modulo bias
  return out.join("");
}
// ---- pure:end

const likeEsc = (s: string) => s.replace(/[\\%_]/g, "\\$&");
async function roleAt(email: string, hotelId: string): Promise<string | null> {
  const [{ data: row }, { data: admin }] = await Promise.all([
    db.from("staff_users").select("role").eq("hotel_id", hotelId).ilike("email", likeEsc(email)).maybeSingle(),
    db.from("platform_admins").select("email").eq("email", email).maybeSingle(),
  ]);
  return admin ? "admin" : (row ? row.role : null);
}
async function findLogin(email: string) {                    // the login (auth user) with this email, if any
  for (let page = 1; page <= 10; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    const hit = data?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit || !data?.users || data.users.length < 1000) return hit ?? null;
  }
  return null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await db.auth.getUser(token);
  const caller = auth?.user?.email?.toLowerCase();
  if (authErr || !caller) return json({ error: "Please sign in again." }, 401, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Send JSON." }, 400, origin); }
  const hotelId = String(body.hotel_id ?? "").toLowerCase();
  if (!UUID.test(hotelId)) return json({ error: "Choose a hotel first." }, 400, origin);
  const action = String(body.action ?? "");
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "");
  const name = String(body.name ?? "").trim().slice(0, 80);

  const callerRole = await roleAt(caller, hotelId);
  const { data: team, error: teamErr } = await db.from("staff_users").select("email,name,role,created_at").eq("hotel_id", hotelId).order("created_at");
  if (teamErr) return json({ error: "Could not read the team." }, 500, origin);
  const lowered = (team ?? []).map((t) => ({ ...t, email: String(t.email).toLowerCase() }));

  // facts about the person being changed (only looked up when there is one)
  let target = { email, isAdmin: false, otherHotels: 0 };
  if (email && action !== "list") {
    const [{ data: adm }, { count }] = await Promise.all([
      db.from("platform_admins").select("email").eq("email", email).maybeSingle(),
      db.from("staff_users").select("email", { count: "exact", head: true }).ilike("email", likeEsc(email)).neq("hotel_id", hotelId),
    ]);
    target = { email, isAdmin: !!adm, otherHotels: count ?? 0 };
  }
  const verdict = decide({ action, caller: callerRole ? { email: caller, role: callerRole } : null, team: lowered, target, role });
  if (verdict.error) return json({ error: verdict.error }, verdict.status, origin);

  try {
    if (action === "list") return json({ team: lowered.map((t) => ({ email: t.email, name: t.name, role: t.role })), you: caller, your_role: callerRole }, 200, origin);

    if (action === "add") {
      if (!name) return json({ error: "Enter the person's name." }, 400, origin);
      const existing = await findLogin(email);
      let password: string | null = null;
      if (!existing) {                                       // a brand-new login: one-time password, must be changed at first sign-in
        password = newPassword();
        const { error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { must_change_password: true } });
        if (error) return json({ error: "Could not create the login: " + error.message }, 400, origin);
      }                                                      // an existing login keeps its own password: the owner is never given it
      const { error } = await db.from("staff_users").insert({ hotel_id: hotelId, email, name, role });
      if (error) return json({ error: "Could not add the person." }, 400, origin);
      console.log("team: added", email, role, "to", hotelId, "by", caller);
      return json({ ok: true, password, existing_login: !!existing }, 200, origin);
    }
    if (action === "set_role") {
      const { error } = await db.from("staff_users").update({ role }).eq("hotel_id", hotelId).ilike("email", likeEsc(email));
      if (error) return json({ error: "Could not change the role." }, 400, origin);
      console.log("team: role of", email, "->", role, "at", hotelId, "by", caller);
      return json({ ok: true }, 200, origin);
    }
    if (action === "remove") {
      const { error } = await db.from("staff_users").delete().eq("hotel_id", hotelId).ilike("email", likeEsc(email));
      if (error) return json({ error: "Could not remove the person." }, 400, origin);
      // a login that no longer belongs to any hotel (and is not Alejo's admin) is switched off completely
      if (target.otherHotels === 0 && !target.isAdmin) {
        const login = await findLogin(email);
        if (login) await db.auth.admin.deleteUser(login.id);
      }
      console.log("team: removed", email, "from", hotelId, "by", caller);
      return json({ ok: true }, 200, origin);
    }
    if (action === "reset_password") {
      const login = await findLogin(email);
      if (!login) return json({ error: "This person has no login yet." }, 404, origin);
      const password = newPassword();
      const { error } = await db.auth.admin.updateUserById(login.id, { password, user_metadata: { ...(login.user_metadata ?? {}), must_change_password: true } });
      if (error) return json({ error: "Could not reset the password." }, 400, origin);
      console.log("team: password reset for", email, "at", hotelId, "by", caller);
      return json({ ok: true, password }, 200, origin);
    }
  } catch (e) {
    console.error("team failed", String(e));
    return json({ error: "Something went wrong. Try again." }, 502, origin);
  }
  return json({ error: "Unknown action." }, 400, origin);
});
