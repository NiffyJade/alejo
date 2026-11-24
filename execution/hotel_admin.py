"""Hotel administration for Alejo (one command per job). Credentials come from .env and are never printed.

Usage (from the project root):
  python -I execution/hotel_admin.py list
  python -I execution/hotel_admin.py add SLUG "Hotel Name" [--tz=Africa/Lagos]
  python -I execution/hotel_admin.py set-bot SLUG --token-env=NAME --staff-chat=-100123456 [--username=SomeBot]
        (reads the bot token from the .env variable NAME, stores it in hotel_secrets, makes the webhook secrets if missing)
  python -I execution/hotel_admin.py webhook SLUG        (points the hotel's Telegram bot at the n8n workflow, with its secret)
  python -I execution/hotel_admin.py webhook-info SLUG   (what Telegram says about the hotel's webhook; no secrets)
  python -I execution/hotel_admin.py rooms SLUG FILE.json        (load room types; an existing one keeps its count and on/off switch)
  python -I execution/hotel_admin.py facts SLUG FILE.json        (load the hotel's own knowledge entries; same id = refreshed)
  python -I execution/hotel_admin.py pause|resume SLUG            (switch a hotel off/on: the scheduler and bookings skip a switched-off hotel)
  python -I execution/hotel_admin.py adopt-legacy-secrets SLUG   (the pre-multi-hotel phone/booking secrets from .env become this hotel's)
  python -I execution/hotel_admin.py staff SLUG EMAIL "Name" [owner|manager|staff]   (login + staff row for that hotel)

The bot token lives only in the hotel_secrets table (service role) from then on; the .env copy can be removed.
"""
import json
import re
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import supabase_admin as sa  # noqa: E402

ENV = sa.ENV


def q(sql):
    return sa.run_sql(sql)


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def hotel(slug):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,38}", slug or ""):
        sys.exit("bad hotel slug (lowercase letters, digits, dashes)")
    rows = q(f"select id, slug, name, timezone, staff_chat_id, bot_username, active from hotels where slug = {lit(slug)}")
    if not rows:
        sys.exit(f"no hotel with slug '{slug}'")
    return rows[0]


