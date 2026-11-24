"""Live test of the Telegram bot's service handling (event hall, pool ...) with the REAL AI, on a throwaway hotel and a fake chat.

Usage (from the project root):   python -I -X utf8 execution/test_bot_services_live.py

Creates a temporary hotel (zz-svcbot) with a fake staff chat and a fake bot token, an event hall (one booking per day) with one booking
ten days from now, and a pool. It sends simulated guest messages to the bot's webhook with that hotel's secret and reads what the
workflow decided from the n8n run (the "Compose reply" output). Telegram cannot deliver to fake chats and the staff alert goes to a fake
group, so each run ends at a send step with "chat not found" / "Unauthorized": that is expected and ignored. NOTHING reaches a real chat or
BrightSide's staff group. Everything created is deleted at the end, even if a check fails. No secret is printed.
"""
import json
import secrets
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import supabase_admin as sa  # noqa: E402
import build_n8n_workflows as b  # noqa: E402

ENV = sa.ENV
FAKE_CHAT = 990000999
SLUG = "zz-svcbot"
results = []


def q(sql):
    return sa.run_sql(sql)


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  -> " + str(detail)[:300]))


def post(path, body, secret):
    req = urllib.request.Request(f"{ENV['N8N_BASE_URL']}/webhook/{path}", data=json.dumps(body).encode(), method="POST",
                                 headers={"content-type": "application/json", "user-agent": "alejo-test/1.0", "x-telegram-bot-api-secret-token": secret})
    for _ in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(5)
    return 0


def update(text, uid):
    return {"update_id": uid, "message": {"message_id": uid, "date": int(time.time()), "chat": {"id": FAKE_CHAT, "type": "private", "first_name": "Test"},
                                           "from": {"id": FAKE_CHAT, "is_bot": False, "first_name": "Test"}, "text": text}}


def ask(wid, path, secret, text, uid):
    """Send one message; return the 'Compose reply' output of the n8n run that handled exactly this text."""
    base = max([int(x["id"]) for x in b.api("GET", f"/executions?workflowId={wid}&limit=5")["data"]] or [0])
    post(path, update(text, uid), secret)
    for _ in range(40):
        time.sleep(5)
        for x in b.api("GET", f"/executions?workflowId={wid}&limit=8")["data"]:
            if int(x["id"]) <= base or x.get("status") == "running":
                continue
            run = b.api("GET", f"/executions/{x['id']}?includeData=true")
            ran = ((run.get("data") or {}).get("resultData") or {}).get("runData") or {}
            cls = (((ran.get("Classify") or [{}])[-1].get("data") or {}).get("main") or [[{}]])[0]
            if cls and (cls[0].get("json") or {}).get("text") == text and "Compose reply" in ran:
                return ran["Compose reply"][-1]["data"]["main"][0][0]["json"], ran
    return None, {}


def main():
    path = ENV["TG_WEBHOOK_PATH"]
    wid = next(x["id"] for x in b.api("GET", "/workflows?limit=250")["data"] if x["name"] == "Hotel Guest Journey - Telegram Bot")
    sec = secrets.token_urlsafe(24)
    today = date.today()
    d_taken, d_free = today + timedelta(days=10), today + timedelta(days=15)
    nice = lambda d: f"{d.day} {d.strftime('%B')}"
    try:
        q(f"delete from hotels where slug = '{SLUG}'")
        hid = q(f"insert into hotels (slug, name, active, staff_chat_id) values ('{SLUG}', 'ZZ Service Bot Test', true, -990000001) returning id")[0]["id"]
        q(f"insert into hotel_secrets (hotel_id, telegram_bot_token, telegram_webhook_secret) values ('{hid}', '0:fake-token-for-test', '{sec}')")
        hall = q(f"insert into hotel_services (hotel_id, name, price, unit, exclusive, sort) values ('{hid}', 'Event hall', 250000, 'per_event', true, 1) returning id")[0]["id"]
        q(f"insert into hotel_services (hotel_id, name, price, unit, exclusive, sort) values ('{hid}', 'Pool', 3000, 'per_head', false, 2)")
        q(f"insert into service_bookings (hotel_id, service_id, customer_name, starts_on, ends_on, amount) values ('{hid}', '{hall}', 'Taken Day', '{d_taken}', '{d_taken}', 1)")

        r, _ = ask(wid, path, sec, f"Is the event hall free on {nice(d_taken)}?", 1)
        check("asking about a day the hall is taken: answered from live data, nobody alerted",
              r and r.get("intent") == "service" and r.get("escalate") is False and "already booked" in r.get("reply", ""), r and {k: r.get(k) for k in ("intent", "escalate", "reply")})

        r, _ = ask(wid, path, sec, f"I want to book the event hall on {nice(d_free)}", 2)
        check("asking to book a free day: the guest is told it is free and the request goes to staff as a booking request",
              r and r.get("escalate") is True and r.get("kind") == "request" and r.get("category") == "booking" and "free on" in r.get("reply", "") and "passed your request" in r.get("reply", "")
              and "Event hall booking request" in r.get("staff_question", "") and "250,000" in r.get("staff_question", ""), r and {k: r.get(k) for k in ("intent", "escalate", "kind", "reply", "staff_question")})
        check("...and the guest's own words (not the summary) are what is logged as their message", r and r.get("question", "").startswith("I want to book the event hall"), r and r.get("question"))

        r, _ = ask(wid, path, sec, "How much is the pool for 5 people?", 3)
        check("a price question about the pool: the answer carries the price from the services list",
              r and ("3,000" in r.get("reply", "") or "15,000" in r.get("reply", "")), r and {k: r.get(k) for k in ("intent", "escalate", "reply")})

        r, _ = ask(wid, path, sec, "I want to book the helipad", 4)
        check("a service the hotel does not have is not invented", r and "Helipad" not in r.get("staff_question", "") and "passed your request" not in r.get("reply", ""), r and r.get("reply"))
    finally:
        q(f"delete from messages where chat_id = {FAKE_CHAT}")
        q(f"delete from escalations where guest_chat_id = {FAKE_CHAT}")
        q(f"delete from service_bookings where hotel_id in (select id from hotels where slug = '{SLUG}')")
        q(f"delete from hotels where slug = '{SLUG}'")
        left = q(f"select (select count(*) from hotels where slug = '{SLUG}') + (select count(*) from messages where chat_id = {FAKE_CHAT}) + (select count(*) from escalations where guest_chat_id = {FAKE_CHAT}) as n")[0]["n"]
        print(f"cleanup: test rows left = {left}")


if __name__ == "__main__":
    main()
    print("\nALL PASSED" if results and all(results) else "\nSOME FAILED")
    sys.exit(0 if results and all(results) else 1)
