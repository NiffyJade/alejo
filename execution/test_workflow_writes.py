"""Tests the DATABASE-WRITING nodes of the n8n workflows exactly as built: takes each node's real request (URL + body expression) from the
builder, evaluates the expression with sample data, posts it to the live database the way n8n would (service role, same Prefer header),
and checks that the row landed in the right hotel. All test rows are tagged and deleted at the end.

Usage:  python -I -X utf8 execution/test_workflow_writes.py
Why: a fake Telegram chat cannot get a reply, so a real run stops before the "log" steps; this proves those steps' bodies are accepted.
"""
import importlib.util
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "execution"))
import supabase_admin as sa  # noqa: E402

spec = importlib.util.spec_from_file_location("b", ROOT / "execution" / "build_n8n_workflows.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
b.workflow_id = lambda n: "DRY-RUN-ID"

KEY = sa.ENV["SUPABASE_SERVICE_KEY"]
H = sa.run_sql("select id, staff_chat_id from hotels where slug = 'brightside'")[0]
HOTEL = {"id": H["id"], "name": "BrightSide Hotel", "timezone": "Africa/Lagos", "staff_chat_id": H["staff_chat_id"]}
CHAT = 990000555
TAG = "ZZ-TEST-multihotel"
EVAL_JS = ("const c = JSON.parse(process.argv[1]); const w = j => ({ first: () => ({ json: j }), all: () => [{ json: j }], item: { json: j } });"
           "const $ = n => w(c.nodes[n]); const f = new Function('$', '$json', 'return ' + c.expr); process.stdout.write(String(f($, c.json)));")


def evaluate(expr, nodes, json_in=None):
    body = expr[len("={{ "):-len(" }}")]
    r = subprocess.run(["node", "-e", EVAL_JS, json.dumps({"expr": body, "nodes": nodes, "json": json_in or {}})], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError("expression failed: " + r.stderr[-300:])
    return r.stdout


def post(url, body, prefer):
    h = {"apikey": KEY, "authorization": "Bearer " + KEY, "content-type": "application/json", "user-agent": "alejo-test/1.0"}
    if prefer:
        h["Prefer"] = prefer
    req = urllib.request.Request(url, data=body.encode(), headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def node(w, name):
    return next(n for n in w.nodes if n["name"] == name)


def run_node(w, name, nodes, json_in=None):
    p = node(w, name)["parameters"]
    url = p["url"][1:]
    assert "{{" not in url, f"{name}: this test only covers nodes with a fixed URL"
    prefer = next((x["value"] for x in p.get("headerParameters", {}).get("parameters", []) if x["name"] == "Prefer"), None)
    return post(url, evaluate(p["jsonBody"], nodes, json_in), prefer)


def q(sql):
    return sa.run_sql(sql)


def main():
    bot, sched, vapi, booking = b.telegram_bot(), b.scheduler(), b.vapi_tools(), b.booking_created()
    results = []

    def check(name, ok, detail=""):
        results.append(bool(ok))
        print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  -> " + str(detail)))

    cls = {"hotel": HOTEL, "chat_id": CHAT, "text": TAG}
    try:
        # ---- guest bot
        comp = {"guest_id": None, "booking_id": None, "chat_id": CHAT, "question": TAG, "reply": "r", "intent": "faq", "kind": "question", "category": None,
                "draft_row": {"chat_id": CHAT, "check_in": "2026-12-20", "check_out": "2026-12-22", "room_type": "Deluxe", "guest_name": TAG, "phone": None,
                              "phone_verified": False, "lang": "en", "tg_name": TAG, "updated_at": "2026-11-24T00:00:00Z"}}
        st, out = run_node(bot, "Log messages", {"Classify": cls, "Compose reply": comp})
        check("bot: Log messages stored (2 rows) in the right hotel", st < 300 and int(q(f"select count(*) from messages where chat_id = {CHAT} and hotel_id = '{H['id']}'")[0]["count"]) == 2, out)
        st, out = run_node(bot, "Save draft", {"Classify": cls, "Compose reply": comp})
        check("bot: Save draft upserts per (hotel, chat)", st < 300 and int(q(f"select count(*) from booking_drafts where chat_id = {CHAT} and hotel_id = '{H['id']}'")[0]["count"]) == 1, out)
        st, out = run_node(bot, "Save draft", {"Classify": cls, "Compose reply": {**comp, "draft_row": {**comp["draft_row"], "room_type": "Suite"}}})
        check("bot: saving the draft again updates it (still one row, new value)",
              st < 300 and q(f"select count(*) as n, max(room_type) as r from booking_drafts where chat_id = {CHAT}")[0] == {"n": 1, "r": "Suite"}, out)
        st, out = run_node(bot, "Save escalation", {"Classify": cls, "Compose reply": comp}, {"result": {"message_id": 4242}})
        check("bot: Save escalation stored in the right hotel", st < 300 and int(q(f"select count(*) from escalations where guest_chat_id = {CHAT} and hotel_id = '{H['id']}' and staff_message_id = 4242")[0]["count"]) == 1, out)
        st, out = run_node(bot, "Save to knowledge base", {"Classify": {**cls, "text": TAG}, "Find open escalation": {"id": TAG, "question": TAG}})
        check("bot: staff answer saved to the right hotel's knowledge base",
              st < 300 and int(q(f"select count(*) from knowledge_entries where id = 'staff-{TAG}' and hotel_id = '{H['id']}'")[0]["count"]) == 1, out)

        # ---- scheduler markers
        sctx = {"Now (hotel time)": {"hotel": HOTEL}, "Context": {"today": "2099-01-01"}}
        for nm, key in (("Mark ratings summary done", "RATINGS_DIGEST_LAST"), ("Mark daily summary done", "DAILY_DIGEST_LAST")):
            before = q(f"select value from hotel_settings where key = '{key}' and hotel_id = '{H['id']}'")
            st, out = run_node(sched, nm, sctx)
            row = q(f"select value from hotel_settings where key = '{key}' and hotel_id = '{H['id']}'")
            check(f"scheduler: {nm} writes the marker for this hotel", st < 300 and row and row[0]["value"] == "2099-01-01", out)
            if before:
                q(f"update hotel_settings set value = '{before[0]['value']}' where key = '{key}' and hotel_id = '{H['id']}'")
            else:
                q(f"delete from hotel_settings where key = '{key}' and hotel_id = '{H['id']}'")
        st, out = run_node(sched, "Log follow-up", {"Now (hotel time)": {"hotel": HOTEL}, "Compose follow-ups": {"chat_id": CHAT, "text": TAG}})
        check("scheduler: Log follow-up stored in the right hotel", st < 300 and int(q(f"select count(*) from messages where chat_id = {CHAT} and intent = 'followup' and hotel_id = '{H['id']}'")[0]["count"]) == 1, out)

        # ---- phone assistant
        vctx = {"Find hotel": {"hotel": HOTEL}, "Parse AI": {"question": TAG, "kind": "request", "category": "housekeeping", "caller_name": TAG, "caller_number": "+2340000000000"}}
        st, out = run_node(vapi, "Save phone item", vctx)
        check("phone: Save phone item stored in the right hotel (no guest)", st < 300 and int(q(f"select count(*) from escalations where caller_name = '{TAG}' and hotel_id = '{H['id']}' and guest_id is null")[0]["count"]) == 1, out)

        # ---- booking-created webhook
        bctx = {"Find hotel": {"hotel": HOTEL}, "Validate": {"name": TAG, "phone": "+2340000000001", "email": None, "room_type": "Deluxe", "room_number": None,
                                                              "check_in": "2026-12-20", "check_out": "2026-12-22"}}
        st, out = run_node(booking, "Create guest", bctx)
        gid = json.loads(out)[0]["id"] if st < 300 else None
        check("webhook: Create guest stored in the right hotel", gid and q(f"select hotel_id from guests where id = '{gid}'")[0]["hotel_id"] == H["id"], out)
        if gid:
            st, out = run_node(booking, "Create booking", bctx, {"guest_id": gid})
            bid = json.loads(out)[0]["id"] if st < 300 else None
            check("webhook: Create booking stored in the right hotel, linked to that hotel's guest", bid and q(f"select hotel_id from bookings where id = '{bid}'")[0]["hotel_id"] == H["id"], out)
    finally:
        q(f"delete from messages where chat_id = {CHAT}")
        q(f"delete from booking_drafts where chat_id = {CHAT}")
        q(f"delete from escalations where guest_chat_id = {CHAT} or caller_name = '{TAG}'")
        q(f"delete from knowledge_entries where id = 'staff-{TAG}'")
        q(f"delete from guests where name = '{TAG}'")           # bookings go with them (cascade)
        left = q(f"select (select count(*) from messages where chat_id = {CHAT}) + (select count(*) from guests where name = '{TAG}') + (select count(*) from escalations where caller_name = '{TAG}') as n")[0]["n"]
        print("cleanup: test rows left =", left)
    print("\nALL PASSED" if all(results) else "\nSOME FAILED")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
