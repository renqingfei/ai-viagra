"""卡 MCP 对话调度 service。

职责：
- 维护 Cursor 哑脚本 (client) 注册表
- 维护待下发指令队列
- 接收哑脚本上报的状态
- 暴露给 GUI 的 API：启动/停止 batch、查询进度
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import threading
import uuid
from collections import deque
from typing import Any, Deque

CLIENT_STALE_SECONDS = 30
SESSION_META_CAP = 200
SESSION_META_FILENAME = "auto_chat_session_meta.json"
DEFAULT_CONTINUE_TEXT_PATTERN = "用wanzi-mcp进行会话,使用项目名称作为标题传入"


def _now() -> _dt.datetime:
    return _dt.datetime.utcnow()


def _now_iso() -> str:
    return _now().strftime("%Y-%m-%dT%H:%M:%S")


def _session_meta_persist_path() -> str:
    try:
        from config import DATA_DIR
        return os.path.join(DATA_DIR, SESSION_META_FILENAME)
    except Exception:
        return ""


def _default_session_meta_record(sid: str) -> dict[str, Any]:
    now = _now_iso()
    return {
        "sessionId": sid,
        "composerId": "",
        "clientId": "",
        "last_continue_idx": 0,
        "last_text_pattern": "",
        "last_continue_task": {},
        "last_continue_batch": {},
        "last_task_id": "",
        "last_batch_id": "",
        "first_seen_at": now,
        "last_updated_at": now,
    }


class _State:
    def __init__(self):
        self.lock = threading.RLock()
        self.clients: dict[str, dict[str, Any]] = {}
        self.pending: dict[str, Deque[dict[str, Any]]] = {}
        self.tasks: dict[str, dict[str, Any]] = {}
        self.stop_tasks: set[str] = set()
        self.batches: dict[str, dict[str, Any]] = {}
        self.next_idx: dict[str, int] = {}
        self.session_meta: dict[str, dict[str, Any]] = {}
        self.events: Deque[dict[str, Any]] = deque(maxlen=100)


_S = _State()


def _persist_session_meta_locked():
    path = _session_meta_persist_path()
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "session_meta": dict(_S.session_meta)}, f, ensure_ascii=False, default=str)
        os.replace(tmp, path)
    except Exception:
        pass


def _load_session_meta_from_disk():
    path = _session_meta_persist_path()
    if not path or not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        return
    if not isinstance(raw, dict):
        return
    payload = raw.get("session_meta")
    if not isinstance(payload, dict):
        return
    with _S.lock:
        for sid, entry in payload.items():
            if not isinstance(sid, str) or not isinstance(entry, dict):
                continue
            rec = _default_session_meta_record(sid)
            for k, v in entry.items():
                if k in rec and v is not None:
                    rec[k] = v
            rec["sessionId"] = sid
            _S.session_meta[sid] = rec


_load_session_meta_from_disk()


def _record_event(kind: str, client_id: str = "", detail: dict[str, Any] | None = None):
    _S.events.append({
        "ts": _now_iso(),
        "kind": kind,
        "clientId": str(client_id or "")[:120],
        "detail": detail or {},
    })


def record_protocol_event(kind: str, client_id: str = "", detail: dict[str, Any] | None = None):
    with _S.lock:
        _record_event(kind, client_id, detail)


def _format_task_text(text_pattern: str, idx: int, desired: int) -> str:
    try:
        return text_pattern.format(i=idx, n=desired)
    except (IndexError, KeyError, ValueError):
        return text_pattern.replace("{i}", str(idx)).replace("{n}", str(desired))


def _update_session_meta_locked(*, session_id: str, composer_id: str = "", client_id: str = ""):
    sid = (session_id or "").strip()
    if not sid:
        return None
    now = _now_iso()
    meta = _S.session_meta.get(sid)
    if meta is None:
        meta = _default_session_meta_record(sid)
        _S.session_meta[sid] = meta
    if composer_id:
        meta["composerId"] = str(composer_id).strip()
    if client_id:
        meta["clientId"] = str(client_id).strip()
    meta["last_updated_at"] = now
    if len(_S.session_meta) > SESSION_META_CAP:
        stale = sorted(_S.session_meta.items(), key=lambda kv: kv[1].get("last_updated_at") or "")
        for k, _ in stale[: len(_S.session_meta) - SESSION_META_CAP]:
            _S.session_meta.pop(k, None)
    _persist_session_meta_locked()
    return meta


# ─── 客户端注册 ───

def register_client(client_id: str, info: dict[str, Any] | None = None) -> dict[str, Any]:
    if not client_id:
        return {"ok": False, "error": "missing client_id"}
    info = info or {}
    now = _now_iso()
    with _S.lock:
        existing = _S.clients.get(client_id)
        record = {
            "clientId": client_id,
            "title": str(info.get("title") or "")[:200],
            "location": str(info.get("location") or "")[:500],
            "focused": bool(info.get("focused")),
            "registered_at": (existing or {}).get("registered_at") or now,
            "last_seen_at": now,
        }
        _S.clients[client_id] = record
        _S.pending.setdefault(client_id, deque())
        _record_event("register", client_id)
    return {"ok": True, "registered_at": record["registered_at"]}


def list_clients(include_stale: bool = False) -> list[dict[str, Any]]:
    cutoff = _now() - _dt.timedelta(seconds=CLIENT_STALE_SECONDS)
    out: list[dict[str, Any]] = []
    with _S.lock:
        for c in _S.clients.values():
            try:
                last = _dt.datetime.strptime(c["last_seen_at"], "%Y-%m-%dT%H:%M:%S")
            except Exception:
                last = _now()
            stale = last < cutoff
            if stale and not include_stale:
                continue
            out.append({**c, "stale": stale})
    return sorted(out, key=lambda x: x["last_seen_at"], reverse=True)


# ─── 批量任务 ───

def enqueue_batch(
    *,
    client_ids: list[str],
    text_pattern: str,
    count: int | None = None,
    retries: int = 500,
    text_index_start: int = 1,
) -> dict[str, Any]:
    if not client_ids:
        raise ValueError("没有可用的 cursor 客户端注册")
    desired = max(1, int(count or len(client_ids)))
    batch_id = "batch-" + uuid.uuid4().hex[:10]
    task_ids: list[str] = []
    grouped: dict[str, list[dict[str, Any]]] = {cid: [] for cid in client_ids}
    with _S.lock:
        effective_start = max(1, int(text_index_start or 1))
        owner_floor = int(_S.next_idx.get("default", 0) or 0)
        if owner_floor:
            effective_start = max(effective_start, owner_floor + 1)
        for offset in range(desired):
            cid = client_ids[offset % len(client_ids)]
            idx = effective_start + offset
            text = _format_task_text(text_pattern, idx, desired)
            tid = "task-" + uuid.uuid4().hex[:12]
            now = _now_iso()
            rec = {
                "id": tid, "clientId": cid, "action": "send_with_retry",
                "text": text, "batchId": batch_id, "composerId": "",
                "sessionId": "", "status": "queued", "step": "",
                "retryCount": 0, "error": "", "created_at": now, "updated_at": now,
            }
            _S.tasks[tid] = rec
            task_ids.append(tid)
            grouped.setdefault(cid, []).append({
                "id": tid, "action": "send_with_retry", "text": text,
                "batchId": batch_id, "retries": int(retries),
            })
        _S.next_idx["default"] = effective_start + desired - 1
        _S.batches[batch_id] = {
            "batchId": batch_id, "count": desired, "text_pattern": text_pattern,
            "retries": retries, "task_ids": task_ids, "text_index_start": effective_start,
            "created_at": _now_iso(),
        }
        for cid, tasks in grouped.items():
            if not tasks:
                continue
            if len(tasks) == 1:
                _S.pending.setdefault(cid, deque()).append(tasks[0])
            else:
                _S.pending.setdefault(cid, deque()).append({
                    "action": "batch", "batchId": batch_id,
                    "tasks": tasks, "retries": int(retries),
                })
    return {
        "batchId": batch_id, "task_ids": task_ids,
        "task_count": desired, "text_index_start": effective_start,
    }


def fetch_command(client_id: str) -> dict[str, Any] | None:
    if not client_id:
        return None
    now = _now_iso()
    with _S.lock:
        c = _S.clients.get(client_id)
        if c:
            c["last_seen_at"] = now
        q = _S.pending.get(client_id)
        if not q:
            return None
        return q.popleft()


def stop_all() -> int:
    affected = 0
    with _S.lock:
        for tid, t in _S.tasks.items():
            if t["status"] in {"queued", "working"}:
                _S.stop_tasks.add(tid)
                affected += 1
        for cid in list(_S.clients.keys()):
            _S.pending.setdefault(cid, deque()).append({"action": "stop"})
    return affected


def stop_task(task_id: str) -> bool:
    with _S.lock:
        if task_id not in _S.tasks:
            return False
        _S.stop_tasks.add(task_id)
        t = _S.tasks[task_id]
        if t["status"] in {"queued", "working"}:
            t["status"] = "stopped"
            t["updated_at"] = _now_iso()
        return True


def task_control(client_id: str, task_id: str) -> dict[str, Any]:
    if not task_id:
        return {"action": "wait"}
    with _S.lock:
        if task_id in _S.stop_tasks:
            return {"action": "stop"}
        if task_id not in _S.tasks:
            return {"action": "stop"}
    return {"action": "continue"}


ALLOWED_STATUS = {"queued", "working", "done", "failed", "stopped"}


def report_status(payload: dict[str, Any]) -> dict[str, Any]:
    tid = str(payload.get("id") or "")
    if not tid:
        return {"ok": False, "error": "missing id"}
    status = str(payload.get("status") or "")
    if status not in ALLOWED_STATUS:
        return {"ok": False, "error": "bad status"}
    step = str(payload.get("step") or "")
    error = str(payload.get("error") or "")
    retry_count = payload.get("retryCount")
    composer_id = str(payload.get("composerId") or "")
    client_id = str(payload.get("clientId") or "")
    session_id = str(payload.get("sessionId") or "").strip()
    now = _now_iso()
    with _S.lock:
        if client_id and client_id in _S.clients:
            _S.clients[client_id]["last_seen_at"] = now
        t = _S.tasks.get(tid)
        if t:
            t["status"] = status
            t["step"] = step
            t["error"] = error
            if isinstance(retry_count, (int, float)):
                t["retryCount"] = int(retry_count)
            if composer_id:
                t["composerId"] = composer_id
            if session_id:
                t["sessionId"] = session_id
            t["updated_at"] = now
        if session_id:
            _update_session_meta_locked(
                session_id=session_id,
                composer_id=composer_id,
                client_id=client_id,
            )
        if status in {"done", "failed", "stopped"}:
            _S.stop_tasks.discard(tid)
    return {"ok": True}


def continue_in_composer(*, session_id: str, text_pattern: str, retries: int = 500) -> dict[str, Any]:
    sid = str(session_id or "").strip()
    if not sid:
        raise ValueError("缺少会话 ID")
    pattern = str(text_pattern or "").strip() or DEFAULT_CONTINUE_TEXT_PATTERN
    with _S.lock:
        meta = _S.session_meta.get(sid)
        if not meta:
            raise LookupError("COMPOSER_NOT_REPORTED")
        composer_id = str(meta.get("composerId") or "").strip()
        if not composer_id:
            raise LookupError("COMPOSER_NOT_REPORTED")
        cutoff = _now() - _dt.timedelta(seconds=CLIENT_STALE_SECONDS)
        online_ids = []
        for cid, c in _S.clients.items():
            try:
                last = _dt.datetime.strptime(c["last_seen_at"], "%Y-%m-%dT%H:%M:%S")
            except Exception:
                last = _now()
            if last >= cutoff:
                online_ids.append(cid)
        if not online_ids:
            raise RuntimeError("暂未发现可用的 Cursor 窗口")
        preferred = str(meta.get("clientId") or "")
        client_id = preferred if preferred in online_ids else online_ids[0]
        text = _format_task_text(pattern, 0, 1)
        tid = "task-" + uuid.uuid4().hex[:12]
        batch_id = "batch-" + uuid.uuid4().hex[:10]
        now = _now_iso()
        task = {
            "id": tid, "clientId": client_id, "action": "send_with_retry",
            "text": text, "batchId": batch_id, "composerId": composer_id,
            "sessionId": sid, "status": "queued", "step": "",
            "retryCount": 0, "error": "", "created_at": now, "updated_at": now,
        }
        _S.tasks[tid] = task
        _S.batches[batch_id] = {
            "batchId": batch_id, "count": 1, "text_pattern": pattern,
            "retries": int(retries), "task_ids": [tid], "created_at": now,
            "kind": "continue_in_composer",
        }
        command = {
            "id": tid, "action": "send_with_retry", "text": text,
            "batchId": batch_id, "retries": int(retries), "composerId": composer_id,
        }
        _S.pending.setdefault(client_id, deque()).append(command)
        meta["last_text_pattern"] = pattern
        meta["last_task_id"] = tid
        meta["last_batch_id"] = batch_id
        meta["last_updated_at"] = now
        _persist_session_meta_locked()
    return {
        "batchId": batch_id, "task": dict(task),
        "client_id": client_id, "session_id": sid, "composer_id": composer_id,
    }


# ─── GUI 视图 ───

def list_tasks(batch_id: str = "") -> list[dict[str, Any]]:
    with _S.lock:
        out = []
        for t in _S.tasks.values():
            if batch_id and t.get("batchId") != batch_id:
                continue
            out.append(dict(t))
    out.sort(key=lambda x: x["created_at"], reverse=True)
    return out


def list_batches() -> list[dict[str, Any]]:
    with _S.lock:
        out = []
        for b in _S.batches.values():
            tids = b.get("task_ids", [])
            tasks = [_S.tasks[tid] for tid in tids if tid in _S.tasks]
            agg = {"queued": 0, "working": 0, "done": 0, "failed": 0, "stopped": 0}
            for t in tasks:
                agg[t["status"]] = agg.get(t["status"], 0) + 1
            out.append({**b, "tasks_summary": agg, "tasks": [dict(t) for t in tasks]})
    out.sort(key=lambda x: x["created_at"], reverse=True)
    return out


def list_session_metas() -> list[dict[str, Any]]:
    with _S.lock:
        return sorted(_S.session_meta.values(), key=lambda x: x.get("last_updated_at") or "", reverse=True)


def gui_overview() -> dict[str, Any]:
    return {
        "clients": list_clients(),
        "batches": list_batches()[:20],
        "recent_tasks": list_tasks()[:50],
    }


def reset_all() -> int:
    cleared = 0
    with _S.lock:
        cleared = len(_S.tasks)
        _S.tasks.clear()
        _S.batches.clear()
        _S.stop_tasks.clear()
        for cid in list(_S.pending.keys()):
            _S.pending[cid].clear()
        _S.next_idx.clear()
    return cleared


def diagnostics() -> dict[str, Any]:
    with _S.lock:
        events = list(_S.events)[-50:]
    return {
        "now": _now_iso(),
        "overview": gui_overview(),
        "recent_events": events,
    }
