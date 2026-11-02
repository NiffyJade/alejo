"""Assemble the publishable Alejo site into .tmp/site_dist (no backups, no test files, only the pictures the pages use).

  python execution/build_site_dist.py

Then upload that folder to any static host: Cloudflare Pages (wrangler pages deploy .tmp/site_dist --project-name alejo),
Netlify (drag the folder onto app.netlify.com/drop) or similar. The folder contains a _headers file (security + caching)
and robots.txt that keeps the staff dashboard out of search results.
"""
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "website"
OUT = ROOT / ".tmp" / "site_dist"

if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir(parents=True)

for name in ("index.html", "site.css", "site.js"):
    shutil.copy2(SRC / name, OUT / name)
shutil.copytree(SRC / "app", OUT / "app")

# only the pictures that the pages actually reference
used = set()
for page in [OUT / "index.html", *OUT.glob("app/*.html")]:
    used |= set(re.findall(r"assets/photos/[\w.\-]+", page.read_text(encoding="utf-8")))
(OUT / "assets" / "photos").mkdir(parents=True)
for ref in sorted(used):
    shutil.copy2(SRC / ref, OUT / ref)

(OUT / "robots.txt").write_text("User-agent: *\nAllow: /\nDisallow: /app/\n", encoding="utf-8")
(OUT / "_headers").write_text(
    "/*\n"
    "  X-Content-Type-Options: nosniff\n"
    "  Referrer-Policy: strict-origin-when-cross-origin\n"
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()\n"
    "/assets/*\n"
    "  Cache-Control: public, max-age=31536000, immutable\n"
    "/app/*\n"
    "  X-Robots-Tag: noindex\n",
    encoding="utf-8",
)

size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
print(f"built {OUT} : {len(list(OUT.rglob('*.*')))} files, {size / 1_000_000:.1f} MB, {len(used)} pictures")
