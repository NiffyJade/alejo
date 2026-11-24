"""Live test of the Team function (staff-team) with REAL logins, on a throwaway hotel. Usage:  python -I -X utf8 execution/test_team_live.py

Creates two test hotels (switched off) and temporary logins at example.invalid addresses (an owner, a manager, a staff member, and a
person who works at both hotels), signs them in for real, calls the function, and checks the outcome in the database and by signing
in again. Everything it creates is deleted at the end, even if a check fails. No secret is printed.
"""
import json
import secrets
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import supabase_admin as sa  # noqa: E402

URL, ANON = sa.ENV["SUPABASE_URL"], sa.anon_key()
TAG = "zz-" + secrets.token_hex(3)
EM = lambda who: f"{TAG}-{who}@example.invalid"
PW = lambda: secrets.token_urlsafe(14) + "aA1"
made_emails = []
results = []


def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"content-type": "application/json", "user-agent": "alejo-test/1.0", **(headers or {})})
    for attempt in range(4):                       # this network drops a connection now and then: retry, never give up silently
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                t = r.read().decode()
                return r.status, (json.loads(t) if t.strip()[:1] in "{[" else t)
        except urllib.error.HTTPError as e:
            t = e.read().decode()
            return e.code, (json.loads(t) if t.strip()[:1] in "{[" else t)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            if attempt == 3:
                raise
            time.sleep(2 + attempt * 2)


def make_login(email, password):
    made_emails.append(email)
    st, out = sa.auth_admin("POST", "/users", {"email": email, "password": password, "email_confirm": True})
    assert st in (200, 201), f"could not create test login: {st}"
    return out["id"]


def sign_in(email, password):
    st, out = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": email, "password": password}, {"apikey": ANON})
    return out.get("access_token") if st == 200 else None


def team(token, action, hotel, **kw):
    return http("POST", f"{URL}/functions/v1/staff-team", {"action": action, "hotel_id": hotel, **kw}, {"apikey": ANON, "authorization": "Bearer " + token})


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  -> " + str(detail)[:160]))


def login_exists(email):
    st, out = sa.auth_admin("GET", "/users?per_page=1000")
    return any(u["email"].lower() == email for u in out.get("users", []))


def user_meta(email):
    st, out = sa.auth_admin("GET", "/users?per_page=1000")
    return next((u.get("user_metadata") or {} for u in out.get("users", []) if u["email"].lower() == email), None)