def telegram(token, method, body=None):
    # straight to Telegram from this computer (the n8n host cannot reach it; this machine can)
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/{method}", data=json.dumps(body or {}).encode(),
                                 headers={"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode() or "{}")


def token_of(h):
    rows = q(f"select telegram_bot_token as t from hotel_secrets where hotel_id = {lit(h['id'])}")
    if not rows or not rows[0]["t"]:
        sys.exit("this hotel has no bot token yet (use set-bot)")
    return rows[0]["t"]


def main(a):
    if not a:
        sys.exit(__doc__)
    cmd = a[0]
    opt = {x.split("=", 1)[0]: x.split("=", 1)[1] for x in a if x.startswith("--") and "=" in x}
    pos = [x for x in a[1:] if not x.startswith("--")]
    if cmd == "list":
        for r in q("select h.slug, h.name, h.timezone, h.active, h.staff_chat_id, h.bot_username, (s.telegram_bot_token is not null) as has_token, "
                   "(s.telegram_webhook_secret is not null) as has_secret from hotels h left join hotel_secrets s on s.hotel_id = h.id order by h.created_at"):
            print(json.dumps(r))
    elif cmd == "add":
        slug, name = pos[0], pos[1]
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,38}", slug):
            sys.exit("bad hotel slug")
        tz = opt.get("--tz", "Africa/Lagos")
        if not q(f"select 1 from pg_timezone_names where name = {lit(tz)}"):
            sys.exit(f"unknown timezone {tz}")
        q(f"insert into hotels (slug, name, timezone) values ({lit(slug)}, {lit(name)}, {lit(tz)})")
        q(f"insert into hotel_secrets (hotel_id) select id from hotels where slug = {lit(slug)} on conflict do nothing")
        print("hotel added:", slug)
    elif cmd == "set-bot":
        h = hotel(pos[0])
        token = ENV.get(opt.get("--token-env", ""))
        if not token or not re.fullmatch(r"\d{6,}:[A-Za-z0-9_-]{30,}", token):
            sys.exit("--token-env must name a .env variable holding a Telegram bot token")
        me = telegram(token, "getMe")
        if not me.get("ok"):
            sys.exit("Telegram refused that token: " + str(me.get("description")))
        username = me["result"]["username"]
        chat = opt.get("--staff-chat")
        if chat and not re.fullmatch(r"-?\d{5,}", chat):
            sys.exit("bad --staff-chat")
        q(f"insert into hotel_secrets (hotel_id) values ({lit(h['id'])}) on conflict do nothing")
        q(f"update hotel_secrets set telegram_bot_token = {lit(token)}, "
          f"telegram_webhook_secret = coalesce(telegram_webhook_secret, {lit(secrets.token_urlsafe(32))}), "
          f"vapi_tools_secret = coalesce(vapi_tools_secret, {lit(secrets.token_urlsafe(32))}), "
          f"booking_webhook_secret = coalesce(booking_webhook_secret, {lit(secrets.token_urlsafe(32))}), updated_at = now() where hotel_id = {lit(h['id'])}")
        q(f"update hotels set bot_username = {lit(opt.get('--username', username))}" + (f", staff_chat_id = {chat}" if chat else "") + f" where id = {lit(h['id'])}")
        print(f"bot stored for {h['slug']}: @{username}" + (f", staff chat {chat}" if chat else ""))
    elif cmd == "webhook":
        h = hotel(pos[0])
        path = ENV.get("TG_WEBHOOK_PATH")
        if not path:
            sys.exit("TG_WEBHOOK_PATH is not in .env yet (the workflow builder creates it)")
        sec = q(f"select telegram_webhook_secret as s from hotel_secrets where hotel_id = {lit(h['id'])}")[0]["s"]
        if not sec:
            sys.exit("no webhook secret yet (use set-bot)")
        url = f"{ENV['N8N_BASE_URL']}/webhook/{path}"
        r = telegram(token_of(h), "setWebhook", {"url": url, "secret_token": sec, "allowed_updates": ["message", "callback_query"], "drop_pending_updates": False})
        print("setWebhook ->", r.get("ok"), r.get("description"))
    elif cmd == "webhook-info":
        h = hotel(pos[0])
        r = telegram(token_of(h), "getWebhookInfo").get("result", {})
        r["url"] = re.sub(r"/webhook/.*", "/webhook/…", r.get("url", ""))
        print(json.dumps({k: r.get(k) for k in ("url", "pending_update_count", "last_error_date", "last_error_message", "has_custom_certificate")}))
    elif cmd == "rooms":
        # load room types from a JSON file ({"rooms": [{name, nightly_rate, total_rooms, active, description}]}).
        # An existing room type keeps its room COUNT and on/off switch; only its rate and description are refreshed.
        h = hotel(pos[0])
        data = json.loads(Path(pos[1]).read_text(encoding="utf-8"))["rooms"]
        for r in data:
            name = str(r["name"]).strip()
            rate, total = float(r["nightly_rate"]), int(r.get("total_rooms", 0))
            if not name or len(name) > 60 or rate < 0 or total < 0:
                sys.exit(f"bad room entry: {r}")
            q(f"insert into room_types (hotel_id, name, total_rooms, nightly_rate, description, active) values ({lit(h['id'])}, {lit(name)}, {total}, {rate}, "
              f"{lit(r.get('description', ''))}, {'true' if r.get('active', False) else 'false'}) "
              f"on conflict (hotel_id, name) do update set nightly_rate = excluded.nightly_rate, description = excluded.description")
        if "--replace" in a:
            # drop room types that are NOT in the file, but never one a booking or block still refers to
            keep = ", ".join(lit(str(r["name"]).strip()) for r in data)
            gone = [r["name"] for r in q(f"select name from room_types where hotel_id = {lit(h['id'])} and name not in ({keep})")]
            for name in gone:
                used = q(f"select (select count(*) from bookings where hotel_id = {lit(h['id'])} and room_type = {lit(name)}) + "
                         f"(select count(*) from room_blocks where hotel_id = {lit(h['id'])} and room_type = {lit(name)}) as n")[0]["n"]
                if used:
                    sys.exit(f"cannot remove '{name}': {used} booking(s) or block(s) still use it")
            for name in gone:
                q(f"delete from room_types where hotel_id = {lit(h['id'])} and name = {lit(name)}")
            print("removed room types not in the file:", gone or "none")
        for r in q(f"select name, total_rooms, nightly_rate, active from room_types where hotel_id = {lit(h['id'])} order by nightly_rate"):
            print(json.dumps(r))
    elif cmd == "facts":
        # load a hotel's own knowledge entries from a JSON file ({"entries": [{id, category, question, answer, source?}]}).
        # Existing entries with the same id are refreshed; every entry is withheld by the bot only if it holds a [[PLACEHOLDER]] with no value.
        h = hotel(pos[0])
        data = json.loads(Path(pos[1]).read_text(encoding="utf-8"))["entries"]
        for e in data:
            eid, cat, qn, ans = (str(e[k]).strip() for k in ("id", "category", "question", "answer"))
            src = e.get("source", "staff")
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,60}", eid) or not qn or not ans or src not in ("seed", "staff"):
                sys.exit(f"bad entry: {e.get('id')}")
            q(f"insert into knowledge_entries (hotel_id, id, category, question, answer, source) values ({lit(h['id'])}, {lit(eid)}, {lit(cat)}, {lit(qn)}, {lit(ans)}, {lit(src)}) "
              f"on conflict (hotel_id, id) do update set category = excluded.category, question = excluded.question, answer = excluded.answer")
        for r in q(f"select id, category, left(answer, 70) as answer from knowledge_entries where hotel_id = {lit(h['id'])} order by id"):
            print(json.dumps(r, ensure_ascii=False))
    elif cmd == "find-chats":
        # which chats has this hotel's bot been added to / spoken to? (id, type and title only; works until the bot's webhook is set)
        h = hotel(pos[0])
        r = telegram(token_of(h), "getUpdates", {"limit": 100, "timeout": 0})
        if not r.get("ok"):
            sys.exit("Telegram says: " + str(r.get("description")) + " (a bot with a webhook set cannot list chats this way)")
        seen = {}
        for u in r.get("result", []):
            m = u.get("message") or u.get("my_chat_member") or u.get("channel_post") or {}
            c = m.get("chat")
            if c:
                seen[c["id"]] = {"chat_id": c["id"], "type": c.get("type"), "title": c.get("title") or c.get("first_name") or ""}
        print(json.dumps(list(seen.values()), ensure_ascii=False) if seen else "no chats yet: add the bot to the staff group and send a message there, then run this again")
    elif cmd == "pause" or cmd == "resume":
        h = hotel(pos[0])
        q(f"update hotels set active = {'false' if cmd == 'pause' else 'true'} where id = {lit(h['id'])}")
        print(h["slug"], "is now", "switched off" if cmd == "pause" else "switched on")
    elif cmd == "adopt-legacy-secrets":
        # the phone assistant and booking caller that existed BEFORE multi-hotel use the shared secrets from .env: give them to this hotel
        h = hotel(pos[0])
        vs, bs = ENV.get("VAPI_TOOLS_SECRET"), ENV.get("BOOKING_WEBHOOK_SECRET")
        if not vs or not bs:
            sys.exit("VAPI_TOOLS_SECRET and BOOKING_WEBHOOK_SECRET must be in .env")
        q(f"update hotel_secrets set vapi_tools_secret = {lit(vs)}, booking_webhook_secret = {lit(bs)}, updated_at = now() where hotel_id = {lit(h['id'])}")
        print("this hotel now accepts the existing phone-assistant and booking-webhook secrets")
    elif cmd == "staff":
        h = hotel(pos[0])
        pw = sa.staff_user(pos[1], pos[2] if len(pos) > 2 else "", pos[3] if len(pos) > 3 else "staff", "--reset" in a, h["slug"])
        print("staff user ready:", pos[1], "for", h["slug"], "| one-time password:", pw if pw else "(account already existed, password unchanged; use --reset)")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
