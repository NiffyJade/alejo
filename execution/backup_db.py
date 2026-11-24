"""Back up the live Supabase database (read-only) to .tmp/db_backup_<label>_<timestamp>.json

Usage (from the project root):
  python -I execution/backup_db.py before_multihotel

Saves every row of every public table, plus the definition of every function, every row-level-security
policy and every trigger, so a bad migration can be inspected or undone. Reads only; changes nothing.
Credentials come from .env (never printed). The file holds guest data, so it stays in .tmp/ (git-ignored).
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import supabase_admin as sa  # noqa: E402


def main(label):
    tables = [r["t"] for r in sa.run_sql(
        "select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace "
        "where n.nspname = 'public' and c.relkind = 'r' order by 1")]
    out = {"taken_at": time.strftime("%Y-%m-%d %H:%M:%S"), "project": sa.REF, "tables": {}, "counts": {}}
    for t in tables:
        rows = sa.run_sql(f'select * from public."{t}"')
        out["tables"][t] = rows
        out["counts"][t] = len(rows)
    out["columns"] = sa.run_sql(
        "select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns "
        "where table_schema = 'public' order by table_name, ordinal_position")
    out["functions"] = sa.run_sql(
        "select p.proname as name, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
        "where n.nspname = 'public' and p.prokind = 'f' order by 1")
    out["policies"] = sa.run_sql(
        "select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies "
        "where schemaname = 'public' order by tablename, policyname")
    out["triggers"] = sa.run_sql(
        "select event_object_table as tbl, trigger_name, action_statement from information_schema.triggers "
        "where trigger_schema = 'public' order by 1, 2")
    out["constraints"] = sa.run_sql(
        "select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def from pg_constraint "
        "where connamespace = 'public'::regnamespace order by 1, 2")
    out["indexes"] = sa.run_sql(
        "select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2")
    dest = sa.ROOT / ".tmp" / f"db_backup_{label}_{time.strftime('%Y%m%d_%H%M%S')}.json"
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(out, indent=1, default=str), encoding="utf-8")
    print("saved", dest, f"({dest.stat().st_size // 1024} KB)")
    print("rows per table:", json.dumps(out["counts"]))
    print("functions:", len(out["functions"]), "| policies:", len(out["policies"]), "| triggers:", len(out["triggers"]))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "manual")
