"""会话管理 service —— 查询/创建/删除 MCP 会话，提供 GUI 展示数据。"""
from __future__ import annotations

import datetime as _dt
from typing import Any

from services.mcp_bridge import (
    delete_session,
    list_session_ids,
    read_history,
    read_meta,
)


def _now_iso() -> str:
    return _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")


def list_sessions() -> list[dict[str, Any]]:
    out = []
    for sid in list_session_ids():
        meta = read_meta(sid) or {}
        out.append({
            "sessionId": sid,
            "title": meta.get("title") or sid[:8],
            "created_at": meta.get("created_at") or "",
            "mcp_waiting_since": meta.get("mcp_waiting_since") or "",
            "mcp_waiting_until": meta.get("mcp_waiting_until") or "",
            "last_message_at": meta.get("last_message_at") or "",
            "connected": bool(meta.get("mcp_waiting_until")),
        })
    out.sort(key=lambda x: x.get("last_message_at") or x.get("created_at") or "", reverse=True)
    return out


def get_session_detail(sid: str) -> dict[str, Any] | None:
    meta = read_meta(sid)
    if meta is None:
        return None
    history = read_history(sid, limit=100)
    return {
        "sessionId": sid,
        "meta": meta,
        "history": history,
    }


def remove_session(sid: str) -> bool:
    return delete_session(sid)
