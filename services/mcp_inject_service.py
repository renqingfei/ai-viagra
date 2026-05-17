"""哑脚本注入 service —— 把自动卡脚本注入 Cursor workbench.html。

注入后，Cursor 内部会运行一段 JS 脚本：
- HTTP 轮询 /auto-chat/cmd 拉取指令
- 收到 send_with_retry → 新建 agent + 输入文本 + 发送
- 自动处理账单弹窗重试
"""
from __future__ import annotations

import json
import os
import shutil
from datetime import datetime
from typing import Any

from services import cursor_setup_service
from config import SERVER_PORT, LOCAL_API_SECRET

WORKBENCH_REL_CANDIDATES = (
    os.path.join("resources", "app", "out", "vs", "code", "electron-sandbox", "workbench"),
    os.path.join("resources", "app", "out", "vs", "code", "electron-browser", "workbench"),
)

HOOK_MARK_BEGIN = "<!-- WANZI_MCP_HOOK_BEGIN -->"
HOOK_MARK_END = "<!-- WANZI_MCP_HOOK_END -->"


def _find_workbench_dir(cursor_root: str) -> str:
    if not cursor_root:
        return ""
    for rel in WORKBENCH_REL_CANDIDATES:
        candidate = os.path.join(cursor_root, rel)
        if os.path.isdir(candidate) and os.path.exists(os.path.join(candidate, "workbench.html")):
            return candidate
    return ""


def _detect_workbench_dir() -> str:
    exe = cursor_setup_service._detect_cursor_exe()
    if not exe:
        return ""
    cursor_root = os.path.dirname(exe)
    d = _find_workbench_dir(cursor_root)
    if d:
        return d
    parent = os.path.dirname(cursor_root)
    d = _find_workbench_dir(parent)
    if d:
        return d
    import sys
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA", "")
        candidates = [
            os.path.join(local, "Programs", "cursor"),
            os.path.join(local, "Programs", "Cursor"),
        ]
        for c in candidates:
            d = _find_workbench_dir(c)
            if d:
                return d
    return ""


def _backup_root() -> str:
    return os.path.join(os.path.expanduser("~"), ".wanzi-mcp", "backup")


def _build_hook_script() -> str:
    server_url = f"http://127.0.0.1:{SERVER_PORT}"
    return (
        f"window.__WANZI_MCP_BASE__={json.dumps(server_url)};\n"
        f"window.__WANZI_MCP_SECRET__={json.dumps(LOCAL_API_SECRET)};\n"
        + _HOOK_JS
    )


def _strip_hook_block(html: str) -> str:
    while HOOK_MARK_BEGIN in html and HOOK_MARK_END in html:
        start = html.find(HOOK_MARK_BEGIN)
        end = html.find(HOOK_MARK_END, start)
        if end < 0:
            break
        end += len(HOOK_MARK_END)
        html = html[:start].rstrip() + "\n" + html[end:].lstrip()
    return html


def _inject_into_html(html: str, hook_js: str) -> str:
    html = _strip_hook_block(html)
    block = f"\n{HOOK_MARK_BEGIN}\n<script>\n{hook_js}\n</script>\n{HOOK_MARK_END}\n"
    insert_before = "</body>"
    idx = html.lower().rfind(insert_before.lower())
    if idx >= 0:
        html = html[:idx] + block + html[idx:]
    else:
        html += block
    return html


def is_hook_injected() -> bool:
    wd = _detect_workbench_dir()
    if not wd:
        return False
    wb = os.path.join(wd, "workbench.html")
    if not os.path.exists(wb):
        return False
    try:
        with open(wb, "r", encoding="utf-8") as f:
            return HOOK_MARK_BEGIN in f.read()
    except Exception:
        return False


def patch_status() -> dict[str, Any]:
    wd = _detect_workbench_dir()
    return {
        "workbench_dir": wd,
        "workbench_found": bool(wd),
        "hook_injected": is_hook_injected(),
    }


