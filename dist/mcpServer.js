"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddedMcpHttpServer = void 0;
const http = __importStar(require("node:http"));
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const zod_1 = require("zod");
const mcp_1 = require("@modelcontextprotocol/sdk/server/mcp");
const streamableHttp_1 = require("@modelcontextprotocol/sdk/server/streamableHttp");
class EmbeddedMcpHttpServer {
    output;
    httpServer;
    baseUrl = "";
    mcpServer;
    constructor({ output }) {
        this.output = output;
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    async start() {
        if (this.httpServer)
            return;
        this.mcpServer = new mcp_1.McpServer({ name: "ai-viagra-vscode", version: "0.0.1" });
        this.registerTools(this.mcpServer);
        this.httpServer = http.createServer((req, res) => {
            void this.handleRequest(req, res);
        });
        await new Promise((resolve, reject) => {
            this.httpServer.once("error", reject);
            this.httpServer.listen(0, "127.0.0.1", () => resolve());
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
        if (!server)
            return;
        await new Promise((resolve) => server.close(() => resolve()));
    }
    dispose() {
        void this.stop();
    }
    registerTools(server) {
        server.registerTool("list_workspace_root", {
            title: "List workspace root",
            description: "List the files and folders in the current VS Code workspace root.",
            inputSchema: zod_1.z.object({}).strict()
        }, async () => {
            const root = this.getWorkspaceRootPath();
            const entries = await fs.readdir(root, { withFileTypes: true });
            const mapped = entries
                .map((e) => ({
                name: e.name,
                type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other"
            }))
                .sort((a, b) => {
                if (a.type !== b.type) {
                    if (a.type === "directory")
                        return -1;
                    if (b.type === "directory")
                        return 1;
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
        });
    }
    getWorkspaceRootPath() {
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (!folders.length) {
            throw new Error("No workspace folder is open.");
        }
        const root = folders[0].uri.fsPath;
        return path.resolve(root);
    }
    async handleRequest(req, res) {
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
            const bodyText = await new Promise((resolve, reject) => {
                const chunks = [];
                req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                req.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
                req.once("error", reject);
            });
            const body = JSON.parse(bodyText || "null");
            const transport = new streamableHttp_1.StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
                enableJsonResponse: true
            });
            await server.connect(transport);
            await transport.handleRequest(req, res, body);
        }
        catch (err) {
            this.output.error(String(err));
            if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader("content-type", "text/plain; charset=utf-8");
            }
            res.end("Internal server error");
        }
    }
}
exports.EmbeddedMcpHttpServer = EmbeddedMcpHttpServer;
