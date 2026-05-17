"""Entry point: python -m services.mcp_bridge

stdio MCP 服务器入口。stdout 是 JSON-RPC 通道，所有日志重定向到 stderr。
"""
from __future__ import annotations

import asyncio
import builtins
import logging
import sys
import traceback
from typing import Any


def _harden_stdout():
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr, force=True)
    real_print = builtins.print

    def _stderr_print(*args: Any, **kwargs: Any):
        kwargs.setdefault("file", sys.stderr)
        real_print(*args, **kwargs)

    builtins.print = _stderr_print  # type: ignore

    def _stderr_excepthook(exc_type, exc, tb):
        traceback.print_exception(exc_type, exc, tb, file=sys.stderr)

    sys.excepthook = _stderr_excepthook


def run():
    _harden_stdout()
    from .mcp_server import main
    asyncio.run(main())


if __name__ == "__main__":
    run()
