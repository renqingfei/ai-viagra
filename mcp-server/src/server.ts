import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

interface PendingRequest {
  id: string;
  aiOutput: string;
  resolve: (value: string) => void;
}

const pendingRequests: PendingRequest[] = [];
const sessions = new Map<
  string,
  { transport: StreamableHTTPServerTransport; server: McpServer }
>();

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get("/pending-request", (_req: Request, res: Response) => {
  const reqItem = pendingRequests[0];
  if (!reqItem) {
    res.status(204).end();
    return;
  }
  res.json({ requestId: reqItem.id, aiOutput: reqItem.aiOutput });
});

app.post("/feedback", (req: Request, res: Response) => {
  const body = req.body as { requestId?: string; feedback?: string } | null;
  const requestId = body?.requestId;
  const feedback = body?.feedback;
  if (!requestId) {
    res.status(400).json({ error: "missing requestId" });
    return;
  }
  const index = pendingRequests.findIndex(r => r.id === requestId);
  if (index === -1) {
    res.status(404).json({ error: "request not found" });
    return;
  }
  const item = pendingRequests[index];
  pendingRequests.splice(index, 1);
  item.resolve(String(feedback ?? ""));
  res.json({ ok: true });
});

app.get("/", (_req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>AI Feedback MCP</title>
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #020617;
      color: #e5e7eb;
    }
    .card {
      max-width: 720px;
      margin: 0 auto;
      background: #020617;
      border-radius: 12px;
      padding: 16px 18px;
      box-shadow: 0 0 0 1px #111827;
    }
    .title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .subtitle {
      font-size: 12px;
      color: #9ca3af;
      margin-bottom: 12px;
    }
    .section-title {
      font-size: 12px;
      font-weight: 600;
      margin-top: 8px;
      margin-bottom: 4px;
      color: #e5e7eb;
    }
    pre {
      background: #020617;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 12px;
      color: #d4d4d4;
      max-height: 220px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px solid #1f2937;
    }
    textarea {
      width: 100%;
      min-height: 120px;
      border-radius: 8px;
      border: 1px solid #1f2937;
      background: #020617;
      color: #e5e7eb;
      padding: 8px;
      font-size: 12px;
      resize: vertical;
      box-sizing: border-box;
    }
    textarea:focus {
      outline: none;
      border-color: #2563eb;
      box-shadow: 0 0 0 1px #2563eb33;
    }
    button {
      margin-top: 10px;
      padding: 6px 14px;
      border-radius: 999px;
      border: none;
      font-size: 12px;
      cursor: pointer;
      background: #2563eb;
      color: #f9fafb;
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .status {
      margin-top: 8px;
      font-size: 12px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">AI Feedback MCP</div>
    <div class="subtitle">当有待处理的 AI 请求时，会在下方展示内容，你可以在浏览器中直接填写反馈。</div>

    <div class="section-title">AI 输出内容</div>
    <pre id="output">正在等待 AI 请求...</pre>

    <div class="section-title">你的反馈</div>
    <textarea id="feedback" placeholder="在这里输入你的反馈..."></textarea>
    <button id="submit" disabled>发送反馈</button>
    <div class="status" id="status">暂无待处理请求</div>
  </div>

  <script>
    let currentRequestId = null;

    async function loadPending() {
      const output = document.getElementById("output");
      const status = document.getElementById("status");
      const submit = document.getElementById("submit");

      try {
        const res = await fetch("/pending-request");
        if (res.status === 204) {
          currentRequestId = null;
          output.textContent = "正在等待 AI 请求...";
          status.textContent = "暂无待处理请求";
          submit.disabled = true;
          return;
        }
        const data = await res.json();
        currentRequestId = data.requestId;
        output.textContent = data.aiOutput || "";
        status.textContent = "已收到 AI 请求，请填写反馈后提交。";
        submit.disabled = false;
      } catch (e) {
        currentRequestId = null;
        output.textContent = "加载待处理请求失败。";
        status.textContent = "请检查服务器是否运行正常。";
        submit.disabled = true;
      }
    }

    async function sendFeedback() {
      const textarea = document.getElementById("feedback");
      const status = document.getElementById("status");
      const submit = document.getElementById("submit");

      if (!currentRequestId) {
        status.textContent = "当前没有待处理的请求。";
        return;
      }

      const text = textarea.value || "";
      submit.disabled = true;
      status.textContent = "正在提交反馈...";

      try {
        const res = await fetch("/feedback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ requestId: currentRequestId, feedback: text })
        });
        if (res.ok) {
          status.textContent = "反馈已提交，AI 会收到你的意见。";
          textarea.value = "";
          currentRequestId = null;
          setTimeout(loadPending, 1000);
        } else {
          status.textContent = "提交失败，请稍后重试。";
          submit.disabled = false;
        }
      } catch (e) {
        status.textContent = "提交失败，请检查网络或服务器。";
        submit.disabled = false;
      }
    }

    document.getElementById("submit").addEventListener("click", sendFeedback);

    loadPending();
    setInterval(loadPending, 3000);
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.get("/ui", (_req: Request, res: Response) => {
  res.redirect("/");
});

function createMcpServer(sessionId?: string): McpServer {
  const server = new McpServer({
    name: "ai-feedback-mcp-server",
    version: "0.0.1"
  });

  server.registerTool(
    "feedback.submit",
    {
      title: "AI 输出反馈工具",
      description:
        "展示 AI 输出，并等待用户在反馈页面或 VS Code 中填写反馈后返回。",
      inputSchema: z.object({
        output: z.string().describe("AI 的输出内容，需要展示给用户"),
        requestId: z
          .string()
          .optional()
          .describe("可选的请求 ID")
      })
    },
    async (input: { output: string; requestId?: string }) => {
      const id =
        input.requestId ??
        sessionId ??
        `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const feedbackPromise = new Promise<string>(resolve => {
        pendingRequests.push({
          id,
          aiOutput: input.output,
          resolve
        });
      });

      const feedback = await feedbackPromise;

      return {
        content: [
          {
            type: "text",
            text: feedback
          }
        ]
      };
    }
  );

  return server;
}

function getSessionId(req: Request): string | undefined {
  const fromQuery = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
  const fromHeader =
    typeof req.headers["mcp-session-id"] === "string" ? req.headers["mcp-session-id"] : undefined;
  return fromQuery ?? fromHeader;
}

app.post("/mcp", async (req: Request, res: Response) => {
  try {
    const sessionId = getSessionId(req);
    if (sessionId && sessions.has(sessionId)) {
      const ctx = sessions.get(sessionId);
      if (!ctx) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: Invalid session" },
          id: null
        });
        return;
      }
      (req.headers as Record<string, unknown>)["mcp-session-id"] = sessionId;
      await ctx.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: Server not initialized" },
        id: null
      });
      return;
    }

    const newSessionId = sessionId ?? randomUUID().replace(/-/g, "");
    const server = createMcpServer(newSessionId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => newSessionId
    });

    sessions.set(newSessionId, { transport, server });

    await server.connect(transport);
    (req.headers as Record<string, unknown>)["mcp-session-id"] = newSessionId;
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP HTTP error", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "internal mcp error" });
    }
  }
});

app.get("/mcp", async (req: Request, res: Response) => {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) {
      res.status(400).send("missing sessionId");
      return;
    }

    let ctx = sessions.get(sessionId);
    if (!ctx) {
      const server = createMcpServer(sessionId);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId
      });
      ctx = { transport, server };
      sessions.set(sessionId, ctx);
      await server.connect(transport);
    }

    (req.headers as Record<string, unknown>)["mcp-session-id"] = sessionId;
    res.on("close", () => {
      const latest = sessions.get(sessionId);
      if (latest) {
        latest.transport.close();
        latest.server.close();
        sessions.delete(sessionId);
      }
    });

    await ctx.transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP HTTP error", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "internal mcp error" });
    }
  }
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = getSessionId(req);
  if (!sessionId) {
    res.status(400).send("missing sessionId");
    return;
  }
  const ctx = sessions.get(sessionId);
  if (!ctx) {
    res.status(404).send("session not found");
    return;
  }
  ctx.transport.close();
  ctx.server.close();
  sessions.delete(sessionId);
  res.status(204).end();
});

app.listen(17890, () => {
  console.log("AI feedback MCP HTTP server listening on http://127.0.0.1:17890");
});
