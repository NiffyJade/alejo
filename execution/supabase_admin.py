"""Small Supabase management helper (no CLI needed).

Usage (run from the project root; credentials come from .env and are never printed):
  python execution/supabase_admin.py sql sql/003_demo_requests.sql
  python execution/supabase_admin.py deploy demo-request supabase/functions/demo-request/index.ts [--verify-jwt]
  python execution/supabase_admin.py secrets NAME=VALUE ...      (values may be ENV:NAME to copy from .env)
  python execution/supabase_admin.py query "select count(*) from demo_requests"
  python execution/supabase_admin.py anon-key                      (the public anon key; safe to embed in the dashboard)
  python execution/supabase_admin.py staff-user EMAIL "Name" [owner|manager|staff] [--reset]
                                                                   (creates the login + staff_users row, prints a one-time password)
  python execution/supabase_admin.py disable-signup                (only staff created here can sign in)

Needs SUPABASE_URL and SUPABASE_ACCESS_TOKEN in .env. Edge functions are deployed with verify_jwt off unless
--verify-jwt is given (public forms and webhooks defend themselves).
"""
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.supabase.com/v1"
UA = "alejo-admin/1.0"


def load_env():
    env = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return {**env, **{k: v for k, v in os.environ.items() if k in env}}


ENV = load_env()
REF = ENV["SUPABASE_URL"].split("//")[1].split(".")[0]
TOKEN = ENV["SUPABASE_ACCESS_TOKEN"]


def call(method, path, body=None, headers=None, raw=False):
    h = {"authorization": f"Bearer {TOKEN}", "user-agent": UA, **(headers or {})}
    data = body
    if body is not None and not raw:
        data = json.dumps(body).encode()
        h["content-type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            txt = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(txt) if txt.strip()[:1] in "[{" else txt)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def run_sql(query):
    status, out = call("POST", f"/projects/{REF}/database/query", {"query": query})
    if status >= 300:
        sys.exit(f"SQL failed ({status}): {str(out)[:600]}")
    return out


def deploy(slug, file, verify_jwt=False):
    text = Path(file).read_text(encoding="utf-8")
    for key in sorted(set(re.findall(r"__ENV:([A-Z0-9_]+)__", text))):      # deploy-time values from .env, kept out of the repo
        text = text.replace(f"__ENV:{key}__", ENV[key])
    src = text.encode("utf-8")
    boundary = uuid.uuid4().hex
    meta = json.dumps({"entrypoint_path": "index.ts", "name": slug, "verify_jwt": verify_jwt})
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{meta}\r\n'.encode(),
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="index.ts"\r\nContent-Type: application/typescript\r\n\r\n'.encode() + src + b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    status, out = call("POST", f"/projects/{REF}/functions/deploy?slug={slug}", b"".join(parts), {"content-type": f"multipart/form-data; boundary={boundary}"}, raw=True)
    if status >= 300:
        sys.exit(f"Deploy failed ({status}): {str(out)[:600]}")
    return out


def set_secrets(pairs):
    items = []
    for p in pairs:
        k, v = p.split("=", 1)
        if v.startswith("ENV:"):
            v = ENV[v[4:]]
        items.append({"name": k, "value": v})
    status, out = call("POST", f"/projects/{REF}/secrets", items)
    if status >= 300:
        sys.exit(f"Secrets failed ({status}): {str(out)[:600]}")
    return [i["name"] for i in items]


def anon_key():
    status, out = call("GET", f"/projects/{REF}/api-keys")
    if status >= 300:
        sys.exit(f"api-keys failed ({status}): {str(out)[:300]}")
    for k in out:
        if k.get("name") == "anon" and k.get("api_key"):
            return k["api_key"]
    sys.exit("no anon key found")


def auth_admin(method, path, body=None):
    key = ENV["SUPABASE_SERVICE_KEY"]
    req = urllib.request.Request(ENV["SUPABASE_URL"] + "/auth/v1/admin" + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"apikey": key, "authorization": f"Bearer {key}", "content-type": "application/json", "user-agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def staff_user(email, name="", role="staff", reset=False):
    if not re.fullmatch(r"[^\s@'\"]+@[^\s@'\"]+\.[^\s@'\"]+", email) or role not in ("staff", "manager", "owner"):
        sys.exit("bad email or role")
    password = secrets.token_urlsafe(12)
    status, out = auth_admin("POST", "/users", {"email": email, "password": password, "email_confirm": True})
    if status in (200, 201):
        shown = password
    elif status == 422 and reset:
        status, users = auth_admin("GET", "/users?per_page=200")
        uid = next((u["id"] for u in users.get("users", []) if u["email"].lower() == email.lower()), None)
        if not uid:
            sys.exit("user not found for reset")
        status, out = auth_admin("PUT", f"/users/{uid}", {"password": password})
        if status >= 300:
            sys.exit(f"reset failed ({status}): {str(out)[:300]}")
        shown = password
    elif status == 422:
        shown = None                                           # already exists: keep the old password
    else:
        sys.exit(f"create user failed ({status}): {str(out)[:300]}")
    safe_name = name.replace("'", "''")
    run_sql(f"insert into staff_users (email, name, role) values ('{email.lower()}', '{safe_name}', '{role}') "
            f"on conflict (email) do update set name = excluded.name, role = excluded.role")
    return shown


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == "sql":
        print(json.dumps(run_sql(Path(a[1]).read_text(encoding="utf-8")))[:600])
    elif a[0] == "query":
        print(json.dumps(run_sql(a[1]))[:2000])
    elif a[0] == "deploy":
        out = deploy(a[1], a[2], "--verify-jwt" in a)
        print("deployed", a[1], "->", f"{ENV['SUPABASE_URL']}/functions/v1/{a[1]}", str(out)[:200])
    elif a[0] == "anon-key":
        print(anon_key())
    elif a[0] == "staff-user":
        pw = staff_user(a[1], a[2] if len(a) > 2 and not a[2].startswith("--") else "", a[3] if len(a) > 3 and not a[3].startswith("--") else "staff", "--reset" in a)
        print("staff user ready:", a[1], "| one-time password:", pw if pw else "(account already existed, password unchanged; use --reset)")
    elif a[0] == "disable-signup":
        st, out = call("PATCH", f"/projects/{REF}/config/auth", {"disable_signup": True})
        print("disable_signup ->", st, str(out)[:120])
    elif a[0] == "secrets":
        print("set:", ", ".join(set_secrets(a[1:])))
    else:
        sys.exit(__doc__)
