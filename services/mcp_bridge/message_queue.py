"""消息入队 —— 向指定会话投递用户输入。"""
from __future__ import annotations

import json
import os
import pathlib
from typing import Any

from . import SESSIONS_ROOT


def enqueue(
    *,
    session_id: str,
    text: str,
    images: list[str] | None = None,
    files: list[str] | None = None,
    allow_create: bool = True,
) -> bool:
    d = SESSIONS_ROOT / session_id
    if not d.exists():
        if not allow_create:
            return False
        d.mkdir(parents=True, exist_ok=True)
    p = d / "pending.json"
    data: dict[str, Any] = {"text": text}
    if images:
        data["images"] = images
    if files:
        data["files"] = files
    tmp = str(p) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, str(p))
    return True
