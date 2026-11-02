"""Helper for testing Alejo end to end. Every test guest is named "Test <name>" so cleanup only ever touches test data.

  python execution/e2e_helper.py check                       pre-flight: site, endpoints, n8n workflows, Telegram bot, database, facts
  python execution/e2e_helper.py book Tolu [--in tomorrow] [--nights 2] [--type Deluxe] [--phone +2348012345678]
                                                             create a booking the way the phone assistant does; prints the Telegram link
  python execution/e2e_helper.py status                      test bookings, who is linked, reminders sent, open questions
  python execution/e2e_helper.py checkout-today              move the test stay so it ends today (checkout reminder fires within 15 minutes)
  python execution/e2e_helper.py age-checkout                make the checkout look 31 minutes old (the thank-you fires within 15 minutes)
  python execution/e2e_helper.py cleanup                     delete every "Test ..." guest with its bookings, messages and questions

The scheduler runs every 15 minutes in Lagos time: check-in reminder from 10:00 for stays that start tomorrow,
checkout reminder from 08:00 for stays that end today, thank-you 30 minutes after checkout.
"""
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import supabase_admin as sa  # noqa: E402

for _s in (sys.stdout, sys.stderr):          # staff and guests use emoji; never let the Windows console crash a report
    try:
        _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

E = sa.ENV
SITE = "https://alejo-nine.vercel.app"
FN = E["SUPABASE_URL"] + "/functions/v1"
LAGOS = timezone(timedelta(hours=1))


def http(method, url, body=None, headers=None, timeout=45):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"user-agent": "alejo-e2e/1.0", **({"content-type": "application/json"} if body is not None else {}), **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(txt) if txt.strip()[:1] in "[{" else txt)
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, txt
    except Exception as e:  # network problem
        return 0, str(e)


def ok(flag, text, hint=""):
    print(("  [ok]   " if flag else "  [FAIL] ") + text + ("" if flag else ("   -> " + hint if hint else "")))
    return flag


def check():
    now = datetime.now(LAGOS)
    print(f"Lagos time now: {now:%a %d %b %H:%M}. Check-in reminders can fire from 10:00, checkout reminders from 08:00: "
          f"{'both windows are open' if now.hour >= 10 else 'checkout window open, check-in reminder window opens at 10:00' if now.hour >= 8 else 'both windows are closed until 08:00'}.")
    good = True
    print("Website and endpoints")
    st, _ = http("GET", SITE + "/")
    good &= ok(st == 200, f"site answers at {SITE}", f"got {st}")
    st, _ = http("GET", SITE + "/app")
    good &= ok(st == 200, "dashboard answers at /app", f"got {st}")
    st, _ = http("GET", FN + "/demo-request")
    good &= ok(st == 405, "demo form endpoint is up", f"got {st}")
    st, _ = http("POST", FN + "/staff-reply", {})
    good &= ok(st == 401, "reply endpoint is up and refuses strangers", f"got {st}")
    print("n8n workflows")
    names, cursor = {}, None
    while True:
        st, d = http("GET", E["N8N_BASE_URL"] + "/api/v1/workflows?limit=100" + (f"&cursor={cursor}" if cursor else ""), headers={"X-N8N-API-KEY": E["N8N_API_KEY"]})
        if st != 200:
            good &= ok(False, "n8n reachable", f"got {st}")
            break
        for w in d["data"]:
            names[w["name"]] = w["active"]
        cursor = d.get("nextCursor")
        if not cursor:
            break
    for n in ("Hotel Guest Journey - Telegram Bot", "Hotel Guest Journey - Scheduler", "Hotel Guest Journey - Booking Created", "Hotel Guest Journey - Vapi Tools", "Alejo - Dashboard Reply", "Alejo - Demo Request Alert"):
        good &= ok(names.get(n) is True, "active: " + n, "open n8n and switch it on" if n in names else "missing: run execution/build_n8n_workflows.py")
    print("Telegram")
    st, me = http("GET", f"https://api.telegram.org/bot{E['TELEGRAM_BOT_TOKEN']}/getMe")
    good &= ok(st == 200 and me.get("ok"), "bot answers: @" + str((me.get("result") or {}).get("username")) if st == 200 else "bot answers", f"got {st}")
    st, wh = http("GET", f"https://api.telegram.org/bot{E['TELEGRAM_BOT_TOKEN']}/getWebhookInfo")
    r = (wh.get("result") or {}) if isinstance(wh, dict) else {}
    good &= ok(bool(r.get("url")) and not r.get("last_error_message"), "webhook set and no delivery errors", str(r.get("last_error_message")))
    print("Database and facts")
    c = sa.run_sql("select (select count(*) from knowledge_entries) kb, (select count(*) from hotel_settings where value<>'') facts, (select count(*) from hotel_settings where value='') blank, (select count(*) from staff_users) staff, (select count(*) from room_types where active) rooms")[0]
    good &= ok(c["kb"] > 0, f"{c['kb']} knowledge answers loaded", "run execution/load_knowledge.py")
    good &= ok(c["facts"] > 0, f"{c['facts']} facts filled in ({c['blank']} blank, those answers are held back)")
    good &= ok(c["rooms"] > 0, f"{c['rooms']} room types for phone bookings")
    ok(c["staff"] > 0, f"{c['staff']} dashboard login(s)", "create yours: python execution/supabase_admin.py staff-user you@email.com \"Your Name\" owner")
    print("\nREADY" if good else "\nFix the [FAIL] lines above, then run check again.")


