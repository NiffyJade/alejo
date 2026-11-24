"""Tests the live n8n webhook workflows as their real callers use them. Usage:  python -I -X utf8 execution/test_webhooks.py [--suffix=v2]

 - booking-created webhook: right secret -> booking saved in the hotel and a Telegram link returned; wrong/missing secret -> 401
 - phone-assistant (Vapi tools) webhook: right secret -> an availability answer; wrong secret -> 401
 - dashboard-reply webhook: a test question is answered through the staff group; a WRONG hotel id leaves the question open
 - typing-signal webhook accepts the call; demo-request alert posts to the platform staff group
Messages go to the BrightSide STAFF group (marked as tests). Test rows are tagged and removed at the end. Nothing secret is printed.
"""
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import supabase_admin as sa  # noqa: E402

ENV = sa.ENV
sfx = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--suffix=")), "")
TAG = "ZZ-TEST-webhooks"
H = sa.run_sql("select id, staff_chat_id from hotels where slug = 'brightside'")[0]


def call(path, body, headers=None):
    h = {"content-type": "application/json", "user-agent": "alejo-test/1.0", **(headers or {})}
    req = urllib.request.Request(f"{ENV['N8N_BASE_URL']}/webhook/{path}", data=json.dumps(body).encode(), headers=h, method="POST")
    for _ in range(4):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                txt = r.read().decode()
                return r.status, (json.loads(txt) if txt.strip()[:1] in ("{", "[") else txt)
        except urllib.error.HTTPError as e:
            txt = e.read().decode()
            return e.code, (json.loads(txt) if txt.strip()[:1] in ("{", "[") else txt)
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(5)
    return 0, None


def q(sql):
    return sa.run_sql(sql)


results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  -> " + str(detail)[:200]))


def main():
    P = lambda s: s + sfx                                           # parallel copies use a suffixed path
    try:
        # ---- booking-created
        body = {"name": TAG, "phone": "08000000999", "check_in": "2026-12-20", "check_out": "2026-12-22", "room_type": "Deluxe"}
        st, out = call(P("guest-booking-created"), body, {"x-webhook-secret": ENV["BOOKING_WEBHOOK_SECRET"]})
        check("booking webhook: right secret saves the booking and returns the hotel's Telegram link",
              st == 200 and isinstance(out, dict) and out.get("booking_id") and "t.me/brightside_Staff_bot?start=" in out.get("telegram_link", ""), (st, out))
        if st == 200 and isinstance(out, dict) and out.get("booking_id"):
            check("  ...and the booking belongs to that hotel", q(f"select hotel_id from bookings where id = '{out['booking_id']}'")[0]["hotel_id"] == H["id"])
        before = int(q(f"select count(*) from guests where name = '{TAG}'")[0]["count"])
        st, out = call(P("guest-booking-created"), body, {"x-webhook-secret": "wrong-secret-" + "x" * 30})
        check("booking webhook: wrong secret is refused (401) and writes nothing", st == 401 and int(q(f"select count(*) from guests where name = '{TAG}'")[0]["count"]) == before, (st, out))
        st, out = call(P("guest-booking-created"), body)
        check("booking webhook: no secret is refused (401)", st == 401, (st, out))

        # ---- phone assistant
        tool = {"message": {"toolCallList": [{"id": "call-1", "function": {"name": "check_availability", "arguments": {"check_in": "2026-12-20", "check_out": "2026-12-22"}}}]}}
        st, out = call(P("hotel-guest-journey-vapi"), tool, {"x-webhook-secret": ENV["VAPI_TOOLS_SECRET"]})
        txt = json.dumps(out)
        check("phone webhook: right secret gives an availability answer from that hotel", st == 200 and "Standard" in txt and "naira" in txt, (st, txt))
        st, out = call(P("hotel-guest-journey-vapi"), tool, {"x-webhook-secret": "wrong-secret-" + "x" * 30})
        check("phone webhook: wrong secret is refused (401)", st == 401, (st, out))

        # ---- dashboard reply (the question is "from" the staff group chat so the forwarded message is deliverable)
        eid = str(uuid.uuid4())
        q(f"insert into escalations (id, hotel_id, guest_chat_id, question, kind) values ('{eid}', '{H['id']}', {H['staff_chat_id']}, '{TAG}', 'question')")
        st, out = call(P(ENV["DASH_REPLY_PATH"]), {"escalation_id": eid, "hotel_id": str(uuid.uuid4()), "answer": "wrong hotel", "learn": False, "by": "test"})
        check("dashboard reply: a wrong hotel id does not answer the question",
              q(f"select status from escalations where id = '{eid}'")[0]["status"] == "open", (st, out))
        st, out = call(P(ENV["DASH_REPLY_PATH"]), {"escalation_id": eid, "hotel_id": H["id"], "answer": "Alejo webhook test, please ignore", "learn": False, "by": "test"})
        check("dashboard reply: the right hotel answers it", st == 200 and q(f"select status from escalations where id = '{eid}'")[0]["status"] == "answered", (st, out))

        # ---- typing signal + demo alert
        st, out = call(P(ENV["TYPING_PATH"]), {"chat_id": H["staff_chat_id"], "hotel_id": H["id"]})
        check("typing webhook accepts the call", st == 200, (st, out))
        st, out = call(P(ENV["DEMO_ALERT_PATH"]), {"hotel": TAG + " (ignore)", "email": "test@example.invalid", "rooms": "0"})
        check("demo alert webhook accepts the call", st == 200, (st, out))
    finally:
        q(f"delete from escalations where question = '{TAG}'")
        q(f"delete from messages where text like 'Update from our team: Alejo webhook test%'")
        q(f"delete from guests where name = '{TAG}'")
        print("cleanup: test rows left =", q(f"select (select count(*) from guests where name = '{TAG}') + (select count(*) from escalations where question = '{TAG}') as n")[0]["n"])
    print("\nALL PASSED" if all(results) else "\nSOME FAILED")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
