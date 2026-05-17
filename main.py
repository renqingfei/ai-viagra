"""FastAPI 应用入口 —— 轻量版 MCP 会话管理工具。"""
import sys
import os
import asyncio
import datetime as _dt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from config import (
    CORS_ALLOW_ORIGINS,
    CORS_ALLOW_ORIGIN_REGEX,
    SERVER_HOST,
    SERVER_PORT,
    BASE_DIR,
    SILENT_RENEW_AFTER_S_DEFAULT,
    SILENT_RENEW_POLL_S,
    SILENT_RENEW_PAYLOAD,
)
from routes.api import router as api_router
from ws_handler import websocket_endpoint, manager


def _parse_utc_iso(raw: str | None) -> _dt.datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = _dt.datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_dt.timezone.utc)
        return dt.astimezone(_dt.timezone.utc)
    except ValueError:
        return None


def _resolve_silent_renew_after_s() -> int:
    try:
        from services.mcp_bridge import read_settings
        settings = read_settings()
        minutes = int(settings.get("silentRenewAfterMin") or 0)
        if minutes > 0:
            return max(60, min(86400, minutes * 60))
    except Exception:
        pass
    return SILENT_RENEW_AFTER_S_DEFAULT


def _resolve_silent_renew_enabled() -> bool:
    try:
        from services.mcp_bridge import read_settings
        return bool(read_settings().get("silentRenewEnabled", True))
    except Exception:
        return True


async def _background_session_watch():
    """轮询会话目录变化，推送 WebSocket 通知。"""
    await asyncio.sleep(2)
    last_fp: tuple = ()
    while True:
        try:
            from services.mcp_bridge import SESSIONS_ROOT
            entries: list[tuple] = []
            if SESSIONS_ROOT.exists():
                for child in SESSIONS_ROOT.iterdir():
                    if not child.is_dir():
                        continue
                    parts: list = [child.name]
                    for fname in ("meta.json", "pending.json", "history.jsonl"):
                        p = child / fname
                        if p.exists():
                            try:
                                st = p.stat()
                                parts.append((fname, st.st_size, int(st.st_mtime_ns)))
                            except OSError:
                                parts.append((fname, -1, -1))
                    entries.append(tuple(parts))
            entries.sort()
            fp = tuple(entries)
            if fp != last_fp:
                last_fp = fp
                if manager.active:
                    await manager.broadcast({"type": "sessions_changed"})
        except Exception:
            pass
        await asyncio.sleep(1.0)


async def _background_silent_renew():
    """服务端静默续命，防止 Cursor MCP 等待超时。"""
    await asyncio.sleep(10)
    while True:
        try:
            if not _resolve_silent_renew_enabled():
                await asyncio.sleep(SILENT_RENEW_POLL_S)
                continue
            after_s = _resolve_silent_renew_after_s()
            from services.mcp_bridge import list_session_ids, read_meta, read_pending, read_history
            from services.mcp_bridge.message_queue import enqueue
            from services.mcp_bridge.session_meta_store import get as get_session_meta, patch as patch_session_meta

            now = _dt.datetime.now(_dt.timezone.utc)
            now_ms = int(now.timestamp() * 1000)
            after_ms = after_s * 1000
            for sid in list_session_ids():
                meta = read_meta(sid) or {}
                wait_until = _parse_utc_iso(meta.get("mcp_waiting_until"))
                wait_since = _parse_utc_iso(meta.get("mcp_waiting_since"))
                if not wait_until or wait_until <= now:
                    continue
                if wait_since and (now - wait_since).total_seconds() < after_s:
                    continue
                if read_pending(sid):
                    continue
                last_renew_ms = int(get_session_meta(sid).get("lastAutoRenewAt") or 0)
                if last_renew_ms and (now_ms - last_renew_ms) < after_ms:
                    continue
                hist = read_history(sid, limit=1)
                last = hist[-1] if hist else {}
                if last.get("role") != "assistant":
                    continue
                await asyncio.to_thread(
                    enqueue, session_id=sid, text=SILENT_RENEW_PAYLOAD,
                    images=[], files=[], allow_create=False,
                )
                patch_session_meta(sid, lastAutoRenewAt=now_ms)
        except Exception:
            pass
        await asyncio.sleep(SILENT_RENEW_POLL_S)


@asynccontextmanager
async def lifespan(app):
    from services.mcp_bridge import ensure_dirs
    from services.mcp_bridge.session_meta_store import init as init_meta
    from services.mcp_bridge import tcp_bridge
    ensure_dirs()
    init_meta(BASE_DIR)
    try:
        port = await tcp_bridge.start_server()
        print(f"[tcp-bridge] listening on 127.0.0.1:{port}")
    except Exception as e:
        print(f"[tcp-bridge] start failed: {e}")
    session_task = asyncio.create_task(_background_session_watch())
    renew_task = asyncio.create_task(_background_silent_renew())
    yield
    session_task.cancel()
    renew_task.cancel()
    try:
        await tcp_bridge.stop_server()
    except Exception:
        pass


app = FastAPI(title="wanzi-mcp", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_origin_regex=CORS_ALLOW_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.websocket("/ws")(websocket_endpoint)

static_dir = os.path.join(BASE_DIR, "static")
templates_dir = os.path.join(BASE_DIR, "templates")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

_NO_CACHE = {"Cache-Control": "no-store"}


@app.get("/")
def index():
    return FileResponse(os.path.join(templates_dir, "app.html"), headers=_NO_CACHE)


if __name__ == "__main__":
    uvicorn.run("main:app", host=SERVER_HOST, port=SERVER_PORT, reload=True)
