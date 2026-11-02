"""Publish the Alejo site to Vercel (static) in one command.

  python execution/deploy_vercel.py

Steps: rebuild the lean publish folder (execution/build_site_dist.py), copy it into .tmp/alejo (the folder name becomes the
Vercel project name), write vercel.json (clean URLs + the same security headers the old Cloudflare setup had), then run
`vercel deploy --prod --yes`. Needs the Vercel CLI (`npm i -g vercel`) and a signed-in session (`vercel login`, `vercel whoami`).
The first run links the project and stores .vercel in .tmp/alejo, which later runs keep.
After a custom domain is attached, add it to ALLOWED in supabase/functions/demo-request and staff-reply and redeploy them
with execution/supabase_admin.py.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / ".tmp" / "alejo"
DIST = ROOT / ".tmp" / "site_dist"

CONFIG = {
    "cleanUrls": True,
    "trailingSlash": False,
    "headers": [
        {"source": "/(.*)", "headers": [
            {"key": "X-Content-Type-Options", "value": "nosniff"},
            {"key": "Referrer-Policy", "value": "strict-origin-when-cross-origin"},
            {"key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()"},
        ]},
        {"source": "/assets/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=31536000, immutable"}]},
        {"source": "/app/(.*)", "headers": [{"key": "X-Robots-Tag", "value": "noindex"}]},
    ],
}

subprocess.run([sys.executable, "-I", str(ROOT / "execution" / "build_site_dist.py")], check=True)
SITE.mkdir(parents=True, exist_ok=True)
for item in SITE.iterdir():                       # keep .vercel (the project link), replace everything else
    if item.name == ".vercel":
        continue
    shutil.rmtree(item) if item.is_dir() else item.unlink()
for item in DIST.iterdir():
    if item.name == "_headers":                   # Cloudflare-only; Vercel reads vercel.json
        continue
    shutil.copytree(item, SITE / item.name) if item.is_dir() else shutil.copy2(item, SITE / item.name)
(SITE / "vercel.json").write_text(json.dumps(CONFIG, indent=2), encoding="utf-8")
sys.exit(subprocess.run("vercel deploy --prod --yes", cwd=SITE, shell=True).returncode)
