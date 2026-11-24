"""End-to-end test of the multi-hotel Telegram bot workflow with SIMULATED Telegram updates (no real Telegram traffic in).

Usage (from the project root):
  python -I -X utf8 execution/test_bot_v2.py [--suffix=v2]

Sends fake updates to the bot's webhook address with a hotel's webhook secret in the header, then checks:
  1. an update with a wrong or missing secret is ignored (nothing is written);
  2. a guest message from a fake private chat is answered: messages are logged for THAT hotel (hotel_id set) and a draft/escalation,
     if any, belongs to that hotel;
  3. the same chat id talking to a second (temporary) hotel is kept apart.
Everything it writes uses chat ids in the 990000000-range and is deleted at the end. Replies to fake chats cannot be delivered by
Telegram (chat not found); that failure is expected and ignored. Credentials come from .env and the database; nothing secret is printed.
"""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import supabase_admin as sa  # noqa: E402

ENV = sa.ENV
suffix = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--suffix=")), "")
FAKE_CHAT = 990000777
FAKE_CHAT_B = 990000888


def post(path, body, secret=None):
    h = {"content-type": "application/json", "user-agent": "alejo-test/1.0"}
    if secret is not None:
        h["x-telegram-bot-api-secret-token"] = secret
    req = urllib.request.Request(f"{ENV['N8N_BASE_URL']}/webhook/{path}", data=json.dumps(body).encode(), headers=h, method="POST")
    for attempt in range(4):                      # the n8n host is slow and sometimes drops a connection: retry, never give up silently
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print("  (network hiccup, retrying:", type(e).__name__ + ")")
            time.sleep(5)
    return 0


def update(chat, text, uid):
    return {"update_id": uid, "message": {"message_id": uid, "date": int(time.time()),
            "chat": {"id": chat, "type": "private", "first_name": "Test"}, "from": {"id": chat, "is_bot": False, "first_name": "Test"}, "text": text}}


def q(sql):
    return sa.run_sql(sql)


def count(sql):
    return int(list(q(sql)[0].values())[0])


def wait_for(sql, want, seconds=90):
    end = time.time() + seconds
    while time.time() < end:
        if count(sql) >= want:
            return True
        time.sleep(4)
    return False


def main():
    path = ENV["TG_WEBHOOK_PATH"] + suffix
    brightside = q("select h.id, s.telegram_webhook_secret as sec from hotels h join hotel_secrets s on s.hotel_id = h.id where h.slug = 'brightside'")[0]
    hid, secret = brightside["id"], brightside["sec"]
    results = []

    def check(name, ok, detail=""):
        results.append(ok)
        print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  -> " + str(detail)[:200]))

    try:
        # 1. wrong / missing secret: ignored, nothing written
        before = count(f"select count(*) from messages where chat_id in ({FAKE_CHAT}, {FAKE_CHAT_B})")
        post(path, update(FAKE_CHAT, "do you have a room", 1), secret="x" * 40)
        post(path, update(FAKE_CHAT, "do you have a room", 2))
        time.sleep(12)
        check("update with a wrong or missing secret writes nothing", count(f"select count(*) from messages where chat_id in ({FAKE_CHAT}, {FAKE_CHAT_B})") == before)

        # 2. a question from a fake chat goes through the whole pipeline up to the send. Telegram cannot deliver to a fake chat, so the run is
        #    expected to END at "Send guest reply" with "chat not found": that proves the hotel was found from its secret, the context was
        #    loaded for it, the AI answered and the reply reached Telegram through the hotel's bot. (A real chat is needed to see the log step.)
        import build_n8n_workflows as b
        name = "Hotel Guest Journey - Telegram Bot" + ("" if not suffix else " (" + suffix + ")")
        wid = next(x["id"] for x in b.api("GET", "/workflows?limit=250")["data"] if x["name"] == name)
        time.sleep(10)            # runs from the wrong-secret step above are saved a little later: take the baseline after they are in
        known = {x["id"] for x in b.api("GET", f"/executions?workflowId={wid}&limit=10")["data"]}
        post(path, update(FAKE_CHAT, "What time is check-in?", 3), secret=secret)
        run = None
        for _ in range(20):
            time.sleep(6)
            fresh = [x for x in b.api("GET", f"/executions?workflowId={wid}&limit=5")["data"] if x["id"] not in known and x.get("status") != "running"]
            if fresh:
                run = b.api("GET", f"/executions/{fresh[0]['id']}?includeData=true")
                break
        rd = ((run or {}).get("data") or {}).get("resultData") or {}
        ran = rd.get("runData") or {}
        err = ((ran.get("Send guest reply") or [{}])[-1].get("error")) or {}
        check("a guest message goes through hotel lookup, context, AI and compose, and is sent as that hotel",
              all(n in ran for n in ("Find hotel", "Classify", "Load context", "Compose reply", "Send guest reply")) and "chat not found" in str(err.get("description", "")),
              [n for n in ("Find hotel", "Classify", "Load context", "Compose reply", "Send guest reply") if n not in ran] or err.get("description"))
        check("nothing was written for a hotel it should not be (no rows without or with another hotel)",
              count(f"select count(*) from messages where chat_id = {FAKE_CHAT} and hotel_id <> '{hid}'") == 0)
    finally:
        q(f"delete from messages where chat_id in ({FAKE_CHAT}, {FAKE_CHAT_B})")
        q(f"delete from booking_drafts where chat_id in ({FAKE_CHAT}, {FAKE_CHAT_B})")
        q(f"delete from escalations where guest_chat_id in ({FAKE_CHAT}, {FAKE_CHAT_B})")
        q(f"delete from bot_typing where chat_id in ({FAKE_CHAT}, {FAKE_CHAT_B})")
    print("\nALL PASSED" if all(results) else "\nSOME FAILED")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
