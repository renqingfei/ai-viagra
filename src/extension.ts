import * as vscode from 'vscode';
import { MCPHttpServer } from './mcpHttpServer';
import { SidebarProvider } from './sidebarProvider';

let server: MCPHttpServer | undefined;

export function activate(context: vscode.ExtensionContext) {
  const viewProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  const getPort = () => vscode.workspace.getConfiguration('infiniteDialog').get<number>('serverPort', 3456);
  server = new MCPHttpServer(context.extensionUri, viewProvider);
  context.subscriptions.push({ dispose: () => server?.stop() });

  context.subscriptions.push(
    vscode.commands.registerCommand('infiniteDialog.showStatus', async () => {
      const port = server?.getPort() ?? getPort();
      const connections = server?.getConnectionCount() ?? 0;
      void vscode.window.showInformationMessage(`ai伟哥: running on ${port}, connections: ${connections}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('infiniteDialog.refresh', async () => {
      viewProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('infiniteDialog.openPanel', async () => {
      await server?.showTestFeedbackPanel('ai伟哥');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('infiniteDialog.testFeedback', async () => {
      const now = new Date().toISOString();
      await server?.showTestFeedbackPanel(`test at ${now}`);
    })
  );

  void server.start(getPort()).catch((err) => {
    void vscode.window.showErrorMessage(`ai伟哥: 启动服务失败：${String(err)}`);
  });
}

export function deactivate() {}
