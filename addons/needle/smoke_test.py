r"""Smoke test for the Needle sidecar: sends three plain-language commands and prints the calls.

    python -I smoke_test.py --python D:\Tools\needle\venv\Scripts\python.exe --weights D:\Tools\needle\models\needle3.cact

It talks to addons/needle/needle_serve.py exactly like the app does (one JSON line per request).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "needle_serve.py")

TOOLS = [
    {
        "name": "open_project",
        "description": "Open a project's page.",
        "parameters": {
            "type": "object",
            "properties": {"project": {"type": "string", "enum": ["Corvogames", "Starfall"]}},
            "required": ["project"],
        },
    },
    {
        "name": "add_task",
        "description": "Add an open task to a project.",
        "parameters": {
            "type": "object",
            "properties": {
                "project": {"type": "string", "enum": ["Corvogames", "Starfall"]},
                "task": {"type": "string"},
            },
            "required": ["project", "task"],
        },
    },
    {
        "name": "log_work",
        "description": "Log finished work as one bullet in today's log.",
        "parameters": {
            "type": "object",
            "properties": {
                "project": {"type": "string", "enum": ["Corvogames", "Starfall"]},
                "kind": {"type": "string", "enum": ["task", "update"]},
                "text": {"type": "string"},
                "next": {"type": "string"},
            },
            "required": ["project", "kind", "text"],
        },
    },
    {
        "name": "backup_now",
        "description": "Write one backup zip of the hub and vault.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "set_status",
        "description": "Change the status of a project.",
        "parameters": {
            "type": "object",
            "properties": {
                "project": {"type": "string", "enum": ["Corvogames", "Starfall"]},
                "status": {"type": "string", "enum": ["idea", "active", "blocked", "paused", "done"]},
            },
            "required": ["project", "status"],
        },
    },
]

COMMANDS = [
    "open Corvogames",
    "add a task fix the login screen to Corvogames",
    "back up now",
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Needle sidecar smoke test")
    parser.add_argument("--python", default=os.environ.get("CORVOID_NEEDLE_PYTHON", sys.executable))
    parser.add_argument("--weights", default=os.environ.get("CORVOID_NEEDLE_WEIGHTS", ""))
    parser.add_argument("commands", nargs="*", default=None)
    args = parser.parse_args()

    if not args.weights:
        parser.error("--weights (needle3.cact) is required")
    commands = args.commands or COMMANDS

    env = dict(os.environ)
    env.update({"CACTUS_TELEMETRY": "0", "HF_HUB_OFFLINE": "1"})
    started = time.perf_counter()
    proc = subprocess.Popen(
        [args.python, "-I", SCRIPT, "--weights", args.weights],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        env=env,
    )
    failures = 0
    try:
        for index, command in enumerate(commands, start=1):
            request = {"id": index, "text": command, "tools": TOOLS}
            proc.stdin.write(json.dumps(request) + "\n")
            proc.stdin.flush()
            line = proc.stdout.readline()
            if not line:
                stderr = proc.stderr.read().strip()
                print(f"{command}\n  sidecar stopped: {stderr or 'no output'}")
                return 1
            answer = json.loads(line)
            if answer.get("error"):
                failures += 1
                print(f"{command}\n  error: {answer['error']}")
                continue
            calls = answer.get("calls") or []
            held = answer.get("held") or []
            summary = ", ".join(f'{c["name"]}({json.dumps(c["arguments"], ensure_ascii=False)})' for c in calls)
            print(f"{command}\n  -> {summary or 'no call'}")
            if held:
                print(f"     held: {json.dumps(held, ensure_ascii=False)}")
            print(f"     confidence {answer.get('confidence')} | {answer.get('ms')} ms")
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    print(f"\n{len(commands) - failures}/{len(commands)} answered | {time.perf_counter() - started:.1f} s")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
