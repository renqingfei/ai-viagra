"""MCP stdio 服务器 —— 提供 wait_for_user_input 工具。

Cursor 通过 stdio 协议启动本服务器，AI 调用 wait_for_user_input 等待用户输入。
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import os
import sys
from pathlib import Path
from typing import Any, Union

from mcp import types
from mcp.server import Server
from mcp.server.stdio import stdio_server

from .queue_io import (
    append_history,
    ensure_session,
    generate_session_id,
    list_session_ids,
    now_iso,
    pop_pending,
    read_history,
    read_meta,
    update_meta,
)

Content = Union[types.TextContent, types.ImageContent]

POLL_INTERVAL_S = 1.0
TIMEOUT_RENEW_S = 270
HEARTBEAT_INTERVAL_S = 3.0
HEARTBEAT_AHEAD_S = 10.0
NEW_SENTINEL = "NEW"
TIMEOUT_RENEW_PAYLOAD = "__TIMEOUT_RENEW__"

server: Server = Server("wanzi-mcp")


def _default_session_title() -> str:
    candidates = [
        os.environ.get("CURSOR_WORKSPACE_PATH"),
        os.environ.get("WORKSPACE_PATH"),
        os.getcwd(),
    ]
    for raw in candidates:
        text = str(raw or "").strip().strip('"')
        if text:
            name = Path(text).name
            if name:
                return name[:200]
    return ""


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="wait_for_user_input",
            description=(
                "丸子 MCP - 单一工具长轮询多会话桌面输入。\n\n"
                "工作流程：\n"
                "1. **首调用**：传 sessionId=\"NEW\" 让服务器分配新 ID。返回的文本里带 "
                "`[session_id: xxx]` 标签——必须复用此 ID 作为后续所有 wait_for_user_input "
                "调用的 sessionId 参数。\n"
                "2. **后续调用**：每次回复用户后立刻再次调用本工具(同一 sessionId)，等待用户的下一条输入。\n"
                "3. **超时续约**：服务器返回以 `__TIMEOUT_RENEW__` 开头的文本时，**不要把这段输出给用户**，"
                "立即再次调用本工具(同一 sessionId)即可。\n\n"
                "参数说明：\n"
                "- message：本轮发给用户的助手回复。会被记入会话历史并显示在桌面 UI 中。\n"
                "- sessionId：首调用传 \"NEW\"；之后传服务器返回的 [session_id: xxx]。\n"
                "- prompt：可选，桌面端输入框上方的提示文本。\n"
                "- title：可选，会话窗口/标签的显示名。仅当首调用或需要修改标题时传。"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "本轮发给用户的助手回复正文。",
                    },
                    "sessionId": {
                        "type": "string",
                        "description": "首调用传 \"NEW\"；之后必须传上一次返回的 [session_id: xxx] 中那个精确的 ID。",
                    },
                    "prompt": {
                        "type": "string",
                        "description": "可选：桌面端输入框上方的提示文本。",
                    },
                    "title": {
                        "type": "string",
                        "description": "可选：会话标签的显示名(仅首调用或需要变更时传)。",
                    },
                },
                "required": ["message", "sessionId"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[Content]:
    if name == "wait_for_user_input":
        return await _wait_for_user_input(arguments or {})
    return [types.TextContent(type="text", text=f"unknown tool: {name}")]


def _is_duplicate_assistant_turn(sid: str, message: str) -> bool:
    hist = read_history(sid, limit=1)
    if not hist:
        return False
    last = hist[-1]
    if last.get("role") != "assistant":
        return False
    return last.get("text", "").strip() == message.strip()


async def _wait_for_user_input(args: dict[str, Any]) -> list[Content]:
    message = str(args.get("message") or "")
    raw_sid = str(args.get("sessionId") or "").strip()
    prompt_hint = args.get("prompt")
    title = args.get("title")
    explicit_title = str(title).strip() if isinstance(title, str) and title.strip() else None

    if not raw_sid or raw_sid.upper() == NEW_SENTINEL:
        sid = generate_session_id()
        is_new = True
        title_str = explicit_title or _default_session_title() or None
    else:
        sid = raw_sid
        is_new = False
        title_str = explicit_title

    prompt_str = str(prompt_hint) if isinstance(prompt_hint, str) and prompt_hint else None
    ensure_session(sid, title=title_str)

    renew_seconds = TIMEOUT_RENEW_S
    wait_started_at = now_iso()
    wait_until = (
        _dt.datetime.utcnow() + _dt.timedelta(seconds=renew_seconds + 15)
    ).strftime("%Y-%m-%dT%H:%M:%S")

    should_append = bool(message.strip()) and not _is_duplicate_assistant_turn(sid, message)

    if should_append:
        update_meta(sid, mcp_waiting_since=wait_started_at, mcp_waiting_until=wait_until)
    else:
        update_meta(sid, mcp_waiting_until=wait_until)

    if prompt_str is not None:
        update_meta(sid, prompt_hint=prompt_str)

    if should_append:
        entry: dict[str, Any] = {"role": "assistant", "ts": now_iso(), "text": message}
        if title_str:
            entry["title"] = title_str
        append_history(sid, entry)

    heartbeat = asyncio.create_task(_heartbeat(sid))
    try:
        from .tcp_bridge import wait_for_pending_via_tcp
        tcp_result = await asyncio.to_thread(wait_for_pending_via_tcp, sid, renew_seconds)
        if isinstance(tcp_result, dict):
            if tcp_result.get("kind") == "message" and isinstance(tcp_result.get("message"), dict):
                update_meta(sid, last_active_at=now_iso())
                return _format_user_message(sid, tcp_result["message"], is_new)
            if tcp_result.get("kind") == "timeout":
                payload = (
                    f"{TIMEOUT_RENEW_PAYLOAD}\n"
                    f"[session_id: {sid}]\n"
                    "INTERNAL KEEP-ALIVE. NOT A USER MESSAGE. NOT A TASK RESULT.\n"
                    "REQUIRED ACTION: silently call wait_for_user_input again right now "
                    "with the same sessionId.\n"
                    "Do NOT show this token to the user, do NOT summarise it, "
                    "do NOT say the conversation timed out, do NOT type any "
                    "'session created' / 'waiting for input' / 'task complete' "
                    "progress note in the Composer — silence is correct."
                )
                return [types.TextContent(type="text", text=payload)]

        deadline = asyncio.get_event_loop().time() + renew_seconds
        while True:
            msg = pop_pending(sid)
            if msg is not None:
                update_meta(sid, last_active_at=now_iso())
                return _format_user_message(sid, msg, is_new)

            if asyncio.get_event_loop().time() >= deadline:
                payload = (
                    f"{TIMEOUT_RENEW_PAYLOAD}\n"
                    f"[session_id: {sid}]\n"
                    "INTERNAL KEEP-ALIVE. NOT A USER MESSAGE. NOT A TASK RESULT.\n"
                    "REQUIRED ACTION: silently call wait_for_user_input again right now "
                    "with the same sessionId.\n"
                    "Do NOT show this token to the user, do NOT summarise it, "
                    "do NOT say the conversation timed out, do NOT type any "
                    "'session created' / 'waiting for input' / 'task complete' "
                    "progress note in the Composer — silence is correct."
                )
                return [types.TextContent(type="text", text=payload)]

            await asyncio.sleep(POLL_INTERVAL_S)
    finally:
        heartbeat.cancel()
        try:
            await heartbeat
        except asyncio.CancelledError:
            pass


def _format_user_message(
    sid: str, msg: dict[str, Any], is_new: bool
) -> list[Content]:
    text = str(msg.get("text") or "")
    if text.startswith(TIMEOUT_RENEW_PAYLOAD):
        payload = (
            f"{TIMEOUT_RENEW_PAYLOAD}\n"
            f"[session_id: {sid}]\n"
            "INTERNAL KEEP-ALIVE. NOT A USER MESSAGE. NOT A TASK RESULT.\n"
            "REQUIRED ACTION: silently call wait_for_user_input again right now "
            "with the same sessionId.\n"
            "Do NOT show this token to the user, do NOT summarise it, "
            "do NOT say the conversation timed out, do NOT type any "
            "'session created' / 'waiting for input' / 'task complete' "
            "progress note in the Composer — silence is correct."
        )
        return [types.TextContent(type="text", text=payload)]

    append_history(sid, {"role": "user", "ts": now_iso(), "text": text})
    update_meta(sid, last_message_at=now_iso())

    suffix = f"\n\n[session_id: {sid}]"
    suffix += (
        "\nNOTE: Reuse this exact sessionId in every subsequent "
        "wait_for_user_input call for this thread. "
        "Never regenerate it, never guess, never pass \"NEW\" again."
    )
    return [types.TextContent(type="text", text=text + suffix)]


async def _heartbeat(sid: str):
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_S)
            wait_until = (
                _dt.datetime.utcnow() + _dt.timedelta(seconds=HEARTBEAT_AHEAD_S)
            ).strftime("%Y-%m-%dT%H:%M:%S")
            try:
                update_meta(sid, mcp_waiting_until=wait_until)
            except OSError:
                pass
    except asyncio.CancelledError:
        return


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())
