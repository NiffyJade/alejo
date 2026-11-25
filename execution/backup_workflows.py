"""Back up every n8n workflow (read-only) to .tmp/wf_backup_<label>_<timestamp>/<id>.json plus an index.

Usage (from the project root):   python -I execution/backup_workflows.py before_multihotel_workflows
To put one back:  python -I execution/backup_workflows.py restore <folder> "<workflow name>"   (updates the workflow with that name in place)
The files hold workflow definitions (node settings, texts, credential NAMES, webhook paths): keep them in .tmp/ (git-ignored).
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_n8n_workflows as b  # noqa: E402  (reuses its n8n API helper and .env)

ROOT = Path(__file__).resolve().parent.parent


def backup(label):
    dest = ROOT / ".tmp" / f"wf_backup_{label}_{time.strftime('%Y%m%d_%H%M%S')}"
    dest.mkdir(parents=True)
    index = []
    gone = []
    for x in b.api("GET", "/workflows?limit=250")["data"]:
        try:
            wf = b.api("GET", f"/workflows/{x['id']}")
        except SystemExit as e:                # a short-lived workflow made and removed by another automation can vanish between the list and the fetch
            if "HTTP 404" not in str(e):
                raise
            gone.append(x["name"])
            continue
        (dest / f"{x['id']}.json").write_text(json.dumps(wf), encoding="utf-8")
        index.append({"id": x["id"], "name": x["name"], "active": x.get("active")})
    if gone:
        print("skipped (removed from n8n while the backup ran):", gone)
    (dest / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    print("saved", len(index), "workflows to", dest)
    for i in index:
        print(" ", "ACTIVE  " if i["active"] else "inactive", i["name"])


def restore(folder, name):
    d = Path(folder)
    index = json.loads((d / "index.json").read_text(encoding="utf-8"))
    hit = next((i for i in index if i["name"] == name), None)
    if not hit:
        sys.exit("no such workflow in that backup")
    wf = json.loads((d / f"{hit['id']}.json").read_text(encoding="utf-8"))
    body = {k: wf[k] for k in ("name", "nodes", "connections", "settings") if k in wf}
    b.api("PUT", f"/workflows/{hit['id']}", body)
    print("restored", name, "(its active/inactive state is unchanged by this call)")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "restore":
        restore(a[1], a[2])
    else:
        backup(a[0] if a else "manual")