def inject_hook() -> dict[str, Any]:
    wd = _detect_workbench_dir()
    if not wd:
        return {"ok": False, "error": "未找到 Cursor workbench 目录，请确认 Cursor 已安装"}

    wb_path = os.path.join(wd, "workbench.html")
    if not os.path.exists(wb_path):
        return {"ok": False, "error": "workbench.html 不存在"}

    try:
        with open(wb_path, "r", encoding="utf-8") as f:
            original = f.read()
    except Exception as e:
        return {"ok": False, "error": f"读取失败：{e}"}

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = os.path.join(_backup_root(), f"hook_{ts}")
    os.makedirs(backup_dir, exist_ok=True)
    try:
        with open(os.path.join(backup_dir, "workbench.html"), "w", encoding="utf-8") as f:
            f.write(original)
    except Exception:
        pass

    hook_js = _build_hook_script()
    patched = _inject_into_html(original, hook_js)

    try:
        with open(wb_path, "w", encoding="utf-8") as f:
            f.write(patched)
    except Exception as e:
        return {"ok": False, "error": f"写入失败：{e}"}

    return {
        "ok": True,
        "workbench_dir": wd,
        "backup_dir": backup_dir,
    }


def restore_hook() -> dict[str, Any]:
    wd = _detect_workbench_dir()
    if not wd:
        return {"ok": False, "error": "未找到 Cursor workbench 目录"}
    wb_path = os.path.join(wd, "workbench.html")
    if not os.path.exists(wb_path):
        return {"ok": False, "error": "workbench.html 不存在"}
    try:
        with open(wb_path, "r", encoding="utf-8") as f:
            html = f.read()
        html = _strip_hook_block(html)
        with open(wb_path, "w", encoding="utf-8") as f:
            f.write(html)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