def main():
    h1 = sa.run_sql(f"insert into hotels (slug, name, active) values ('{TAG}-a', 'ZZ Team Test A', false) returning id")[0]["id"]
    h2 = sa.run_sql(f"insert into hotels (slug, name, active) values ('{TAG}-b', 'ZZ Team Test B', false) returning id")[0]["id"]
    bright = sa.run_sql("select id from hotels where slug = 'brightside'")[0]["id"]
    pw = {k: PW() for k in ("owner", "mgr", "staff", "both")}
    for k in pw:
        make_login(EM(k), pw[k])
    for who, hid, role in (("owner", h1, "owner"), ("mgr", h1, "manager"), ("staff", h1, "staff"), ("both", h1, "staff"), ("both", h2, "staff")):
        sa.run_sql(f"insert into staff_users (hotel_id, email, name, role) values ('{hid}', '{EM(who)}', '{who.title()}', '{role}')")
    tok = {k: sign_in(EM(k), pw[k]) for k in pw}
    check("test logins can sign in", all(tok.values()))

    # ---- who may call it
    st, out = http("POST", f"{URL}/functions/v1/staff-team", {"action": "list", "hotel_id": h1}, {"apikey": ANON, "authorization": "Bearer " + ANON})
    check("the public key is refused (401)", st == 401, (st, out))
    for who in ("staff", "mgr"):
        st, out = team(tok[who], "list", h1)
        check(f"a {who} account cannot open the team ({st})", st == 403, (st, out))
    st, out = team(tok["owner"], "list", h1)
    check("the owner sees the team of their hotel (4 people, with roles)", st == 200 and len(out["team"]) == 4 and {t["role"] for t in out["team"]} == {"owner", "manager", "staff"} and out["you"] == EM("owner"), (st, out))
    for hid, label in ((h2, "another hotel"), (bright, "BrightSide")):
        st, out = team(tok["owner"], "list", hid)
        check(f"the owner of one hotel cannot open the team of {label} (403)", st == 403, (st, out))
        st, out = team(tok["owner"], "add", hid, name="Intruder", email=EM("intruder"), role="owner")
        check(f"...nor add anyone there; no login was created", st == 403 and not login_exists(EM("intruder")), (st, out))
    st, out = team(tok["owner"], "list", "not-a-uuid")
    check("a bad hotel id is refused (400)", st == 400, (st, out))

    # ---- add a brand-new person
    new = EM("newbie"); made_emails.append(new)
    st, out = team(tok["owner"], "add", h1, name="New Person", email=new, role="staff")
    pw_new = out.get("password") if isinstance(out, dict) else None
    check("adding a new person creates a login and returns a one-time password", st == 200 and pw_new and len(pw_new) == 14 and out.get("existing_login") is False, (st, out))
    check("...the staff row exists with the right role", sa.run_sql(f"select role from staff_users where hotel_id = '{h1}' and email = '{new}'") == [{"role": "staff"}])
    check("...the login is flagged 'must choose own password'", (user_meta(new) or {}).get("must_change_password") is True)
    t_new = sign_in(new, pw_new) if pw_new else None
    check("...and the new person can sign in with that password", bool(t_new))
    st, out = team(tok["owner"], "add", h1, name="Again", email=new, role="staff")
    check("adding the same person twice is refused (409)", st == 409, (st, out))
    st, out = team(tok["owner"], "add", h1, name="Bad", email="not an email", role="staff")
    check("a bad email is refused (400)", st == 400, (st, out))
    st, out = team(tok["owner"], "add", h1, name="Root", email=EM("root"), role="admin")
    check("nobody can be given the role 'admin' (400), and no login is made", st == 400 and not login_exists(EM("root")), (st, out))

    # ---- add someone who already has a login elsewhere: their password is never touched
    st, out = team(tok["owner"], "add", h1, name="Existing", email=EM("both"), role="manager")
    check("a person who already works at this hotel is refused (409)", st == 409, (st, out))
    other = EM("other"); op = PW(); make_login(other, op)
    st, out = team(tok["owner"], "add", h1, name="Other", email=other, role="staff")
    check("an email that already has a login is added WITHOUT touching its password", st == 200 and out.get("password") is None and out.get("existing_login") is True and bool(sign_in(other, op)), (st, out))

    # ---- change a role
    st, out = team(tok["owner"], "set_role", h1, email=new, role="manager")
    check("the owner can change a role", st == 200 and sa.run_sql(f"select role from staff_users where hotel_id = '{h1}' and email = '{new}'")[0]["role"] == "manager", (st, out))
    st, out = team(tok["owner"], "set_role", h1, email=EM("owner"), role="staff")
    check("an owner cannot change their own role (400)", st == 400 and sa.run_sql(f"select role from staff_users where hotel_id = '{h1}' and email = '{EM('owner')}'")[0]["role"] == "owner", (st, out))
    st, out = team(tok["owner"], "set_role", h1, email=new, role="superuser")
    check("an invented role is refused (400)", st == 400, (st, out))
    st, out = team(tok["mgr"], "set_role", h1, email=EM("staff"), role="manager")
    check("a manager cannot change roles (403)", st == 403 and sa.run_sql(f"select role from staff_users where hotel_id = '{h1}' and email = '{EM('staff')}'")[0]["role"] == "staff", (st, out))

    # ---- reset a password
    st, out = team(tok["owner"], "reset_password", h1, email=new)
    pw2 = out.get("password") if isinstance(out, dict) else None
    check("reset: a new one-time password is returned", st == 200 and pw2 and pw2 != pw_new, (st, out))
    check("...the old password stops working and the new one works", sign_in(new, pw_new) is None and bool(sign_in(new, pw2)))
    check("...and the account must choose its own password again", (user_meta(new) or {}).get("must_change_password") is True)
    st, out = team(tok["owner"], "reset_password", h1, email=EM("both"))
    check("an owner cannot reset the password of someone who also works at another hotel (403)", st == 403 and bool(sign_in(EM("both"), pw["both"])), (st, out))
    st, out = team(tok["owner"], "reset_password", h1, email=EM("owner"))
    check("an owner cannot reset their own password here (400)", st == 400, (st, out))

    # ---- remove
    st, out = team(tok["owner"], "remove", h1, email=EM("owner"))
    check("an owner cannot remove themselves (400)", st == 400, (st, out))
    st, out = team(tok["owner"], "remove", h1, email=new)
    check("removing someone deletes their row, and a login with no hotel left is switched off completely",
          st == 200 and not sa.run_sql(f"select 1 from staff_users where hotel_id = '{h1}' and email = '{new}'") and not login_exists(new), (st, out))
    st, out = team(tok["owner"], "remove", h1, email=EM("both"))
    check("removing someone who works elsewhere removes only THIS hotel's row and keeps their login",
          st == 200 and not sa.run_sql(f"select 1 from staff_users where hotel_id = '{h1}' and email = '{EM('both')}'")
          and bool(sa.run_sql(f"select 1 from staff_users where hotel_id = '{h2}' and email = '{EM('both')}'")) and bool(sign_in(EM("both"), pw["both"])), (st, out))
    st, out = team(tok["owner"], "remove", h1, email="nobody@example.invalid")
    check("removing someone who is not on the team is refused (404)", st == 404, (st, out))
    st, out = team(tok["mgr"], "remove", h1, email=EM("staff"))
    check("a manager cannot remove anyone (403)", st == 403 and bool(sa.run_sql(f"select 1 from staff_users where hotel_id = '{h1}' and email = '{EM('staff')}'")), (st, out))


def cleanup():
    st, out = sa.auth_admin("GET", "/users?per_page=1000")
    for u in out.get("users", []):
        if u["email"].lower().startswith(TAG + "-") or u["email"].lower() in made_emails:
            sa.auth_admin("DELETE", f"/users/{u['id']}")
    sa.run_sql(f"delete from hotels where slug like '{TAG}-%'")                       # their staff rows go with them
    left = sa.run_sql(f"select (select count(*) from hotels where slug like '{TAG}-%') + (select count(*) from staff_users where email like '{TAG}-%') as n")[0]["n"]
    st, out = sa.auth_admin("GET", "/users?per_page=1000")
    logins = sum(1 for u in out.get("users", []) if u["email"].lower().startswith(TAG + "-"))
    print(f"cleanup: test rows left = {left}, test logins left = {logins}")


if __name__ == "__main__":
    try:
        main()
    finally:
        cleanup()
    print("\nALL PASSED" if all(results) and results else "\nSOME FAILED")
    sys.exit(0 if all(results) and results else 1)
