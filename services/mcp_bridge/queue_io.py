"""会话文件读写工具。"""
from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_ROOT = Path.home() / ".wanzi-mcp"
SESSIONS_ROOT = DATA_ROOT / "sessions"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def generate_session_id() -> str:
    ts = datetime.now(timezone.utc).strftime("%H%M%S")
    rand = secrets.token_hex(4)
    return f"{ts}-{rand}"


def ensure_session(sid: str, title: str | None = None):
    d = SESSIONS_ROOT / sid
    d.mkdir(parents=True, exist_ok=True)
    meta_path = d / "meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if title and not meta.get("title"):
            meta["title"] = title
            _write_json(meta_path, meta)
    else:
        meta = {
            "title": title or sid[:8],
            "created_at": now_iso(),
            "last_active_at": now_iso(),
        }
        _write_json(meta_path, meta)


def read_meta(sid: str) -> dict[str, Any]:
    p = SESSIONS_ROOT / sid / "meta.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def update_meta(sid: str, **fields):
    p = SESSIONS_ROOT / sid / "meta.json"
    (SESSIONS_ROOT / sid).mkdir(parents=True, exist_ok=True)
    meta = {}
    if p.exists():
        try:
            meta = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    meta.update(fields)
    _write_json(p, meta)


def read_history(sid: str, limit: int = 50) -> list[dict[str, Any]]:
    p = SESSIONS_ROOT / sid / "history.jsonl"
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


def append_history(sid: str, entry: dict[str, Any]):
    p = SESSIONS_ROOT / sid / "history.jsonl"
    (SESSIONS_ROOT / sid).mkdir(parents=True, exist_ok=True)
    with open(p, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def pop_pending(sid: str) -> dict[str, Any] | None:
    p = SESSIONS_ROOT / sid / "pending.json"
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        os.remove(p)
        return data
    except Exception:
        return None


def list_session_ids() -> list[str]:
    if not SESSIONS_ROOT.exists():
        return []
    return sorted(
        [d.name for d in SESSIONS_ROOT.iterdir() if d.is_dir()],
        reverse=True,
    )


def _write_json(path: Path, data: dict):
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, str(path))
