"""Load knowledge/nigerian_hotel_kb.json into Supabase.

- knowledge_entries: upserted by id (re-running refreshes seed text, leaves staff-learned rows alone).
- hotel_settings: inserted only if the key is missing, so values you've filled in are never overwritten.

Usage: python -I execution/load_knowledge.py [--dry-run]
Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in .env and sql/001_schema.sql already run.
"""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env():
    env = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def post(env, table, rows, prefer, on_conflict=None):
    url = f"{env['SUPABASE_URL']}/rest/v1/{table}"
    if on_conflict:
        url += f"?on_conflict={on_conflict}"
    req = urllib.request.Request(
        url,
        data=json.dumps(rows).encode("utf-8"),
        method="POST",
        headers={
            "apikey": env["SUPABASE_SERVICE_KEY"],
            "Authorization": f"Bearer {env['SUPABASE_SERVICE_KEY']}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        },
    )
    try:
        urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        sys.exit(f"{table}: HTTP {e.code} {e.read().decode('utf-8', 'replace')}")


def main():
    kb = json.loads((ROOT / "knowledge" / "nigerian_hotel_kb.json").read_text(encoding="utf-8"))
    entries = [
        {"id": e["id"], "category": e["category"], "question": e["question"], "answer": e["answer"]}
        for e in kb["entries"]
    ]
    settings = [{"key": k, "value": v} for k, v in kb["placeholders"].items()]
    print(f"{len(entries)} knowledge entries, {len(settings)} settings")
    if "--dry-run" in sys.argv:
        return
    env = load_env()
    post(env, "knowledge_entries", entries, "resolution=merge-duplicates,return=minimal", on_conflict="id")
    post(env, "hotel_settings", settings, "resolution=ignore-duplicates,return=minimal", on_conflict="key")
    print("loaded")


if __name__ == "__main__":
    main()
