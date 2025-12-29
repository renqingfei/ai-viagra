import * as http from "node:http";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp";

type OutputLike = Pick<vscode.LogOutputChannel, "info" | "warn" | "error">;

export class EmbeddedMcpHttpServer implements vscode.Disposable {
  private readonly output: OutputLike;
  private httpServer: http.Server | undefined;
  private baseUrl = "";
  private mcpServer: McpServer | undefined;

  constructor({ output }: { output: OutputLike }) {
    this.output = output;
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  async start() {
    if (this.httpServer) return;

    this.mcpServer = new McpServer({ name: "ai-viagra-vscode", version: "0.0.1" });
    this.registerTools(this.mcpServer);

    this.httpServer = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once("error", reject);
      this.httpServer!.listen(0, "127.0.0.1", () => resolve());
    });

    const address = this.httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to determine server address.");
    }

    this.baseUrl = `http://127.0.0.1:${address.port}`;
    this.output.info(`MCP listening on ${this.baseUrl}/mcp`);
  }

  async stop() {
    const server = this.httpServer;
    this.httpServer = undefined;
    this.baseUrl = "";
    this.mcpServer = undefined;

    if (!server) return;

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  dispose() {
    void this.stop();
  }

  private registerTools(server: McpServer) {
    server.registerTool(
      "list_workspace_root",
      {
        title: "List workspace root",
        description: "List the files and folders in the current VS Code workspace root.",
        inputSchema: z.object({}).strict() as any
      },
      async (): Promise<any> => {
        const root = this.getWorkspaceRootPath();
        const entries = await fs.readdir(root, { withFileTypes: true });

        const mapped = entries
          .map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other"
          }))
          .sort((a, b) => {
            if (a.type !== b.type) {
              if (a.type === "directory") return -1;
              if (b.type === "directory") return 1;
            }
            return a.name.localeCompare(b.name);
          });

        const text = mapped.map((e) => `${e.type}\t${e.name}`).join("\n");

        return {
          structuredContent: {
            root,
            entries: mapped
          },
          content: [
            {
              type: "text",
              text: text.length ? text : "(empty)"
            }
          ]
        };
      }
    );
  }

  private getWorkspaceRootPath() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      throw new Error("No workspace folder is open.");
    }

    const root = folders[0]!.uri.fsPath;
    return path.resolve(root);
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      const server = this.mcpServer;
      if (!server) {
        res.statusCode = 503;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("MCP server not ready");
        return;
      }

      const url = new URL(req.url ?? "/", this.baseUrl || "http://127.0.0.1");

      if (url.pathname === "/") {
        res.statusCode = 200;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end(`MCP endpoint: ${this.baseUrl}/mcp\n`);
        return;
      }

      if (url.pathname !== "/mcp") {
        res.statusCode = 404;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("Not found");
        return;
      }

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("Method not allowed");
        return;
      }

      const bodyText = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.once("error", reject);
      });

      const body = JSON.parse(bodyText || "null");

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      this.output.error(String(err));
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain; charset=utf-8");
      }
      res.end("Internal server error");
    }
  }
}
