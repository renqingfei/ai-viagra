"""MCP 通信桥接 —— 读写 ~/.wanzi-mcp/sessions/ 目录下的会话文件。"""
from __future__ import annotations

import json
import os
import pathlib
from typing import Any

SESSIONS_ROOT = pathlib.Path.home() / ".wanzi-mcp" / "sessions"
SETTINGS_FILE = pathlib.Path.home() / ".wanzi-mcp" / "settings.json"


def ensure_dirs():
    SESSIONS_ROOT.mkdir(parents=True, exist_ok=True)


def read_settings() -> dict[str, Any]:
    if not SETTINGS_FILE.exists():
        return {}
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_settings(data: dict[str, Any]):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(SETTINGS_FILE) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, str(SETTINGS_FILE))


def list_session_ids() -> list[str]:
    ensure_dirs()
    out = []
    if SESSIONS_ROOT.exists():
        for child in SESSIONS_ROOT.iterdir():
            if child.is_dir():
                out.append(child.name)
    return sorted(out)


def _session_dir(sid: str) -> pathlib.Path:
    return SESSIONS_ROOT / sid


def read_meta(sid: str) -> dict[str, Any] | None:
    p = _session_dir(sid) / "meta.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_meta(sid: str, data: dict[str, Any]):
    d = _session_dir(sid)
    d.mkdir(parents=True, exist_ok=True)
    p = d / "meta.json"
    tmp = str(p) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, str(p))


def read_pending(sid: str) -> str | None:
    p = _session_dir(sid) / "pending.json"
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data.get("text") or None
    except Exception:
        return None


def read_history(sid: str, limit: int = 50) -> list[dict[str, Any]]:
    p = _session_dir(sid) / "history.jsonl"
    if not p.exists():
        return []
    lines = []
    try:
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    lines.append(json.loads(line))
    except Exception:
        pass
    if limit:
        lines = lines[-limit:]
    return lines


def delete_session(sid: str) -> bool:
    d = _session_dir(sid)
    if not d.exists():
        return False
    import shutil
    shutil.rmtree(d, ignore_errors=True)
    return True