_HOOK_JS = r"""
(function(){
  if (window.__wanziMcpCleanup) { try { window.__wanziMcpCleanup(); } catch(_){} }

  var BASE = String(window.__WANZI_MCP_BASE__ || "http://127.0.0.1:17777");
  var SECRET = String(window.__WANZI_MCP_SECRET__ || "");
  var POLL_MS = 600;
  var REGISTER_MS = 3000;
  var CLIENT_KEY = "__wanziMcpClientId";

  function getClientId(){
    try {
      var v = sessionStorage.getItem(CLIENT_KEY);
      if (v) return v;
      v = "cursor-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,10);
      sessionStorage.setItem(CLIENT_KEY, v);
      return v;
    } catch(_){ return "cursor-" + Math.random().toString(36).slice(2,10); }
  }
  var CLIENT_ID = getClientId();
  var stopped = false;

  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  function withSecret(path){
    if (!SECRET) return path;
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + "local_api_secret=" + encodeURIComponent(SECRET);
  }

  function request(method, path, payload){
    return new Promise(function(resolve){
      try {
        var x = new XMLHttpRequest();
        x.open(method, BASE + withSecret(path), true);
        if (method === "POST") x.setRequestHeader("Content-Type", "application/json");
        x.timeout = 3000;
        x.onload = function(){
          try { resolve(JSON.parse(x.responseText)); } catch(_){ resolve(null); }
        };
        x.onerror = function(){ resolve(null); };
        x.ontimeout = function(){ resolve(null); };
        x.send(method === "POST" ? JSON.stringify(payload || {}) : null);
      } catch(_){ resolve(null); }
    });
  }

  function registerClient(){
    return request("GET", "/api/auto-chat/register?clientId=" + encodeURIComponent(CLIENT_ID)
      + "&title=" + encodeURIComponent(document.title || "")
      + "&location=" + encodeURIComponent(String(window.location && window.location.href || ""))
      + "&focused=" + (document.hasFocus() ? "true" : "false"));
  }

  function reportStatus(taskId, status, step, error, retryCount, composerId){
    return request("POST", "/api/auto-chat/status", {
      clientId: CLIENT_ID, id: taskId, status: status,
      step: step || "", error: error || "",
      retryCount: typeof retryCount === "number" ? retryCount : 0,
      composerId: composerId || "",
    });
  }

  function fetchCommand(){
    return request("GET", "/api/auto-chat/cmd?clientId=" + encodeURIComponent(CLIENT_ID));
  }

  function fetchTaskControl(taskId){
    return request("GET", "/api/auto-chat/task-control?clientId=" + encodeURIComponent(CLIENT_ID)
      + "&taskId=" + encodeURIComponent(taskId));
  }

  /* ─── Composer 操作 ─── */
  function findComposerService(){
    try {
      if (globalThis.cursorComposerService) return globalThis.cursorComposerService;
      var codeWindow = globalThis.workbench && globalThis.workbench.codeWindow;
      if (codeWindow && codeWindow.composerService) return codeWindow.composerService;
    } catch(_){}
    return null;
  }

  async function createComposerAndSubmit(text, composerId){
    var svc = findComposerService();
    if (!svc) {
      /* 降级：模拟键盘 Ctrl+I 打开 Composer */
      try {
        document.dispatchEvent(new KeyboardEvent("keydown", {key:"i", ctrlKey:true, bubbles:true}));
        await sleep(800);
      } catch(_){}
    }
    /* 尝试通过 composerBridge 提交 */
    try {
      if (svc && composerId){
        await svc.submitByComposerId(composerId, text);
        return composerId;
      }
      if (svc && svc.createNew){
        var handle = await svc.createNew();
        if (handle && handle.composerId){
          await svc.submitByComposerId(handle.composerId, text);
          return handle.composerId;
        }
      }
    } catch(_){}

    /* 最后降级：直接操作 textarea + 发送按钮 */
    try {
      var ta = document.querySelector('textarea[data-placeholder], .composer-input textarea, textarea');
      if (ta){
        ta.value = text;
        ta.dispatchEvent(new Event("input", {bubbles:true}));
        await sleep(200);
        var btn = document.querySelector('[data-testid="submit-button"], .composer-send-btn, button[aria-label*="Send"]');
        if (btn) btn.click();
      }
    } catch(_){}
    return "";
  }

  /* ─── 弹窗处理 ─── */
  var BILLING_KW = ["usage","billing","credits","limit","subscription","upgrade","余额","用量","额度","订阅","升级","计费"];

  function findPopup(){ return document.querySelector(".composer-warning-popup"); }
  function isBilling(p){
    var t = String((p && p.textContent) || "").toLowerCase();
    for (var i=0;i<BILLING_KW.length;i++) if (t.indexOf(BILLING_KW[i]) >= 0) return true;
    return false;
  }

  async function waitPopupGone(ms){
    var end = Date.now() + ms;
    while (Date.now() < end){
      if (!findPopup()) return true;
      await sleep(100);
    }
    return false;
  }

  /* ─── 任务执行 ─── */
  async function launchSendWithRetry(cmd){
    var text = cmd.text || "";
    var taskId = cmd.id || "";
    var retries = cmd.retries || 500;
    var composerId = cmd.composerId || "";

    reportStatus(taskId, "working", "starting", "", 0, composerId);

    for (var attempt = 0; attempt < retries; attempt++){
      if (stopped) break;

      var ctrl = await fetchTaskControl(taskId);
      if (ctrl && ctrl.action === "stop"){
        reportStatus(taskId, "stopped", "user_stop", "", attempt, composerId);
        return;
      }

      reportStatus(taskId, "working", "submitting", "", attempt, composerId);
      var cid = await createComposerAndSubmit(text, composerId);
      if (cid) composerId = cid;

      await sleep(2000);

      var popup = findPopup();
      if (popup){
        if (isBilling(popup)){
          reportStatus(taskId, "working", "billing_retry", "", attempt, composerId);
          /* 点击弹窗关闭/重试按钮 */
          try {
            var btns = popup.querySelectorAll("button");
            for (var b=0;b<btns.length;b++){
              var txt = String(btns[b].textContent || "").toLowerCase();
              if (txt.indexOf("retry") >= 0 || txt.indexOf("重试") >= 0 || txt.indexOf("try again") >= 0){
                btns[b].click(); break;
              }
            }
          } catch(_){}
          await sleep(1500);
          continue;
        }
      }

      /* 等待确认成功（无弹窗持续一段时间） */
      var stable = true;
      for (var w=0; w<5; w++){
        await sleep(500);
        if (findPopup()){ stable = false; break; }
      }
      if (stable){
        reportStatus(taskId, "done", "success", "", attempt, composerId);
        return;
      }
    }
    reportStatus(taskId, "failed", "max_retries", "达到最大重试次数", retries, composerId);
  }

  async function handleBatch(cmd){
    var tasks = cmd.tasks || [];
    for (var i=0; i<tasks.length; i++){
      if (stopped) break;
      await launchSendWithRetry(tasks[i]);
    }
  }

  /* ─── 主循环 ─── */
  async function mainLoop(){
    while (!stopped){
      try {
        await registerClient();
      } catch(_){}
      await sleep(REGISTER_MS);

      while (!stopped){
        var cmd = await fetchCommand();
        if (!cmd || cmd.action === "wait"){
          await sleep(POLL_MS);
          continue;
        }
        if (cmd.action === "stop"){
          stopped = true;
          break;
        }
        if (cmd.action === "send_with_retry"){
          await launchSendWithRetry(cmd);
        } else if (cmd.action === "batch"){
          await handleBatch(cmd);
        }
        await sleep(200);
      }
    }
  }

  window.__wanziMcpCleanup = function(){ stopped = true; };
  mainLoop();
})();
"""
