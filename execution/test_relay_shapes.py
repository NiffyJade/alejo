"""Checks that the message shapes the workflows send are accepted by Telegram, by sending them (marked as tests) to a hotel's STAFF group
through the relay's hotel route. Usage:  python -I -X utf8 execution/test_relay_shapes.py [hotel-slug]   (default brightside)

Shapes: HTML text with escaped & < > and emoji; the always-visible menu keyboard; one inline button; two inline buttons with callback data;
answerCallbackQuery (a fake query id must be refused by Telegram as too old, which proves the route and the payload are understood);
sendChatAction. The three visible messages are deleted again straight away. Nothing secret is printed.
"""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import supabase_admin as sa  # noqa: E402

slug = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else "brightside"
h = sa.run_sql(f"select id, staff_chat_id from hotels where slug = '{slug}'")[0]
BASE = f"{sa.ENV['SUPABASE_URL']}/functions/v1/telegram-proxy/{sa.ENV['TELEGRAM_PROXY_SECRET']}/hotel/{h['id']}"
chat = int(h["staff_chat_id"])


def call(method, body):
    req = urllib.request.Request(f"{BASE}/{method}", data=json.dumps(body).encode(), method="POST",
                                 headers={"content-type": "application/json", "user-agent": "alejo-test/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


tricky = "Test <b>& \"quotes\" 'single' 🎉 _under_ *star* [bracket] `tick`"
cases = [
    ("HTML text with special characters", "sendMessage", {"chat_id": chat, "text": "Alejo relay test 1/3 (ignore): " + tricky.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"), "parse_mode": "HTML"}),
    ("menu keyboard (object markup)", "sendMessage", {"chat_id": chat, "text": "Alejo relay test 2/3 (ignore): menu", "parse_mode": "HTML",
        "reply_markup": {"keyboard": [[{"text": "📋 My booking"}, {"text": "🛏 Check availability"}], [{"text": "✅ Check in"}, {"text": "🚪 Check out"}]], "resize_keyboard": True}}),
    ("two inline buttons with callback data", "sendMessage", {"chat_id": chat, "text": "Alejo relay test 3/3 (ignore): buttons", "parse_mode": "HTML",
        "reply_markup": {"inline_keyboard": [[{"text": "✅ Confirm booking", "callback_data": "bkok:2026-12-11|2026-12-13|Deluxe"}, {"text": "Cancel", "callback_data": "bkno:x"}]]}}),
    ("markup sent as a JSON string is understood by the relay", "sendMessage", {"chat_id": chat, "text": "Alejo relay test (ignore): string markup", "parse_mode": "HTML",
        "reply_markup": json.dumps({"inline_keyboard": [[{"text": "ok", "callback_data": "x"}]]})}),
    ("typing signal", "sendChatAction", {"chat_id": chat, "action": "typing"}),
]
sent, ok_all = [], True
for name, method, body in cases:
    status, out = call(method, body)
    ok = status == 200 and out.get("ok") is True
    ok_all &= ok
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {status} {out.get('description')}"))
    if ok and method == "sendMessage":
        sent.append(out["result"]["message_id"])
status, out = call("answerCallbackQuery", {"callback_query_id": "1234567890123456789"})
ok = status == 400 and "query" in str(out.get("description", "")).lower()
ok_all &= ok
print(("PASS " if ok else "FAIL ") + f"callback acknowledgement reaches Telegram (it refuses the fake id: {out.get('description')})")
time.sleep(1)
for mid in sent:
    call("deleteMessage", {"chat_id": chat, "message_id": mid})
# restore a plain keyboard in the staff group (the menu test replaced it)
print("\nALL PASSED" if ok_all else "\nSOME FAILED")
sys.exit(0 if ok_all else 1)
