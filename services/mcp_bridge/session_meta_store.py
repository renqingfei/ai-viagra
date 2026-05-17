"""会话元数据内存存储 + 磁盘持久化。"""
from __future__ import annotations

import json
import os
import threading
from typing import Any


_lock = threading.Lock()
_store: dict[str, dict[str, Any]] = {}

_persist_path: str = ""


def init(data_dir: str):
    global _persist_path
    _persist_path = os.path.join(data_dir, "session_meta.json")
    _load()


def _load():
    if not _persist_path or not os.path.exists(_persist_path):
        return
    try:
        with open(_persist_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            with _lock:
                _store.update(raw)
    except Exception:
        pass


def _save():
    if not _persist_path:
        return
    try:
        os.makedirs(os.path.dirname(_persist_path) or ".", exist_ok=True)
        tmp = _persist_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_store, f, ensure_ascii=False, default=str)
        os.replace(tmp, _persist_path)
    except Exception:
        pass


def get(sid: str) -> dict[str, Any]:
    with _lock:
        return dict(_store.get(sid) or {})


def patch(sid: str, **kw):
    with _lock:
        rec = _store.setdefault(sid, {})
        rec.update(kw)
        _save()


def all_items() -> dict[str, dict[str, Any]]:
    with _lock:
        return {k: dict(v) for k, v in _store.items()}
