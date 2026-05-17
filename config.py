import os
import sys
import secrets


def _frozen() -> bool:
    return getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")


def _resource_dir() -> str:
    if _frozen():
        return os.path.join(sys._MEIPASS, "server")
    return os.path.dirname(os.path.abspath(__file__))


def _runtime_data_dir() -> str:
    override = os.environ.get("WANZI_DATA_DIR")
    if override:
        return os.path.abspath(override)
    if _frozen():
        if sys.platform == "win32":
            base = os.environ.get("APPDATA") or os.path.expanduser("~")
            return os.path.join(base, "WanziMCP")
        return os.path.expanduser("~/.wanzi_mcp")
    return os.path.join(_resource_dir(), "data")


BASE_DIR = _resource_dir()
DATA_DIR = _runtime_data_dir()

os.makedirs(DATA_DIR, exist_ok=True)

_local_secret_file = os.path.join(DATA_DIR, ".local_api_secret")


def _load_or_create_local_secret() -> str:
    env = os.environ.get("WANZI_LOCAL_SECRET")
    if env:
        return env
    if os.path.exists(_local_secret_file):
        with open(_local_secret_file, "r") as f:
            s = f.read().strip()
            if s:
                return s
    s = secrets.token_urlsafe(32)
    tmp = _local_secret_file + ".tmp"
    with open(tmp, "w") as f:
        f.write(s)
    os.replace(tmp, _local_secret_file)
    return s


LOCAL_API_SECRET = _load_or_create_local_secret()
LOCAL_API_SECRET_HEADER = "X-Wanzi-Local-Secret"

SERVER_HOST = os.environ.get("WANZI_HOST", "127.0.0.1").strip() or "127.0.0.1"
SERVER_PORT = int(os.environ.get("WANZI_PORT", "17777"))

IS_FROZEN = _frozen()

SILENT_RENEW_AFTER_S_DEFAULT = 600
SILENT_RENEW_POLL_S = 10
SILENT_RENEW_PAYLOAD = "__TIMEOUT_RENEW__"

CORS_ALLOW_ORIGINS = [
    "http://localhost",
    "http://127.0.0.1",
    "null",
]
CORS_ALLOW_ORIGIN_REGEX = (
    r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|vscode-file://.*|file://.*)$"
)
