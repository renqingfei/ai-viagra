"""Cursor 一键注入 —— 检测路径、写入 mcp.json + rule、启动 Cursor。"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime

MCP_KEY = "wanzi-mcp"
RULE_FILE = "wanzi-mcp.mdc"

RULE_CONTENT = """\
---
description: 丸子 MCP 强制持续对话循环
globs:
alwaysApply: true
---

# 丸子 MCP 持续对话规则

你有一个名为 `wait_for_user_input` 的工具。
每次完成用户的请求后，必须立即调用 `wait_for_user_input` 等待用户下一条输入。
绝不在完成任务后停止对话。
"""


def _cursor_base_dir() -> str:
    return os.path.join(os.path.expanduser("~"), ".cursor")


def ensure_dirs() -> dict[str, str]:
    base = _cursor_base_dir()
    rules = os.path.join(base, "rules")
    os.makedirs(base, exist_ok=True)
    if os.path.islink(rules):
        try:
            os.unlink(rules)
        except OSError:
            pass
    elif os.path.exists(rules) and not os.path.isdir(rules):
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        try:
            os.replace(rules, f"{rules}.bak-{ts}")
        except OSError:
            pass
    os.makedirs(rules, exist_ok=True)
    return {"base": base, "rules": rules}


# ─── Cursor 路径检测 ───

def _windows_check_output(command: list[str], timeout: float = 2.0) -> str:
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.check_output(
        command, text=True, stderr=subprocess.DEVNULL,
        timeout=timeout, creationflags=creationflags,
    )


def _detect_cursor_exe() -> str:
    """自动检测 Cursor 可执行文件路径。"""
    if sys.platform == "win32":
        try:
            out = _windows_check_output([
                "powershell", "-NoProfile", "-Command",
                "Get-Process -Name Cursor -ErrorAction SilentlyContinue | "
                "Select-Object -ExpandProperty Path -First 1",
            ])
            path = out.strip().strip('"')
            if path and os.path.exists(path):
                return path
        except Exception:
            pass

        local = os.environ.get("LOCALAPPDATA", "")
        candidates = [
            os.path.join(local, "Programs", "cursor", "Cursor.exe"),
            os.path.join(local, "Programs", "Cursor", "Cursor.exe"),
            os.path.join(os.environ.get("PROGRAMFILES", ""), "Cursor", "Cursor.exe"),
        ]
        try:
            out = _windows_check_output([
                "powershell", "-NoProfile", "-Command",
                "(Get-ItemProperty 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' "
                "-ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*Cursor*' } | "
                "Select-Object -ExpandProperty InstallLocation -First 1)",
            ])
            reg_path = out.strip().strip('"')
            if reg_path:
                candidates.insert(0, os.path.join(reg_path, "Cursor.exe"))
        except Exception:
            pass

        for c in candidates:
            if c and os.path.exists(c):
                return c

    elif sys.platform == "darwin":
        app = "/Applications/Cursor.app"
        if os.path.exists(app):
            return app

    else:
        for p in ["/usr/bin/cursor", "/usr/local/bin/cursor",
                  os.path.expanduser("~/.local/bin/cursor")]:
            if os.path.exists(p):
                return p

    return ""


def _launch_cursor(exe_path: str) -> bool:
    """启动 Cursor。"""
    try:
        if sys.platform == "win32":
            subprocess.Popen(
                [exe_path],
                creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS,
                close_fds=True,
            )
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-a", exe_path])
        else:
            subprocess.Popen([exe_path], start_new_session=True)
        return True
    except Exception:
        return False


# ─── MCP 入口构建 ───

def _build_mcp_entry() -> dict:
    py = sys.executable or "python"
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return {
        "command": py,
        "args": ["-m", "services.mcp_bridge"],
        "env": {"PYTHONPATH": project_root},
    }


# ─── 注入主入口 ───

def inject_all() -> dict:
    """一键注入：检测 Cursor → 写入 mcp.json + rule → 启动 Cursor。"""
    cursor_exe = _detect_cursor_exe()

    try:
        paths = ensure_dirs()
    except Exception as e:
        return {"ok": False, "error": f"创建目录失败：{e}"}

    mcp_path = os.path.join(paths["base"], "mcp.json")
    existing: dict = {}
    if os.path.exists(mcp_path):
        try:
            with open(mcp_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
            if content:
                parsed = json.loads(content)
                if isinstance(parsed, dict):
                    existing = parsed
        except Exception as e:
            return {"ok": False, "error": f"解析 mcp.json 失败：{e}"}

    servers = existing.get("mcpServers")
    if not isinstance(servers, dict):
        servers = {}

    entry = _build_mcp_entry()
    servers[MCP_KEY] = entry
    existing["mcpServers"] = servers

    if os.path.exists(mcp_path):
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = mcp_path + f".bak-{ts}"
        try:
            with open(mcp_path, "r", encoding="utf-8") as f:
                with open(backup, "w", encoding="utf-8") as bf:
                    bf.write(f.read())
        except Exception:
            pass

    try:
        with open(mcp_path, "w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)
    except Exception as e:
        return {"ok": False, "error": f"写入 mcp.json 失败：{e}"}

    rule_path = os.path.join(paths["rules"], RULE_FILE)
    rule_ok = False
    try:
        with open(rule_path, "w", encoding="utf-8") as f:
            f.write(RULE_CONTENT)
        rule_ok = True
    except Exception:
        pass

    launched = False
    if cursor_exe:
        launched = _launch_cursor(cursor_exe)

    preserved = sorted(k for k in servers.keys() if k != MCP_KEY)
    return {
        "ok": True,
        "mcp_json_path": mcp_path,
        "rule_path": rule_path if rule_ok else "",
        "rule_written": rule_ok,
        "preserved_servers": preserved,
        "cursor_exe": cursor_exe,
        "cursor_launched": launched,
        "entry": entry,
    }


def check_status() -> dict:
    """检查当前注入状态和 Cursor 可用性。"""
    base = _cursor_base_dir()
    mcp_path = os.path.join(base, "mcp.json")
    rule_path = os.path.join(base, "rules", RULE_FILE)

    mcp_exists = False
    mcp_has_entry = False
    if os.path.exists(mcp_path):
        mcp_exists = True
        try:
            with open(mcp_path, "r", encoding="utf-8") as f:
                data = json.loads(f.read())
            servers = data.get("mcpServers", {})
            mcp_has_entry = MCP_KEY in servers
        except Exception:
            pass

    cursor_exe = _detect_cursor_exe()
    return {
        "mcp_json_exists": mcp_exists,
        "mcp_has_entry": mcp_has_entry,
        "rule_exists": os.path.exists(rule_path),
        "cursor_found": bool(cursor_exe),
        "cursor_exe": cursor_exe,
    }
