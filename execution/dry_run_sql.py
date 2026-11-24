"""Dry-run a migration together with its test, in ONE call that always rolls back (the test ends with `raise exception 'ALL OK'`).
Nothing is ever applied to the live database by this script. Usage:
  python -I -X utf8 execution/dry_run_sql.py sql/025_services.sql execution/test_services.sql
PASS prints "PASS: ALL OK". Anything else prints the database's own error, which names the failed check.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import supabase_admin as sa  # noqa: E402


def main(files):
    if len(files) < 2:
        sys.exit("usage: dry_run_sql.py MIGRATION.sql TEST.sql [more.sql ...]   (the LAST file must end by raising 'ALL OK')")
    text = "\n".join(Path(f).read_text(encoding="utf-8") for f in files)
    status, out = sa.call("POST", f"/projects/{sa.REF}/database/query", {"query": text})
    msg = str(out)
    if "ALL OK" in msg:
        print("PASS: ALL OK (rolled back, nothing was applied)")
        return 0
    print(f"FAIL ({status}): {msg[:900]}")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
