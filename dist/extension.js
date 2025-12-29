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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const mcpServer_1 = require("./mcpServer");
const workspaceTree_1 = require("./workspaceTree");
let embeddedServer;
async function activate(context) {
    const output = vscode.window.createOutputChannel("AI Viagra MCP", { log: true });
    const workspaceTreeProvider = new workspaceTree_1.WorkspaceTreeDataProvider();
    vscode.window.registerTreeDataProvider("aiViagraMcp.workspaceTree", workspaceTreeProvider);
    const refreshWorkspaceView = vscode.commands.registerCommand("aiViagraMcp.refreshWorkspaceView", async () => {
        workspaceTreeProvider.refresh();
    });
    embeddedServer = new mcpServer_1.EmbeddedMcpHttpServer({ output });
    void embeddedServer.start().catch((err) => {
        output.error(String(err));
    });
    const showInfo = vscode.commands.registerCommand("aiViagraMcp.showServerInfo", async () => {
        if (!embeddedServer) {
            vscode.window.showErrorMessage("MCP server is not initialized.");
            return;
        }
        const url = embeddedServer.getBaseUrl();
        if (!url) {
            vscode.window.showWarningMessage("MCP server is starting. Try again in a moment.");
            return;
        }
        const choice = await vscode.window.showInformationMessage(`MCP server running at ${url}`, "Copy URL");
        if (choice === "Copy URL") {
            await vscode.env.clipboard.writeText(url);
        }
    });
    const restart = vscode.commands.registerCommand("aiViagraMcp.restartServer", async () => {
        if (!embeddedServer) {
            vscode.window.showErrorMessage("MCP server is not initialized.");
            return;
        }
        await embeddedServer.stop();
        await embeddedServer.start();
        vscode.window.showInformationMessage(`MCP server restarted at ${embeddedServer.getBaseUrl()}`);
    });
    context.subscriptions.push(output, showInfo, restart, refreshWorkspaceView, embeddedServer, workspaceTreeProvider);
    if (embeddedServer.getBaseUrl()) {
        output.info(`MCP server started: ${embeddedServer.getBaseUrl()}`);
    }
}
async function deactivate() {
    await embeddedServer?.stop();
    embeddedServer = undefined;
}
