import * as vscode from "vscode";

interface FeedbackPayload {
  requestId: string;
  aiOutput: string;
}

export class FeedbackPanel {
  private static currentPanel: FeedbackPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly resolve: (value: string) => void;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    payload: FeedbackPayload,
    resolve: (value: string) => void
  ) {
    this.panel = panel;
    this.resolve = resolve;

    this.panel.webview.options = {
      enableScripts: true
    };

    this.panel.webview.html = this.getHtml(
      this.panel.webview,
      extensionUri,
      payload
    );

    this.panel.webview.onDidReceiveMessage(message => {
      if (message.type === "submit") {
        const text: string = message.text ?? "";
        this.resolve(text);
        FeedbackPanel.currentPanel = undefined;
        this.panel.dispose();
      }
    });

    this.panel.onDidDispose(() => {
      FeedbackPanel.currentPanel = undefined;
    });
  }

  static show(
    context: vscode.ExtensionContext,
    payload: FeedbackPayload
  ): Promise<string> {
    return new Promise(resolve => {
      const activeColumn = vscode.window.activeTextEditor?.viewColumn;
      const column =
        activeColumn !== undefined ? activeColumn : vscode.ViewColumn.One;

      if (FeedbackPanel.currentPanel) {
        FeedbackPanel.currentPanel.panel.reveal(column);
        FeedbackPanel.currentPanel.panel.webview.postMessage({
          type: "update",
          payload
        });
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        "aiFeedbackPanel",
        "AI 反馈",
        column,
        {
          enableScripts: true
        }
      );

      FeedbackPanel.currentPanel = new FeedbackPanel(
        panel,
        context.extensionUri,
        payload,
        resolve
      );
    });
  }

  private getHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    payload: FeedbackPayload
  ): string {
    const escapedOutput = payload.aiOutput
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const nonce = Date.now().toString();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI 反馈</title>
  <style>
    body { font-family: sans-serif; padding: 12px; }
    .section-title { font-weight: bold; margin-top: 8px; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 8px; border-radius: 4px; max-height: 240px; overflow: auto; }
    textarea { width: 100%; min-height: 120px; margin-top: 8px; }
    button { margin-top: 8px; padding: 4px 12px; }
  </style>
</head>
<body>
  <div class="section-title">AI 输出内容：</div>
  <pre>${escapedOutput}</pre>

  <div class="section-title">你的反馈：</div>
  <textarea id="feedback" placeholder="在这里输入你的反馈..."></textarea>
  <div>
    <button id="submit">发送</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.getElementById('submit').addEventListener('click', () => {
      const text = (document.getElementById('feedback') as HTMLTextAreaElement).value;
      vscode.postMessage({ type: 'submit', text });
    });

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'update' && message.payload) {
        const output = message.payload.aiOutput || '';
        const pre = document.querySelector('pre');
        if (pre) {
          pre.textContent = output;
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
