"""统一 API 路由 —— 会话管理 + 卡 MCP 控制台 + 设置。"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from services import auto_chat_service, session_service, cursor_setup_service, mcp_inject_service
from services.mcp_bridge import read_settings, write_settings
from config import LOCAL_API_SECRET, LOCAL_API_SECRET_HEADER

router = APIRouter(prefix="/api", tags=["api"])


def _cors(data: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(content=data, status_code=status)


def _guard(request: Request) -> JSONResponse | None:
    secret = (
        request.headers.get(LOCAL_API_SECRET_HEADER)
        or request.query_params.get("local_api_secret")
    )
    if secret == LOCAL_API_SECRET:
        return None
    return _cors({"ok": False, "error": "unauthorized"}, 403)


# ─── 健康检查 ───

@router.get("/health")
def health():
    return {"ok": True}


# ─── 会话管理 ───

@router.get("/sessions")
def list_sessions():
    return _cors({"ok": True, "sessions": session_service.list_sessions()})


@router.get("/sessions/{sid}")
def get_session(sid: str):
    detail = session_service.get_session_detail(sid)
    if not detail:
        return _cors({"ok": False, "error": "not found"}, 404)
    return _cors({"ok": True, **detail})


@router.delete("/sessions/{sid}")
def delete_session(sid: str):
    ok = session_service.remove_session(sid)
    return _cors({"ok": ok})


# ─── 设置 ───

@router.get("/settings")
def get_settings():
    return _cors({"ok": True, "settings": read_settings()})


class SettingsReq(BaseModel):
    settings: dict


@router.post("/settings")
def save_settings(req: SettingsReq):
    current = read_settings()
    current.update(req.settings)
    write_settings(current)
    return _cors({"ok": True})


# ─── 卡 MCP 控制台 ───

@router.get("/auto-chat/overview")
def auto_chat_overview():
    return _cors({"ok": True, **auto_chat_service.gui_overview()})


class BatchReq(BaseModel):
    text_pattern: str
    count: int = 1
    retries: int = 500
    text_index_start: int = 1


@router.post("/auto-chat/batch")
def auto_chat_batch(req: BatchReq):
    clients = auto_chat_service.list_clients()
    if not clients:
        return _cors({"ok": False, "error": "没有可用的 Cursor 客户端"})
    client_ids = [c["clientId"] for c in clients]
    try:
        result = auto_chat_service.enqueue_batch(
            client_ids=client_ids,
            text_pattern=req.text_pattern,
            count=req.count,
            retries=req.retries,
            text_index_start=req.text_index_start,
        )
        return _cors({"ok": True, **result})
    except Exception as e:
        return _cors({"ok": False, "error": str(e)})


@router.post("/auto-chat/stop-all")
def auto_chat_stop_all():
    n = auto_chat_service.stop_all()
    return _cors({"ok": True, "stopped": n})


@router.post("/auto-chat/reset")
def auto_chat_reset():
    n = auto_chat_service.reset_all()
    return _cors({"ok": True, "cleared": n})


class ContinueReq(BaseModel):
    session_id: str
    text_pattern: str = ""
    retries: int = 500


@router.post("/auto-chat/continue")
def auto_chat_continue(req: ContinueReq):
    try:
        result = auto_chat_service.continue_in_composer(
            session_id=req.session_id,
            text_pattern=req.text_pattern,
            retries=req.retries,
        )
        return _cors({"ok": True, **result})
    except LookupError as e:
        return _cors({"ok": False, "error": str(e)}, 404)
    except Exception as e:
        return _cors({"ok": False, "error": str(e)})


# ─── 一键注入 ───

@router.get("/inject/status")
def inject_status():
    return _cors({"ok": True, **cursor_setup_service.check_status()})


@router.post("/inject")
def inject():
    result = cursor_setup_service.inject_all()
    return _cors(result)


@router.get("/hook/status")
def hook_status():
    return _cors({"ok": True, **mcp_inject_service.patch_status()})


@router.post("/hook/inject")
def hook_inject():
    result = mcp_inject_service.inject_hook()
    return _cors(result)


@router.post("/hook/restore")
def hook_restore():
    result = mcp_inject_service.restore_hook()
    return _cors(result)


@router.get("/auto-chat/session-metas")
def auto_chat_session_metas():
    return _cors({"ok": True, "metas": auto_chat_service.list_session_metas()})


# ─── 哑脚本接口（本机 secret 保护） ───

class RegisterReq(BaseModel):
    clientId: str
    title: str = ""
    location: str = ""
    focused: bool = False


@router.post("/auto-chat/register")
def register(req: RegisterReq, request: Request):
    denied = _guard(request)
    if denied:
        return denied
    return _cors(auto_chat_service.register_client(req.clientId, req.dict()))


@router.get("/auto-chat/register")
def register_get(request: Request, clientId: str = "", title: str = "", location: str = "", focused: bool = False):
    denied = _guard(request)
    if denied:
        return denied
    return _cors(auto_chat_service.register_client(clientId, {
        "clientId": clientId, "title": title, "location": location, "focused": focused,
    }))


@router.get("/auto-chat/cmd")
def fetch_cmd(request: Request, clientId: str = ""):
    denied = _guard(request)
    if denied:
        return denied
    cmd = auto_chat_service.fetch_command(clientId)
    if cmd is None:
        return _cors({"action": "wait"})
    return _cors(cmd)


class StatusReq(BaseModel):
    clientId: str = ""
    id: str
    status: str
    step: str = ""
    error: str = ""
    retryCount: int = 0
    composerId: str = ""
    sessionId: str = ""


@router.post("/auto-chat/status")
def status(req: StatusReq, request: Request):
    denied = _guard(request)
    if denied:
        return denied
    return _cors(auto_chat_service.report_status(req.dict()))


@router.get("/auto-chat/task-control")
def task_control(request: Request, clientId: str = "", taskId: str = ""):
    denied = _guard(request)
    if denied:
        return denied
    return _cors(auto_chat_service.task_control(clientId, taskId))
