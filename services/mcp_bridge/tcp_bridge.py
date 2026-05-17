"""TCP Bridge —— GUI 进程和 stdio MCP 进程之间的快速消息通道。

GUI 端启动一个 TCP server（127.0.0.1 随机端口），端口号写入
~/.wanzi-mcp/bridge_port。stdio MCP 进程连接后发送 wait 请求，
GUI 收到用户输入后立即通过 TCP 推送，比文件轮询快得多。
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
from typing import Any

BRIDGE_PORT_FILE = pathlib.Path.home() / ".wanzi-mcp" / "bridge_port"

_server: asyncio.Server | None = None
_port: int = 0
_waiters: dict[str, asyncio.Future] = {}
_lock = asyncio.Lock()


async def start_server() -> int:
    global _server, _port

    async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                try:
                    req = json.loads(line.decode("utf-8").strip())
                except Exception:
                    continue
                resp = await _dispatch(req)
                writer.write((json.dumps(resp, ensure_ascii=False) + "\n").encode("utf-8"))
                await writer.drain()
        except (asyncio.CancelledError, ConnectionResetError):
            pass
        finally:
            writer.close()

    _server = await asyncio.start_server(handle_client, "127.0.0.1", 0)
    _port = _server.sockets[0].getsockname()[1]

    BRIDGE_PORT_FILE.parent.mkdir(parents=True, exist_ok=True)
    BRIDGE_PORT_FILE.write_text(str(_port))
    return _port


async def stop_server():
    global _server
    if _server:
        _server.close()
        await _server.wait_closed()
        _server = None
    if BRIDGE_PORT_FILE.exists():
        try:
            os.remove(BRIDGE_PORT_FILE)
        except Exception:
            pass


async def _dispatch(req: dict[str, Any]) -> dict[str, Any]:
    action = req.get("action", "")
    sid = str(req.get("session_id", ""))

    if action == "wait_pending":
        timeout = float(req.get("timeout", 270))
        return await _wait_pending(sid, timeout)

    if action == "notify":
        await _notify(sid, req.get("message", {}))
        return {"ok": True}

    return {"error": "unknown action"}


async def _wait_pending(sid: str, timeout: float) -> dict[str, Any]:
    async with _lock:
        if sid in _waiters and not _waiters[sid].done():
            _waiters[sid].cancel()
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        _waiters[sid] = fut

    try:
        result = await asyncio.wait_for(fut, timeout=timeout)
        return {"kind": "message", "message": result}
    except asyncio.TimeoutError:
        return {"kind": "timeout"}
    except asyncio.CancelledError:
        return {"kind": "timeout"}
    finally:
        async with _lock:
            if _waiters.get(sid) is fut:
                _waiters.pop(sid, None)


async def _notify(sid: str, message: dict):
    async with _lock:
        fut = _waiters.get(sid)
        if fut and not fut.done():
            fut.set_result(message)


async def notify_session(sid: str, message: dict):
    """GUI 端调用：通知等待中的 stdio 进程有新消息。"""
    await _notify(sid, message)


def wait_for_pending_via_tcp(sid: str, timeout: float) -> dict[str, Any] | None:
    """stdio MCP 进程端调用：连接 TCP bridge 等待消息（同步阻塞）。"""
    if not BRIDGE_PORT_FILE.exists():
        return None
    try:
        port = int(BRIDGE_PORT_FILE.read_text().strip())
    except Exception:
        return None

    import socket
    try:
        sock = socket.create_connection(("127.0.0.1", port), timeout=5)
        sock.settimeout(timeout + 10)
        req = json.dumps({"action": "wait_pending", "session_id": sid, "timeout": timeout}) + "\n"
        sock.sendall(req.encode("utf-8"))
        data = b""
        while b"\n" not in data:
            chunk = sock.recv(4096)
            if not chunk:
                break
            data += chunk
        sock.close()
        if data:
            return json.loads(data.decode("utf-8").strip())
    except Exception:
        pass
    return None
