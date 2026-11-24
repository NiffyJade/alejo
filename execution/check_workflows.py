"""Dry-build every n8n workflow in memory and check it, WITHOUT publishing anything.

Usage (from the project root):   python -I execution/check_workflows.py
Checks, per workflow:
  - the hotel audit (every database call names its hotel; no node uses the old shared Telegram bot)
  - every n8n expression is well formed: it starts with ={{ and ends }}, with no stray }} in the middle (n8n would cut it short)
  - every connection points at a node that exists, and every node is reachable from a trigger
  - every JavaScript code node parses
Reads the n8n API only to find existing workflow ids; changes nothing.
"""
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("b", ROOT / "execution" / "build_n8n_workflows.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

b.workflow_id = lambda name: "DRY-RUN-ID"          # the real lookup asks n8n; a dry run must not depend on what is already published
TRIGGERS = ("webhook", "scheduleTrigger", "executeWorkflowTrigger", "telegramTrigger")
problems = []


def expr_problems(wf, node, key, v):
    out = []
    if isinstance(v, str) and v.startswith("="):
        body = v[1:]
        opens, closes = body.count("{{"), body.count("}}")
        if opens != closes:
            out.append(f"{wf.name} / {node['name']} / {key}: {opens} '{{{{' but {closes} '}}}}'")
        # JSON.stringify bodies are one single expression: a '}}' anywhere but the very end ends it early
        if body.startswith("{{ JSON.stringify(") and body.count("}}") != 1:
            out.append(f"{wf.name} / {node['name']} / {key}: stray '}}}}' inside a single expression")
    return out


def walk(v):
    if isinstance(v, dict):
        for k, x in v.items():
            yield from ((k, y) for y in walk(x)) if False else walk(x)
            if isinstance(x, str):
                yield k, x
    elif isinstance(v, list):
        for x in v:
            yield from walk(x)


node_bin = shutil.which("node")
builds = (b.typing_keepalive, b.telegram_bot, b.scheduler, b.scheduler_parent, b.booking_created, b.vapi_tools, b.demo_alert, b.dashboard_reply, b.typing_signal)
for build in builds:
    w = build()
    b.audit(w)                                                        # exits with a message if a call is unscoped
    names = {n["name"] for n in w.nodes}
    if len(names) != len(w.nodes):
        problems.append(f"{w.name}: duplicate node names")
    for src, outs in w.conns.items():
        if src not in names:
            problems.append(f"{w.name}: connection from unknown node {src}")
        for slot in outs["main"]:
            for t in slot:
                if t["node"] not in names:
                    problems.append(f"{w.name}: connection to unknown node {t['node']}")
    reach = {n["name"] for n in w.nodes if any(t in n["type"] for t in TRIGGERS)}
    frontier = list(reach)
    while frontier:
        cur = frontier.pop()
        for slot in w.conns.get(cur, {"main": []})["main"]:
            for t in slot:
                if t["node"] not in reach:
                    reach.add(t["node"]); frontier.append(t["node"])
    for n in w.nodes:
        if n["name"] not in reach:
            problems.append(f"{w.name}: node never reached from a trigger: {n['name']}")
        for k, v in walk(n["parameters"]):
            problems += expr_problems(w, n, k, v)
            if "{{STAFF}}" in str(v):
                problems.append(f"{w.name} / {n['name']}: unresolved STAFF marker")
        if n["type"] == "n8n-nodes-base.code" and node_bin:
            js = n["parameters"]["jsCode"]
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
                f.write("(function(){\n" + js + "\n})")
                path = f.name
            r = subprocess.run([node_bin, "--check", path], capture_output=True, text=True)
            Path(path).unlink()
            if r.returncode:
                problems.append(f"{w.name} / {n['name']}: JavaScript does not parse: {r.stderr.strip().splitlines()[-1][:160]}")
    tg = sum(1 for n in w.nodes if "telegram-proxy" in str(n["parameters"].get("url", "")))
    db = sum(1 for n in w.nodes if str(n["parameters"].get("url", "")).startswith("=" + b.SB))
    print(f"{w.name:58s} nodes={len(w.nodes):3d}  telegram calls={tg:2d}  database calls={db:2d}")

if problems:
    print("\nPROBLEMS:")
    for p in problems:
        print(" -", p)
    sys.exit(1)
print("\nall workflows pass the audit and structural checks")
