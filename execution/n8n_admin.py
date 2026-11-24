"""Small n8n helper for the Alejo workflows (uses the n8n API key in .env; never prints secrets).

Usage (from the project root):
  python -I -X utf8 execution/n8n_admin.py status [name-prefix]          which workflows exist and which are active
  python -I -X utf8 execution/n8n_admin.py activate "<exact name>"
  python -I -X utf8 execution/n8n_admin.py deactivate "<exact name>"
  python -I -X utf8 execution/n8n_admin.py runs "<exact name>" [N]        the last N executions: status and the node that failed, with its error
  python -I -X utf8 execution/n8n_admin.py delete "<exact name>"          delete a workflow (asks nothing: only use on copies you built)
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_n8n_workflows as b  # noqa: E402


def find(name):
    hits = [x for x in b.api("GET", "/workflows?limit=250")["data"] if x["name"] == name]
    if not hits:
        sys.exit("no workflow named: " + name)
    return hits[0]


def clean(text):
    return re.sub(r"telegram-proxy/[^/\s\"']+", "telegram-proxy/<SECRET>", str(text))


def main(a):
    if not a:
        sys.exit(__doc__)
    cmd = a[0]
    if cmd == "status":
        pre = a[1] if len(a) > 1 else ""
        for x in sorted(b.api("GET", "/workflows?limit=250")["data"], key=lambda x: x["name"]):
            if x["name"].startswith(pre):
                print(("ACTIVE  " if x["active"] else "inactive"), x["name"], x["id"])
    elif cmd in ("activate", "deactivate"):
        x = find(a[1])
        b.api("POST", f"/workflows/{x['id']}/{cmd}")
        print(cmd + "d:", x["name"])
    elif cmd == "delete":
        x = find(a[1])
        b.api("DELETE", f"/workflows/{x['id']}")
        print("deleted:", x["name"])
    elif cmd == "runs":
        x = find(a[1])
        n = int(a[2]) if len(a) > 2 else 5
        rows = b.api("GET", f"/executions?workflowId={x['id']}&limit={n}&includeData=true")["data"]
        for e in rows:
            rd = (e.get("data") or {}).get("resultData") or {}
            err = rd.get("error") or {}
            last = rd.get("lastNodeExecuted")
            print(f"{e['id']}  {e.get('status'):9s} {e.get('startedAt', '')[:19]}  last node: {last}")
            if err:
                print("      error:", clean(err.get("message", ""))[:300], "| node:", (err.get("node") or {}).get("name"))
            for node, runs in (rd.get("runData") or {}).items():
                for r in runs:
                    if r.get("error"):
                        print("      node", node, "->", clean(r["error"].get("message", ""))[:200])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
