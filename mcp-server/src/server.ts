import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

interface PendingRequest {
  id: string;
  aiOutput: string;
  resolve: (value: string) => void;
}

const pendingRequests: PendingRequest[] = [];

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

app.listen(17890, () => {
  console.log("AI feedback HTTP bridge listening on http://127.0.0.1:17890");
});

const server = new McpServer({
  name: "ai-feedback-mcp-server",
  version: "0.0.1"
});

server.registerTool(
  "feedback.submit",
  {
    title: "AI 输出反馈工具",
    description: "展示 AI 输出，并等待用户在 VS Code 中填写反馈后返回。",
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

const transport = new StdioServerTransport();

server
  .connect(transport)
  .then(() => {
    console.log("MCP server started on stdio");
  })
  .catch(err => {
    console.error("Failed to start MCP server", err);
  });
