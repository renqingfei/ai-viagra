import * as vscode from "vscode";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";
import { AiFeedbackViewProvider } from "./sidebarView";
import { FeedbackPanel } from "./feedbackPanel";
import { McpClient } from "./mcpClient";

let mcpClient: McpClient | undefined;
let mcpProcess: ChildProcess | undefined;

function startMcpProcess(
  context: vscode.ExtensionContext,
  statusProvider: AiFeedbackViewProvider
) {
  const serverScript = path.join(
    context.extensionPath,
    "mcp-server",
    "dist",
    "server.js"
  );

  const proc = spawn(process.execPath, [serverScript], {
    cwd: path.join(context.extensionPath, "mcp-server"),
    stdio: "ignore"
  });

  mcpProcess = proc;

  proc.on("exit", code => {
    const status =
      typeof code === "number"
        ? `MCP 进程已退出 (${code})`
        : "MCP 进程已退出";
    statusProvider.updateStatus(status);
  });
}

export function activate(context: vscode.ExtensionContext) {
  const statusProvider = new AiFeedbackViewProvider(context);
  vscode.window.registerWebviewViewProvider(
    "aiFeedbackSidebar",
    statusProvider
  );

  startMcpProcess(context, statusProvider);

  mcpClient = new McpClient({
    onRequestFeedback: async payload => {
      statusProvider.recordSessionStart(payload.aiOutput.slice(0, 80));
      statusProvider.updateStatus("等待用户反馈");
      const feedback = await FeedbackPanel.show(context, payload);
      statusProvider.updateStatus("反馈已提交");
      statusProvider.recordSessionCompleted();
      return feedback;
    },
    onStatusChange: status => {
      statusProvider.updateStatus(status);
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("aiFeedback.openPanel", async () => {
      await FeedbackPanel.show(context, {
        requestId: "manual",
        aiOutput: "这是一个手动打开的示例，你可以在这里输入反馈。"
      });
    })
  );

  statusProvider.updateStatus("未连接");

  mcpClient.connect().catch(err => {
    console.error("连接 MCP 服务失败: ", err);
  });
}

export function deactivate() {
  mcpClient?.dispose();
  if (mcpProcess) {
    mcpProcess.kill();
    mcpProcess = undefined;
  }
}