def parse_day(word):
    today = datetime.now(LAGOS).date()
    if word in (None, "tomorrow"):
        return today + timedelta(days=1)
    if word == "today":
        return today
    return datetime.strptime(word, "%Y-%m-%d").date()


def book(args):
    name = args[0]
    opt = {a: args[i + 1] for i, a in enumerate(args) if a.startswith("--") and i + 1 < len(args)}
    start = parse_day(opt.get("--in"))
    end = start + timedelta(days=int(opt.get("--nights", 2)))
    body = {"name": "Test " + name, "check_in": start.isoformat(), "check_out": end.isoformat(), "room_type": opt.get("--type", "Deluxe")}
    if "--phone" in opt:
        body["phone"] = opt["--phone"]
    st, out = http("POST", E["N8N_BASE_URL"] + "/webhook/guest-booking-created", body, {"x-webhook-secret": E["BOOKING_WEBHOOK_SECRET"]})
    if st != 200:
        sys.exit(f"Booking failed ({st}): {out}")
    ref = out["booking_id"][:8].upper()
    print(f"Booked: Test {name}, {body['room_type']}, {start} to {end}. Reference {ref}")
    print("Open this on the phone that has Telegram, then press Start:\n  " + out["telegram_link"])


def status():
    rows = sa.run_sql("""select g.name, b.id, b.status, b.check_in, b.check_out, (g.telegram_chat_id is not null) as linked,
        b.reminder_sent_at, b.checked_in_at, b.checkout_reminder_sent_at, b.checked_out_at, b.thanks_sent_at
        from bookings b join guests g on g.id = b.guest_id where g.name like 'Test %' order by b.created_at desc""")
    if not rows:
        print("No test bookings yet. Create one: python execution/e2e_helper.py book Tolu --in tomorrow")
    for r in rows:
        t = lambda k: (r[k] or "")[11:16] + " UTC" if r[k] else "-"
        print(f"{r['name']}  ref {r['id'][:8].upper()}  {r['status']}  {r['check_in']} to {r['check_out']}")
        print(f"   on Telegram: {'yes' if r['linked'] else 'NO, open the link and press Start'} | reminder {t('reminder_sent_at')} | checked in {t('checked_in_at')} | "
              f"checkout reminder {t('checkout_reminder_sent_at')} | checked out {t('checked_out_at')} | thank-you {t('thanks_sent_at')}")
    q = sa.run_sql("select e.status, left(e.question, 60) q, left(coalesce(e.staff_answer, ''), 50) a from escalations e join guests g on g.id = e.guest_id where g.name like 'Test %' order by e.created_at desc limit 8")
    for e in q:
        print(f"   question [{e['status']}]: {e['q']}" + (f"  ->  {e['a']}" if e["a"] else ""))


def checkout_today():
    today = datetime.now(LAGOS).date()
    r = sa.run_sql(f"update bookings b set check_out = '{today}', check_in = least(check_in, '{today - timedelta(days=1)}') from guests g where g.id = b.guest_id and g.name like 'Test %' and b.status = 'checked_in' returning b.id")
    print(f"Moved {len(r)} checked-in test stay(s) to end today. The checkout reminder arrives within 15 minutes." if r else
          "No test stay is checked in yet. In Telegram, tap Check in on the reminder first, then run this again.")


def age_checkout():
    r = sa.run_sql("update bookings b set checked_out_at = now() - interval '31 minutes' from guests g where g.id = b.guest_id and g.name like 'Test %' and b.status = 'checked_out' and b.thanks_sent_at is null returning b.id")
    print(f"Aged {len(r)} checkout(s). The thank-you arrives within 15 minutes." if r else "No test stay is checked out yet. Tap Check out in Telegram first.")


def cleanup():
    ids = "select id from guests where name like 'Test %'"
    sa.run_sql(f"delete from knowledge_entries where id in (select 'staff-' || id::text from escalations where guest_id in ({ids}))")
    sa.run_sql(f"delete from messages where guest_id in ({ids})")
    sa.run_sql(f"delete from escalations where guest_id in ({ids})")
    n = sa.run_sql(f"delete from guests where name like 'Test %' returning id")
    print(f"Removed {len(n)} test guest(s) with their bookings, messages and questions.")


if __name__ == "__main__":
    a = sys.argv[1:]
    cmd = a[0] if a else ""
    if cmd == "check":
        check()
    elif cmd == "book" and len(a) > 1:
        book(a[1:])
    elif cmd == "status":
        status()
    elif cmd == "checkout-today":
        checkout_today()
    elif cmd == "age-checkout":
        age_checkout()
    elif cmd == "cleanup":
        cleanup()
    else:
        sys.exit(__doc__)
