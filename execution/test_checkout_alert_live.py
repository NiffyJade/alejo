"""Live test of the past-checkout staff alert (Scheduler part J) on a THROWAWAY hotel, with a fake staff chat.

Usage (from the project root):   python -I -X utf8 execution/test_checkout_alert_live.py     (waits for the scheduler's next 15-minute tick; up to ~20 minutes)

Creates a temporary active hotel (zz-checkout) whose checkout time is set early ("1:00 AM") so that today it is already past it, with:
  - one guest checked in and due out today          -> must be announced
  - one checked in but due out TOMORROW              -> must NOT be announced
  - one due out today that is only 'booked'          -> must NOT be announced
  - one checked in, due today, already announced     -> must NOT be announced
The staff group is a fake chat, so Telegram refuses the message ("chat not found"): that is expected, and it also means nothing is stamped
(a stay is stamped only after Telegram took the message), which is what lets a failed send be retried. Nothing reaches a real chat or
BrightSide's staff group. Everything created is deleted at the end, even if a check fails. No secret is printed.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import supabase_admin as sa  # noqa: E402
import build_n8n_workflows as b  # noqa: E402

SLUG = "zz-checkout"
results = []


def q(sql):
    return sa.run_sql(sql)


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  -> " + str(detail)[:300]))


def main():
    wid = next(x["id"] for x in b.api("GET", "/workflows?limit=250")["data"] if x["name"] == "Hotel Guest Journey - Scheduler (one hotel)")
    try:
        q(f"delete from hotels where slug = '{SLUG}'")
        hid = q(f"insert into hotels (slug, name, active, staff_chat_id, timezone) values ('{SLUG}', 'ZZ Checkout Test', true, -990000002, 'Africa/Lagos') returning id")[0]["id"]
        q(f"insert into hotel_secrets (hotel_id, telegram_bot_token) values ('{hid}', '0:fake-token-for-test')")
        q(f"insert into hotel_settings (hotel_id, key, value) values ('{hid}', 'CHECKOUT_TIME', '1:00 AM')")
        q(f"insert into room_types (hotel_id, name, total_rooms, nightly_rate, active) values ('{hid}', 'Standard', 9, 1000, true)")
        g = {n: q(f"insert into guests (hotel_id, name) values ('{hid}', '{n}') returning id")[0]["id"] for n in ("Late Larry", "Tomorrow Tina", "Booked Bola", "Told Tunde")}
        today = q("select (now() at time zone 'Africa/Lagos')::date as d")[0]["d"]

        def booking(name, status, out_offset, extra=""):
            q(f"insert into bookings (hotel_id, guest_id, room_type, room_number, check_in, check_out, status, checked_in_at{extra.split('|')[0]}) "
              f"values ('{hid}', '{g[name]}', 'Standard', '{name[:1]}1', '{today}'::date - 2, '{today}'::date + {out_offset}, '{status}', "
              f"{'now()' if status == 'checked_in' else 'null'}{extra.split('|')[1] if '|' in extra else ''})")
        booking("Late Larry", "checked_in", 0)
        booking("Tomorrow Tina", "checked_in", 1)
        booking("Booked Bola", "booked", 0)
        booking("Told Tunde", "checked_in", 0, ", checkout_overdue_alert_sent_at|, now() - interval '1 hour'")

        base = max([int(x["id"]) for x in b.api("GET", f"/executions?workflowId={wid}&limit=5")["data"]] or [0])
        print("waiting for the scheduler to run for this hotel (every 15 minutes) ...")
        run, ran = None, {}
        for _ in range(130):
            time.sleep(10)
            for x in b.api("GET", f"/executions?workflowId={wid}&limit=12")["data"]:
                if int(x["id"]) <= base or x.get("status") == "running":
                    continue
                r = b.api("GET", f"/executions/{x['id']}?includeData=true")
                rd = ((r.get("data") or {}).get("resultData") or {}).get("runData") or {}
                now = (((rd.get("Now (hotel time)") or [{}])[-1].get("data") or {}).get("main") or [[{}]])[0]
                if now and ((now[0].get("json") or {}).get("hotel") or {}).get("slug") == SLUG:
                    run, ran = r, rd
                    break
            if run:
                break
        check("the scheduler ran for the throwaway hotel", bool(run), "no run seen in ~20 minutes")
        if not run:
            return
        comp = (((ran.get("Compose overdue alert") or [{}])[-1].get("data") or {}).get("main") or [[]])[0]
        item = (comp[0].get("json") if comp else None) or {}
        check("exactly one alert was composed, for the guest checked in and due out today", len(comp) == 1 and "Late Larry" in item.get("text", ""), item)
        check("...and it names nobody else (not the one leaving tomorrow, not the unarrived, not the one already told)",
              all(n not in item.get("text", "") for n in ("Tomorrow Tina", "Booked Bola", "Told Tunde")) and len(item.get("ids", [])) == 1, item.get("text"))
        check("...with the checkout time and the instruction for staff", "Past checkout time (1:00 AM)" in item.get("text", "") and "check them out in the Alejo dashboard" in item.get("text", ""), item.get("text"))
        sent = ran.get("Alert staff (past checkout)")
        check("the alert was handed to Telegram for the hotel's staff group (refused here: the chat is fake)", bool(sent), list(ran.keys())[-6:])
        check("a refused send does NOT stamp the stay, so it will be retried (and a delivered one is stamped by the next step)",
              "Mark checkout alert sent" not in ran and q(f"select count(*) as n from bookings where hotel_id = '{hid}' and checkout_overdue_alert_sent_at is not null and check_in is not null")[0]["n"] == 1, "stamped unexpectedly")
    finally:
        q(f"delete from hotels where slug = '{SLUG}'")
        left = q(f"select count(*) as n from hotels where slug = '{SLUG}'")[0]["n"]
        print(f"cleanup: test hotels left = {left}")


if __name__ == "__main__":
    main()
    print("\nALL PASSED" if results and all(results) else "\nSOME FAILED")
    sys.exit(0 if results and all(results) else 1)
