r"""Needle sidecar for Corvoid Hub.

Long-running worker for the optional Needle add-on: the app starts it once, sends JSON lines on
stdin and reads one JSON line per request on stdout. The model is loaded once and only rebuilt
when the tool list changes. No network is used after the weights are on disk.

    python -I needle_serve.py --weights D:\Tools\needle\models\needle3.cact

stdin   {"id": 1, "text": "add a task fix login to Corvogames", "tools": [<tool schema>, ...]}
stdout  {"id": 1, "calls": [{"name": ..., "arguments": {...}}], "held": [], "confidence": 0.4, "ms": 310}
        {"id": 1, "error": "..."}

This is Corvoid Hub's own code (Apache-2.0 model: Cactus Compute, needle3).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time


def _cache_dir(weights: str) -> str:
    """A writable cache folder next to the weights (the model's engine is cached there)."""
    model_dir = os.path.dirname(os.path.abspath(weights))
    root = os.path.dirname(model_dir)
    for candidate in (os.path.join(model_dir, "cache"), os.path.join(root, "cache")):
        if os.path.isdir(candidate):
            return candidate
    return os.path.join(model_dir, "cache")


def _prepare_env(weights: str) -> None:
    """Offline, telemetry off and the engine cache next to the weights. Set before cactus loads."""
    cache = _cache_dir(weights)
    os.environ.setdefault("CACTUS_TELEMETRY", "0")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("XDG_CACHE_HOME", cache)
    os.environ.setdefault("HF_HOME", os.path.join(cache, "hf"))


# The protocol lives on the real stdout; anything the model prints goes to stderr instead.
_PROTOCOL = sys.stdout


class Engine:
    """One Cactus instance, rebuilt only when the tools list changes."""

    def __init__(self, weights: str) -> None:
        self._weights = weights
        self._model = None
        self._hash = ""

    def _build(self, tools: list) -> None:
        import cactus  # imported after the env is ready

        saved, sys.stdout = sys.stdout, sys.stderr
        try:
            if self._model is not None:
                try:
                    self._model.reset()
                except Exception:
                    pass
            self._model = cactus.Cactus(weights=self._weights, tools=tools)
        finally:
            sys.stdout = saved
        self._hash = _hash(tools)

    def run(self, text: str, tools: list) -> dict:
        key = _hash(tools)
        if self._model is None or key != self._hash:
            self._build(tools)
        saved, sys.stdout = sys.stdout, sys.stderr
        try:
            result = self._model.complete(text) or {}
        finally:
            sys.stdout = saved
        if not isinstance(result, dict):
            raise RuntimeError("the model returned something other than an object")
        return result


def _hash(tools: list) -> str:
    import hashlib

    return hashlib.sha256(json.dumps(tools, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def _calls(result: dict, key: str) -> list:
    raw = result.get(key) or []
    out = []
    for call in raw:
        if not isinstance(call, dict):
            continue
        arguments = call.get("arguments")
        out.append({"name": str(call.get("name", "")), "arguments": arguments if isinstance(arguments, dict) else {}})
    return out


def _answer(engine: Engine, request: dict) -> dict:
    text = request.get("text")
    tools = request.get("tools")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("text is empty")
    if not isinstance(tools, list):
        raise ValueError("tools must be a list")

    started = time.perf_counter()
    result = engine.run(text.strip(), tools)
    confidence = result.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = None
    calls = _calls(result, "function_calls")
    if not calls:
        error = result.get("error") or result.get("reason")
        if isinstance(error, str) and error.strip() and result.get("success") is False:
            raise RuntimeError(error.strip())
    return {
        "calls": calls,
        "held": _calls(result, "suppressed_calls"),
        "confidence": confidence,
        "ms": int((time.perf_counter() - started) * 1000),
    }


def _write(payload: dict) -> None:
    _PROTOCOL.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _PROTOCOL.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description="Needle sidecar for Corvoid Hub")
    parser.add_argument("--weights", required=True, help="path to needle3.cact")
    args = parser.parse_args()

    # The protocol is UTF-8 whatever the console code page is; a bad byte never breaks a request.
    try:
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        _PROTOCOL.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    weights = os.path.abspath(args.weights)
    if not os.path.isfile(weights):
        _write({"id": 0, "error": f"weights not found: {weights}"})
        return 2
    _prepare_env(weights)

    engine = Engine(weights)
    # Read the first tools list with the first request; nothing is loaded before then.
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("request must be an object")
            request_id = request.get("id")
            answer = _answer(engine, request)
        except Exception as exc:  # a request never kills the worker
            _write({"id": request_id, "error": str(exc) or exc.__class__.__name__})
            continue
        _write({"id": request_id, **answer})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
