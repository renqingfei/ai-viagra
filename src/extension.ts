import * as vscode from "vscode";
import { EmbeddedMcpHttpServer } from "./mcpServer";
import { WorkspaceTreeDataProvider } from "./workspaceTree";

let embeddedServer: EmbeddedMcpHttpServer | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("AI Viagra MCP", { log: true });

  const workspaceTreeProvider = new WorkspaceTreeDataProvider();
  vscode.window.registerTreeDataProvider("aiViagraMcp.workspaceTree", workspaceTreeProvider);

  const refreshWorkspaceView = vscode.commands.registerCommand("aiViagraMcp.refreshWorkspaceView", async () => {
    workspaceTreeProvider.refresh();
  });

  embeddedServer = new EmbeddedMcpHttpServer({ output });
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

export async function deactivate() {
  await embeddedServer?.stop();
  embeddedServer = undefined;
}
