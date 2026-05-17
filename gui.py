"""GUI 桌面壳 —— pywebview 嵌入 FastAPI 网页。"""
import sys
import os
import time
import subprocess
import threading
import requests
import uvicorn
import webview
import ctypes

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import SERVER_HOST, SERVER_PORT

URL = f"http://{SERVER_HOST}:{SERVER_PORT}"


def _kill_port_occupants(port):
    if sys.platform != "win32":
        return
    try:
        result = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True, text=True, creationflags=0x08000000,
        )
        pids = set()
        for line in result.stdout.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                parts = line.split()
                if parts:
                    pid = parts[-1]
                    if pid.isdigit() and int(pid) != os.getpid():
                        pids.add(pid)
        for pid in pids:
            subprocess.run(
                ["taskkill", "/F", "/PID", pid],
                capture_output=True, creationflags=0x08000000,
            )
        if pids:
            time.sleep(0.5)
    except Exception:
        pass


def _start_server():
    uvicorn.run("main:app", host=SERVER_HOST, port=SERVER_PORT, log_level="info")


def _wait_for_server(timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = requests.get(f"{URL}/api/health", timeout=1)
            if r.status_code < 500:
                return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


def _flash_taskbar(hwnd, count=3):
    if sys.platform != "win32" or not hwnd:
        return
    try:
        class FLASHWINFO(ctypes.Structure):
            _fields_ = [
                ("cbSize", ctypes.c_uint),
                ("hwnd", ctypes.c_void_p),
                ("dwFlags", ctypes.c_uint),
                ("uCount", ctypes.c_uint),
                ("dwTimeout", ctypes.c_uint),
            ]
        fwi = FLASHWINFO()
        fwi.cbSize = ctypes.sizeof(FLASHWINFO)
        fwi.hwnd = hwnd
        fwi.dwFlags = 0x03 | 0x0C
        fwi.uCount = count
        fwi.dwTimeout = 0
        ctypes.windll.user32.FlashWindowEx(ctypes.byref(fwi))
    except Exception:
        pass


class Api:
    def __init__(self):
        self._window = None
        self._maximized = False
        self._hwnd = None

    def set_window(self, w):
        self._window = w

    def _get_hwnd(self):
        if self._hwnd:
            return self._hwnd
        if sys.platform != "win32":
            return None
        try:
            enum_cb_type = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
            pid = os.getpid()
            result = []
            def cb(hwnd, _):
                wnd_pid = ctypes.c_ulong()
                ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wnd_pid))
                if wnd_pid.value == pid and ctypes.windll.user32.IsWindowVisible(hwnd):
                    result.append(hwnd)
                return True
            ctypes.windll.user32.EnumWindows(enum_cb_type(cb), 0)
            if result:
                self._hwnd = result[0]
        except Exception:
            pass
        return self._hwnd

    def toggle_fullscreen(self):
        if not self._window:
            return
        if self._maximized:
            self._window.minimize()
            self._maximized = False
        else:
            self._window.restore()
            time.sleep(0.05)
            self._window.maximize()
            self._maximized = True

    def flash_taskbar(self):
        _flash_taskbar(self._get_hwnd())


def main():
    _kill_port_occupants(SERVER_PORT)
    server_thread = threading.Thread(target=_start_server, daemon=True)
    server_thread.start()
    _wait_for_server()
    js_api = Api()
    window = webview.create_window(
        title="丸子 MCP",
        url=URL,
        width=1200,
        height=800,
        min_size=(800, 600),
        js_api=js_api,
    )
    js_api.set_window(window)
    webview.start(debug=False)


if __name__ == "__main__":
    main()
