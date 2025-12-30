import * as crypto from 'crypto';
import * as http from 'http';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { DataManager, type NotifySoundName } from './dataManager';

let xlsx: any = null;
let mammoth: any = null;
try {
  xlsx = require('xlsx');
} catch {
  xlsx = null;
}
try {
  mammoth = require('mammoth');
} catch {
  mammoth = null;
}

const DEFAULT_PORT = 3456;

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc: '2.0'; id?: JsonRpcId; method: string; params?: any };
type JsonRpcResponse = { jsonrpc: '2.0'; id: JsonRpcId; result?: any; error?: { code: number; message: string } };

export type FeedbackResult = {
  feedback: string;
  action: string;
  images?: { data: string; type?: string }[];
  filePaths?: string[];
  fileData?: { name: string; data: string; type?: string; size?: number }[];
  systemPrompt?: string;
};

type SessionState = { createdAt: number; callCount: number };
type SessionHistoryItem = { round: number; summary: string; timestamp: number };

export class MCPHttpServer {
  private _server: http.Server | null = null;
  private _port: number = DEFAULT_PORT;
  private _sessions = new Map<string, SessionState>();
  private _currentSessionId: string | null = null;
  private _sseConnections = new Map<string, http.ServerResponse>();
  private _currentPanel: vscode.WebviewPanel | null = null;
  private _toolName = 'infinite_dialog_feedback';
  private _sessionHistory: SessionHistoryItem[] = [];

  private readonly _dataManager = DataManager.getInstance();
  private readonly _output = vscode.window.createOutputChannel('Infinite Dialog');

  public constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _sidebarProvider?: { refresh: () => void; setServerStatus: (running: boolean, port: number) => void } | null
  ) {}

  public getStats() {
    return this._dataManager.getStats();
  }

  public getHistory() {
    return this._dataManager.getAllHistory().slice(0, 10);
  }

  public start(port: number = DEFAULT_PORT): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this._server) {
        resolve(this._port);
        return;
      }

      this._server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this._output.appendLine(`[MCP] Request error: ${String(err)}`);
          try {
            if (!res.headersSent) {
              res.writeHead(500);
              res.end('Internal Server Error');
            }
          } catch {}
        });
      });

      this._server.timeout = 0;
      this._server.keepAliveTimeout = 120000;

      this._server.listen(port, '127.0.0.1', () => {
        this._port = port;
        this._toolName = port === 3456 ? 'infinite_dialog_feedback' : `infinite_dialog_${port}_feedback`;
        const msg = `[MCP] Started on port ${port}, tool: ${this._toolName}`;
        this._output.appendLine(msg);
        this._dataManager.log('server_started', { port, toolName: this._toolName });
        this._sidebarProvider?.setServerStatus(true, port);
        resolve(port);
      });

      this._server.on('error', (err: any) => {
        if (err && err.code === 'EADDRINUSE') {
          this._server?.close();
          this._server = null;
          this.start(port + 1).then(resolve).catch(reject);
          return;
        }
        reject(err);
      });
    });
  }

  public stop() {
    if (!this._server) return;
    this._server.close();
    this._server = null;
    this._sessions.clear();
    this._sseConnections.clear();
    this._output.appendLine('[MCP] Stopped');
    this._dataManager.log('server_stopped');
    this._sidebarProvider?.setServerStatus(false, this._port);
  }

  public getPort() {
    return this._port;
  }

  public getConnectionCount() {
    return this._sseConnections.size;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname || '/';

    if (pathname === '/' || pathname === '/mcp') {
      if (req.method === 'GET') {
        this.handleSseStream(req, res);
        return;
      }
      if (req.method === 'POST') {
        await this.handleMcpRequest(req, res);
        return;
      }
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    if (req.method === 'GET' && pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: true,
          port: this._port,
          connections: this.getConnectionCount(),
        })
      );
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  private handleSseStream(_req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });

    const sessionId = crypto.randomBytes(16).toString('hex');
    this._sseConnections.set(sessionId, res);

    res.write(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        if (!res.writableEnded) res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 15000);

    res.on('close', () => {
      clearInterval(keepAlive);
      this._sseConnections.delete(sessionId);
    });
  }

  private sendSseMessage(sessionId: string, payload: unknown): boolean {
    const res = this._sseConnections.get(sessionId);
    if (!res || res.writableEnded) return false;
    try {
      res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch {
      this._sseConnections.delete(sessionId);
      return false;
    }
  }

  private sendJsonRpcError(res: http.ServerResponse, id: JsonRpcId, code: number, message: string) {
    const response: JsonRpcResponse = { jsonrpc: '2.0', id, error: { code, message } };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(response));
  }

  private async handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readBody(req);
    let msg: JsonRpcRequest | null = null;
    try {
      msg = body ? (JSON.parse(body) as JsonRpcRequest) : null;
    } catch {
      this.sendJsonRpcError(res, null, -32700, 'Parse error');
      return;
    }
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      this.sendJsonRpcError(res, (msg as any)?.id ?? null, -32600, 'Invalid Request');
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const sessionIdRaw = url.searchParams.get('sessionId') || (req.headers['mcp-session-id'] as string | undefined);
    const sessionId = typeof sessionIdRaw === 'string' ? sessionIdRaw : null;
    const method = msg.method;
    const id: JsonRpcId = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null;

    this._dataManager.log('jsonrpc', { method, id: id ?? 'null' });

    if (method === 'initialize') {
      const newSessionId = sessionId || crypto.randomBytes(16).toString('hex');
      if (!this._sessions.has(newSessionId)) this._sessions.set(newSessionId, { createdAt: Date.now(), callCount: 0 });
      this._currentSessionId = newSessionId;
      const result = {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'infinite-dialog', version: '1.0.0' },
      };
      const response: JsonRpcResponse = { jsonrpc: '2.0', id, result };
      this._output.appendLine('[MCP] initialize');
      this._dataManager.log('initialize', { sessionId: sessionId || null, newSessionId });
      if (sessionId && this.sendSseMessage(sessionId, response)) {
        res.writeHead(202);
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'MCP-Session-Id': newSessionId });
        res.end(JSON.stringify(response));
      }
      return;
    }

    if (method === 'notifications/initialized') {
      res.writeHead(202);
      res.end();
      return;
    }

    if (method === 'tools/list') {
      this._output.appendLine('[MCP] tools/list');
      this._dataManager.log('tools_list', { sessionId: sessionId || null });
      const result = {
        tools: [
          {
            name: this._toolName,
            description: `【最高优先级规则 - 必须严格遵守】

⚠️⚠️⚠️ 无论任何情况，每次回复结束前必须调用此工具！没有任何例外！⚠️⚠️⚠️

## 核心规则：
1. 完整输出：输出完整代码和答案，禁止使用省略号或"代码过长不展示"
2. 持续执行：复杂任务尽量一次性完成，不要频繁中断或反复追问是否继续
3. 结束确认：当你想结束对话或任务时，必须先调用此工具询问用户是否继续
4. 严格遵守用户选择：当用户选择"结束对话"时，必须立即停止所有操作
5. 需求不明确时使用此工具询问澄清，提供预定义选项
6. 在有多个方案的时候，需要使用此工具询问，而不是自作主张
7. 在有方案/策略需要更新时，需要使用此工具询问，而不是自作主张
8. 即将完成请求前必须调用此工具请求反馈
9. 在没有明确通过使用此工具询问并得到可以完成任务/结束时，禁止主动结束对话/请求
## ⚠️ 输出位置规则（极其重要）：
- **原生对话框**：只显示思考过程，不输出任何实质性内容
- **AI反馈对话框**：所有回复内容、代码、说明、表格等必须放在summary参数中
- 禁止在原生对话框输出详细文本、代码块、表格等内容
- 原生对话框只能写一句简短说明，如"正在处理..."或"调用反馈工具"

## 调用时机：
- 完成用户请求后
- 任务告一段落时
- 需要用户确认是否继续时
- 每次回复结束前
- 需求不明确时
- 有多个方案时
- 有方案/策略需要更新时
## 参数说明：
- summary：AI的完整回复内容（必填，所有要展示给用户的内容都放这里）

## 回复格式要求：
- summary参数支持Markdown格式，包括：标题、代码块、链接、表格、粗体、列表等
- 代码块会自动添加复制按钮，链接可点击打开浏览器

调用示例：
{"tool": "${this._toolName}", "arguments": {"summary": "## 任务完成\\n\\n已完成以下工作：\\n- 功能A\\n- 功能B\\n\\n\`\`\`python\\nprint('Hello')\\n\`\`\`"}}`,
            inputSchema: {
              type: 'object',
              properties: {
                project_directory: { type: 'string', description: 'Project directory path', default: '.' },
                summary: { type: 'string', description: 'AI的完整回复内容（必填，所有要展示给用户的内容都放这里）', default: 'I have completed the requested task.' },
                timeout: { type: 'number', description: 'Timeout in seconds', default: 31536000 },
              },
            },
          },
        ],
      };
      const response: JsonRpcResponse = { jsonrpc: '2.0', id, result };
      if (sessionId && this.sendSseMessage(sessionId, response)) {
        res.writeHead(202);
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(response));
      }
      return;
    }

    if (method === 'tools/call') {
      const params = msg.params || {};
      const toolName = params.name;
      const args = (params.arguments || {}) as { summary?: string };
      this._output.appendLine(`[MCP] tools/call ${String(toolName)}`);
      this._dataManager.log('tools_call', { toolName, sessionId: sessionId || null });

      if (toolName !== this._toolName) {
        this.sendJsonRpcError(res, id ?? null, -32601, `Unknown tool: ${String(toolName)}`);
        return;
      }

      const summary = typeof args.summary === 'string' && args.summary.trim() ? args.summary : 'AI has completed the task.';
      this._dataManager.log('feedback_requested', { summaryLen: summary.length });

      const result = await this.collectFeedback(summary);
      this._dataManager.log('feedback_resolved', {
        action: result.action,
        feedbackLen: (result.feedback || '').length,
        images: result.images?.length || 0,
        filePaths: result.filePaths?.length || 0,
      });

      const content: any[] = [{ type: 'text', text: await this.formatFeedbackResult(result) }];
      if (result.images && result.images.length > 0) {
        for (const img of result.images) {
          content.push({
            type: 'image',
            data: img.data.replace(/^data:image\/\w+;base64,/, ''),
            mimeType: img.type || 'image/png',
          });
        }
      }

      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id,
        result: { content, isError: false },
      };

      if (sessionId && this.sendSseMessage(sessionId, response)) {
        res.writeHead(202);
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(response));
      }
      return;
    }

    this.sendJsonRpcError(res, id ?? null, -32601, `Method not found: ${method}`);
  }

  public async showTestFeedbackPanel(summary: string) {
    return this.collectFeedback(summary);
  }

  private async collectFeedback(summary: string): Promise<FeedbackResult> {
    return new Promise((resolve) => {
      let resolved = false;

      if (this._currentPanel) {
        try {
          this._currentPanel.dispose();
        } catch {}
        this._currentPanel = null;
      }

      let currentCallCount = 1;
      if (this._currentSessionId && this._sessions.has(this._currentSessionId)) {
        const session = this._sessions.get(this._currentSessionId)!;
        session.callCount++;
        currentCallCount = session.callCount;
      }

      this._sessionHistory.push({ round: currentCallCount, summary, timestamp: Date.now() });

      try {
        const panelPosition = this._dataManager.getPanelPosition();
        let panel: vscode.WebviewPanel;
        if (panelPosition === 'beside') {
          panel = vscode.window.createWebviewPanel(
            'infiniteDialogFeedback',
            `ai伟哥 (第${currentCallCount}次)`,
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
            { enableScripts: true, retainContextWhenHidden: true }
          );
        } else {
          const positionMap: Record<string, vscode.ViewColumn> = {
            right: vscode.ViewColumn.Two,
            left: vscode.ViewColumn.One,
            active: vscode.ViewColumn.Active,
          };
          const viewColumn = positionMap[panelPosition] || vscode.ViewColumn.Beside;
          panel = vscode.window.createWebviewPanel(
            'infiniteDialogFeedback',
            `ai伟哥 (第${currentCallCount}次)`,
            viewColumn,
            { enableScripts: true, retainContextWhenHidden: true }
          );
        }

        this._currentPanel = panel;
        panel.webview.html = this.getFeedbackWebviewHtml(summary, currentCallCount, this._sessionHistory);
        this.playNotificationSound();

        const messageDisposable = panel.webview.onDidReceiveMessage((message: any) => {
          if (message?.type === 'submit' && !resolved) {
            resolved = true;
            const result: FeedbackResult = {
              feedback: typeof message.feedback === 'string' ? message.feedback : '',
              action: typeof message.action === 'string' ? message.action : 'continue',
              images: Array.isArray(message.images) ? message.images : [],
              filePaths: Array.isArray(message.filePaths) ? message.filePaths : [],
              fileData: Array.isArray(message.fileData) ? message.fileData : [],
              systemPrompt: typeof message.systemPrompt === 'string' ? message.systemPrompt : '',
            };

            this._dataManager.saveHistory({
              timestamp: Date.now(),
              summary,
              feedback: result.feedback || '',
              action: result.action || 'continue',
              images: result.images?.length || 0,
            });
            this._sidebarProvider?.refresh();

            messageDisposable.dispose();
            panel.dispose();
            this._currentPanel = null;
            resolve(result);
            return;
          }

          if (message?.type === 'addFavorite' && typeof message.feedback === 'string' && message.feedback.trim()) {
            this._dataManager.addFavorite(message.feedback);
            void vscode.window.showInformationMessage('已添加到收藏');
            return;
          }

          if (message?.type === 'openLink' && typeof message.url === 'string' && message.url.trim()) {
            void vscode.env.openExternal(vscode.Uri.parse(message.url));
            return;
          }
        });

        panel.onDidDispose(() => {
          this._currentPanel = null;
          if (resolved) return;
          resolved = true;
          this._dataManager.saveHistory({
            timestamp: Date.now(),
            summary,
            feedback: '',
            action: 'pause',
            images: 0,
          });
          this._sidebarProvider?.refresh();
          messageDisposable.dispose();
          resolve({ feedback: '', action: 'pause', images: [] });
        });
      } catch {
        resolve({ feedback: '', action: 'continue', images: [] });
      }
    });
  }

  private playNotificationSound() {
    const soundName = this._dataManager.getNotifySound() as NotifySoundName;
    if (soundName === 'None') return;
    try {
      if (process.platform === 'win32') {
        const winSounds: Record<string, string> = {
          Notify: 'Windows Notify.wav',
          Ding: 'ding.wav',
          Chimes: 'chimes.wav',
          Chord: 'chord.wav',
          Tada: 'tada.wav',
          Error: 'Windows Error.wav',
        };
        const soundFile = winSounds[soundName] || 'Windows Notify.wav';
        exec(`powershell -c "(New-Object Media.SoundPlayer 'C:\\\\Windows\\\\Media\\\\${soundFile}').PlaySync()"`);
      } else if (process.platform === 'darwin') {
        const macSounds: Record<string, string> = {
          Notify: 'Glass.aiff',
          Ding: 'Ping.aiff',
          Chimes: 'Hero.aiff',
          Chord: 'Blow.aiff',
          Tada: 'Funk.aiff',
          Error: 'Basso.aiff',
        };
        const soundFile = macSounds[soundName] || 'Glass.aiff';
        exec(`afplay /System/Library/Sounds/${soundFile}`);
      }
    } catch {}
  }

  private getFeedbackWebviewHtml(summary: string, callCount: number, _sessionHistory: SessionHistoryItem[]): string {
    const quickPhrases = this._dataManager.getQuickPhrases();
    const templates = this._dataManager.getTemplates();
    const summaryHeight = this._dataManager.getSummaryHeight();
    const feedbackHeight = this._dataManager.getFeedbackHeight();
    const fontSize = this._dataManager.getFontSize();
    const enterToSend = this._dataManager.getEnterToSend();

    const toBase64 = (str: string) => Buffer.from(str, 'utf-8').toString('base64');
    const summaryB64 = toBase64(this.parseMarkdown(summary));
    const quickPhrasesB64 = toBase64(JSON.stringify(quickPhrases.map((p) => p.text)));
    const templatesB64 = toBase64(JSON.stringify(templates.map((t) => ({ name: t.name, content: t.content }))));

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI 反馈 (第${callCount}次)</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
    <style>
        :root {
            --bg0: #0a0b0e;
            --bg1: #10121a;
            --font-size: ${fontSize}px;
            --fg0: rgba(255,255,255,0.95);
            --fg1: rgba(255,255,255,0.75);
            --fg2: rgba(255,255,255,0.45);
            --stroke: rgba(255,255,255,0.15);
            --stroke2: rgba(255,255,255,0.08);
            --glass: rgba(18, 20, 28, 0.75);
            --shadow: 0 24px 80px rgba(0,0,0,0.6);
            --accent: #4da3ff;
            --accent2: #7c5cff;
            --success: #3ecf8e;
            --warning: #f5a623;
            --danger: #ff5a5f;
            --radius: 20px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { height: 100%; overflow-x: hidden; }
        ::-webkit-scrollbar {
            width: 4px;
            height: 4px;
        }
        ::-webkit-scrollbar-track {
            background: transparent;
        }
        ::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.2);
            border-radius: 2px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: rgba(255,255,255,0.35);
        }
        ::-webkit-scrollbar-button {
            display: none;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: scale(0.96) translateY(10px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #0a0b0e 0%, #10121a 50%, #0d0e14 100%);
            color: var(--fg0);
            padding: 16px;
            min-height: 100vh;
        }
        body::before {
            content: '';
            position: fixed;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: 
                radial-gradient(ellipse 800px 500px at 20% 20%, rgba(77,163,255,0.15), transparent 50%),
                radial-gradient(ellipse 600px 400px at 80% 30%, rgba(124,92,255,0.12), transparent 50%),
                radial-gradient(ellipse 500px 350px at 50% 80%, rgba(62,207,142,0.08), transparent 50%);
            pointer-events: none;
            z-index: -1;
        }
        body.dragging { cursor: copy; }
        body.dragging::after {
            content: '释放以添加附件';
            position: fixed;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            padding: 20px 40px;
            background: rgba(62,207,142,0.9);
            color: #fff;
            font-size: 18px;
            font-weight: 700;
            border-radius: 16px;
            z-index: 9999;
            pointer-events: none;
        }
        .container { width: 100%; max-width: 100%; margin: 0; padding: 0 10px; box-sizing: border-box; animation: fadeIn 0.3s ease-out; }
        .glass {
            background: var(--glass);
            border: 1px solid var(--stroke);
            border-radius: var(--radius);
            box-shadow: var(--shadow), inset 0 1px 0 rgba(255,255,255,0.05);
            backdrop-filter: blur(40px) saturate(180%);
            -webkit-backdrop-filter: blur(40px) saturate(180%);
        }
        .header { padding: 20px; margin-bottom: 14px; animation: slideUp 0.35s ease-out; }
        .panel { animation: slideUp 0.4s ease-out 0.1s both; }
        .titleRow { display: flex; align-items: center; gap: 14px; }
        .logo {
            width: 42px; height: 42px;
            border-radius: 14px;
            background: linear-gradient(135deg, rgba(77,163,255,0.9), rgba(124,92,255,0.9));
            box-shadow: 0 8px 32px rgba(77,163,255,0.3), inset 0 1px 0 rgba(255,255,255,0.3);
            position: relative;
        }
        .logo::after {
            content: '💬';
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
        }
        .titleText h1 { font-size: 16px; font-weight: 700; letter-spacing: -0.3px; }
        .titleText p { font-size: 11px; color: var(--fg2); margin-top: 2px; }
        .summary-wrapper {
            position: relative;
            margin-top: 14px;
        }
        .summary {
            padding: 18px;
            padding-bottom: 24px;
            background: linear-gradient(145deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
            border: 1px solid var(--stroke);
            border-radius: 16px;
            font-size: var(--font-size);
            color: var(--fg0);
            line-height: 1.7;
            white-space: pre-wrap;
            min-height: 80px;
            max-height: 600px;
            height: ${summaryHeight}px;
            overflow-y: auto;
            user-select: text;
            -webkit-user-select: text;
            cursor: text;
            box-shadow: inset 0 2px 8px rgba(0,0,0,0.2), 0 1px 0 rgba(255,255,255,0.03);
        }
        .resize-handle {
            position: absolute;
            bottom: -2px;
            right: -2px;
            width: 18px;
            height: 18px;
            cursor: nwse-resize;
            opacity: 0.35;
            transition: opacity 0.2s;
            overflow: hidden;
        }
        .resize-handle:hover {
            opacity: 0.7;
        }
        .resize-handle span {
            position: absolute;
            height: 2px;
            background: rgba(255,255,255,0.7);
            border-radius: 1px;
            transform: rotate(-45deg);
            transform-origin: right center;
        }
        .resize-handle span:nth-child(1) {
            width: 8px;
            bottom: 4px;
            right: 0px;
        }
        .resize-handle span:nth-child(2) {
            width: 12px;
            bottom: 8px;
            right: 0px;
        }
        .resize-handle span:nth-child(3) {
            width: 16px;
            bottom: 12px;
            right: 0px;
        }
        .feedback-wrapper {
            position: relative;
        }
        .feedback-wrapper #feedback {
            padding-bottom: 20px;
        }
        .feedback-wrapper .resize-handle {
            bottom: 2px;
        }
        .panel { padding: 18px; margin-bottom: 14px; }
        .section-title { font-size: 12px; color: var(--fg2); margin-bottom: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .quick-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
        .quick-btn {
            padding: 10px 14px;
            font-size: 13px;
            border-radius: 12px;
            border: 1px solid var(--stroke2);
            background: rgba(255,255,255,0.04);
            color: var(--fg0);
            cursor: pointer;
            transition: all 0.15s ease;
            font-weight: 500;
        }
        .quick-btn:hover {
            transform: translateY(-2px);
            background: rgba(77,163,255,0.15);
            border-color: rgba(77,163,255,0.4);
            box-shadow: 0 8px 24px rgba(77,163,255,0.15);
        }
        .quick-btn:active { transform: translateY(0); }
        .template-row { display: flex; gap: 10px; margin-bottom: 16px; }
        .template-select {
            flex: 1;
            padding: 12px 14px;
            border-radius: 12px;
            border: 1px solid var(--stroke2);
            background: rgba(255,255,255,0.04);
            color: var(--fg0);
            font-size: 13px;
            outline: none;
            cursor: pointer;
        }
        .template-select option { background: #12141a; }
        #feedback {
            width: 100%;
            min-height: 60px;
            max-height: 300px;
            height: ${feedbackHeight}px;
            border-radius: 14px;
            border: 2px solid var(--stroke2);
            background: rgba(255,255,255,0.03);
            padding: 14px;
            color: var(--fg0);
            font-size: 14px;
            line-height: 1.6;
            resize: none;
            outline: none;
            font-family: inherit;
            transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
        }
        #feedback:focus {
            border-color: rgba(77,163,255,0.5);
            box-shadow: 0 0 0 4px rgba(77,163,255,0.1);
        }
        #feedback.dragover {
            border-color: rgba(62,207,142,0.7);
            background: rgba(62,207,142,0.08);
            box-shadow: 0 0 0 4px rgba(62,207,142,0.15);
        }
        #feedback::placeholder { color: var(--fg2); }
        .att-section {
            margin-top: 12px;
            display: none;
        }
        .att-section.show { display: block; }
        .att-title { font-size: 11px; color: var(--fg2); margin-bottom: 8px; font-weight: 600; }
        .att-list { display: flex; flex-wrap: wrap; gap: 10px; }
        .att-file {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            position: relative;
            overflow: hidden;
            padding: 8px 12px;
            background: rgba(255,255,255,0.06);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 10px;
            position: relative;
            font-size: 12px;
            color: var(--fg1);
            max-width: 220px;
        }
        .att-file .fname { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .att-file .fdel {
            width: 18px; height: 18px;
            border-radius: 50%;
            background: rgba(255,90,95,0.8);
            color: #fff;
            font-size: 12px;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            margin-left: 4px;
        }
        .att-file .fdel:hover { background: var(--danger); }
        .att-file.processing { opacity: 0.7; }
        .att-file .progress-overlay {
            position: absolute;
            left: 0; top: 0; bottom: 0;
            background: linear-gradient(90deg, rgba(62,207,142,0.3), rgba(62,207,142,0.1));
            transition: width 0.3s ease;
            z-index: 0;
        }
        .att-file .fname, .att-file .fdel { position: relative; z-index: 1; }
        .att-img {
            position: relative;
            width: 64px; height: 64px;
            border-radius: 10px;
            overflow: hidden;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .att-img img { width: 100%; height: 100%; object-fit: cover; }
        .att-img .idel {
            position: absolute;
            top: 2px; right: 2px;
            width: 18px; height: 18px;
            border-radius: 50%;
            background: rgba(255,90,95,0.9);
            color: #fff;
            font-size: 11px;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .main-actions { display: flex; gap: 12px; margin-top: 16px; align-items: center; }
        .main-btn {
            padding: 16px 20px;
            border-radius: 16px;
            border: none;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        .main-btn:hover { transform: translateY(-2px); }
        .main-btn:active { transform: translateY(0); }
        .btn-continue {
            flex: 1;
            background: linear-gradient(135deg, rgba(62,207,142,0.9), rgba(46,160,110,0.9));
            color: #fff;
            box-shadow: 0 8px 32px rgba(62,207,142,0.3);
        }
        .btn-end {
            width: 48px;
            height: 48px;
            padding: 0;
            border-radius: 50%;
            background: rgba(255,90,95,0.15);
            border: 1px solid rgba(255,90,95,0.3);
            color: var(--danger);
            font-size: 18px;
        }
        .btn-end:hover { background: rgba(255,90,95,0.25); transform: scale(1.05); }
        .btn-end:active { transform: scale(0.95); }
        .btn-continue { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
        .btn-continue:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(62,207,142,0.3); }
        .btn-continue:active { transform: translateY(0); }
        .shortcuts {
            text-align: center;
            margin-top: 14px;
            font-size: 12px;
            color: var(--fg2);
        }
        .shortcuts kbd {
            display: inline-block;
            padding: 3px 8px;
            background: rgba(255,255,255,0.06);
            border: 1px solid var(--stroke2);
            border-radius: 6px;
            font-family: inherit;
            font-size: 11px;
        }
        .code-block {
            position: relative;
            margin: 12px 12px 12px 0;
            background: #1e1e1e;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            overflow: hidden;
        }
        .code-block .code-lang {
            position: absolute;
            top: 0;
            left: 0;
            padding: 4px 10px;
            font-size: 10px;
            color: rgba(255,255,255,0.5);
            background: rgba(255,255,255,0.05);
            text-transform: uppercase;
            font-weight: 600;
            letter-spacing: 0.5px;
            border-bottom-right-radius: 6px;
            user-select: none;
            -webkit-user-select: none;
            pointer-events: none;
        }
        .code-block .code-copy {
            position: absolute;
            top: 4px;
            right: 14px;
            padding: 4px 8px;
            background: transparent;
            border: none;
            color: rgba(255,255,255,0.5);
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            z-index: 1;
        }
        .code-block .code-copy:hover {
            color: var(--accent);
        }
        .code-block .code-copy.copied {
            color: var(--success);
        }
        .code-block pre {
            margin: 0;
            padding: 28px 14px 14px;
            padding-right: 20px;
            overflow-x: auto;
            overflow-y: auto;
            max-height: 300px;
            background: transparent;
            margin-right: 8px;
        }
        .code-block code {
            font-family: 'SF Mono', 'Fira Code', 'Consolas', 'Monaco', monospace;
            font-size: 13px;
            line-height: 1.6;
            color: #d4d4d4;
            background: transparent !important;
        }
        .code-block code * {
            background: transparent !important;
        }
        .code-block code span {
            background: transparent !important;
        }
        .hl-kw { color: #c586c0; font-weight: 500; background: transparent !important; }
        .hl-str { color: #ce9178; background: transparent !important; }
        .hl-num { color: #b5cea8; background: transparent !important; }
        .hl-cmt { color: #6a9955; background: transparent !important; }
        .hl-typ { color: #4ec9b0; background: transparent !important; }
        .hl-func { color: #dcdcaa; background: transparent !important; }
        .md-link {
            color: var(--accent);
            text-decoration: none;
            border-bottom: 1px dashed rgba(77,163,255,0.4);
            cursor: pointer;
            transition: all 0.2s;
        }
        .md-link:hover {
            border-bottom-color: var(--accent);
            text-shadow: 0 0 8px rgba(77,163,255,0.3);
        }
        .md-table-wrap {
            margin: 12px 0;
            overflow-x: auto;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.15);
        }
        .md-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        .md-table th, .md-table td {
            padding: 10px 14px;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .md-table th {
            background: rgba(255,255,255,0.08);
            font-weight: 600;
            color: var(--fg0);
        }
        .md-table td {
            color: var(--fg1);
        }
        .md-table tbody tr:hover {
            background: rgba(77,163,255,0.08);
        }
        .small-btn {
            padding: 6px 10px;
            background: rgba(255,255,255,0.06);
            border: 1px solid var(--stroke2);
            border-radius: 6px;
            color: var(--fg1);
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .small-btn:hover {
            background: rgba(77,163,255,0.15);
            border-color: rgba(77,163,255,0.4);
        }
        .icon-btn {
            width: 36px;
            height: 36px;
            border-radius: 10px;
            border: 1px solid var(--stroke2);
            background: rgba(255,255,255,0.06);
            color: var(--fg1);
            font-size: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            flex-shrink: 0;
        }
        .icon-btn:hover {
            background: rgba(77,163,255,0.15);
            border-color: rgba(77,163,255,0.4);
        }
        .search-bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: rgba(0,0,0,0.3);
            border-radius: 10px;
            margin-bottom: 10px;
        }
        .search-bar input {
            flex: 1;
            background: rgba(255,255,255,0.08);
            border: 1px solid var(--stroke2);
            border-radius: 6px;
            padding: 6px 10px;
            color: var(--fg0);
            font-size: 13px;
            outline: none;
        }
        .search-bar input:focus {
            border-color: var(--accent);
        }
        .search-bar button {
            width: 28px;
            height: 28px;
            border-radius: 6px;
            border: none;
            background: rgba(255,255,255,0.08);
            color: var(--fg1);
            cursor: pointer;
            font-size: 12px;
            transition: all 0.15s;
        }
        .search-bar button:hover {
            background: rgba(77,163,255,0.2);
        }
        .search-bar #searchCount {
            font-size: 12px;
            color: var(--fg2);
            min-width: 50px;
            text-align: center;
        }
        .search-highlight {
            background: rgba(255,200,0,0.4);
            border-radius: 2px;
        }
        .search-highlight.current {
            background: rgba(255,150,0,0.7);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header glass">
            <div class="titleRow">
                <button class="icon-btn" id="searchToggle" title="搜索">🔍</button>
                <div class="titleText">
                    <h1>AI 反馈 <span style="font-size:14px;color:var(--accent);font-weight:normal;">(本次对话第${callCount}次)</span></h1>
                    <p>拖拽文件到输入框 · Ctrl+V 粘贴图片</p>
                </div>
                <div style="display:flex;gap:8px;align-items:center;margin-left:auto;">
                    <button class="small-btn" id="copyMdBtn" title="复制为Markdown">📋</button>
                </div>
            </div>
            <div class="search-bar" id="searchBar" style="display:none;">
                <input type="text" id="searchInput" placeholder="搜索关键词..." />
                <span id="searchCount"></span>
                <button id="searchPrev" title="上一个">▲</button>
                <button id="searchNext" title="下一个">▼</button>
                <button id="searchClose" title="关闭">✕</button>
            </div>
            <div class="summary-wrapper">
                <div class="summary" id="summaryBox"></div>
                <div class="resize-handle" id="summaryResize" title="拖动调整高度"><span></span><span></span><span></span></div>
            </div>
        </div>
        <div id="__data__" style="display:none;" data-summary="${summaryB64}" data-phrases="${quickPhrasesB64}" data-templates="${templatesB64}" data-round="${callCount}" data-enter="${enterToSend}"></div>

        <div class="panel glass">
            <div id="quickSection" style="display:none;">
                <div class="section-title">⚡ 快捷回复 <span style="font-size:10px;color:var(--fg2);font-weight:400">点击直接输入</span></div>
                <div class="quick-grid" id="quickGrid"></div>
            </div>
            
            <div id="templateSection" style="display:none;">
                <div class="section-title">📋 模板 <span style="font-size:10px;color:var(--fg2);font-weight:400">作为系统提示词发送给AI</span></div>
                <div class="template-row">
                    <select class="template-select" id="templateSelect">
                        <option value="">选择模板...</option>
                    </select>
                </div>
            </div>

            <div class="section-title">✏️ 反馈内容 <span style="font-size:10px;color:var(--fg2);font-weight:400">拖拽文件/图片到输入框 · Ctrl+V粘贴</span></div>
            <div class="feedback-wrapper">
                <textarea id="feedback" placeholder="输入反馈或指令..." maxlength="500000"></textarea>
                <div class="resize-handle" id="feedbackResize" title="拖动调整高度"><span></span><span></span><span></span></div>
            </div>
            
            <div class="att-section" id="imgSection">
                <div class="att-title">🖼️ 图片</div>
                <div class="att-list" id="imgList"></div>
            </div>
            
            <div class="att-section" id="fileSection">
                <div class="att-title">📄 文件</div>
                <div class="att-list" id="fileList"></div>
            </div>

            <div class="main-actions">
                <button class="main-btn btn-continue" id="btnContinue">✅ 发送</button>
                <button class="main-btn btn-end" id="btnEnd" title="结束">✕</button>
            </div>
        </div>

        <div class="shortcuts">
            <kbd>Ctrl+Enter</kbd> 发送 &nbsp;|&nbsp; <kbd>Esc</kbd> 结束
        </div>
    </div>

    <script>
        var vscode = acquireVsCodeApi();
        function __showFatal(err) {
            try {
                var msg = (err && (err.stack || err.message)) ? (err.stack || err.message) : String(err);
                var overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;';
                var box = document.createElement('div');
                box.style.cssText = 'max-width:720px;width:100%;background:var(--bg1);border:1px solid var(--stroke);border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,0.5);padding:16px 16px 12px;color:var(--fg0);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;';
                box.innerHTML = '<div style=\"font-weight:700;margin-bottom:8px;\">反馈面板脚本出错</div><div style=\"font-size:12px;white-space:pre-wrap;line-height:1.5;color:var(--fg1);\">' + (msg || '') + '</div><div style=\"display:flex;gap:10px;justify-content:flex-end;margin-top:12px;\"><button id=\"__fatal_close\" style=\"padding:8px 12px;border-radius:10px;border:1px solid var(--stroke2);background:var(--bg2);color:var(--fg0);cursor:pointer;\">关闭</button></div>';
                overlay.appendChild(box);
                document.body.appendChild(overlay);
                document.getElementById('__fatal_close').onclick = function () { try { document.body.removeChild(overlay); } catch (e) {} };
            } catch (e) {}
        }
        window.addEventListener('error', function (e) { __showFatal(e && e.error ? e.error : e); });
        function initResize(handleId, targetId, minH, maxH) {
            var handle = document.getElementById(handleId);
            var target = document.getElementById(targetId);
            if (!handle || !target) return;
            var startY, startH;
            handle.addEventListener('mousedown', function(e) {
                e.preventDefault();
                startY = e.clientY;
                startH = target.offsetHeight;
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            function onMove(e) {
                var diff = e.clientY - startY;
                var newH = Math.max(minH, Math.min(maxH, startH + diff));
                target.style.height = newH + 'px';
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
        }
        function openLink(event, url) {
            event.preventDefault();
            vscode.postMessage({ type: 'openLink', url: url });
        }
        function copyCode(btn) {
            var block = btn.parentElement;
            var encodedCode = block.getAttribute('data-code');
            var text = encodedCode ? atob(encodedCode) : (block.querySelector('code').textContent || '');
            navigator.clipboard.writeText(text).then(function() {
                btn.textContent = '✅';
                btn.classList.add('copied');
                setTimeout(function() {
                    btn.textContent = '📋';
                    btn.classList.remove('copied');
                }, 1500);
            }).catch(function() {
                var textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                btn.textContent = '✅';
                btn.classList.add('copied');
                setTimeout(function() {
                    btn.textContent = '📋';
                    btn.classList.remove('copied');
                }, 1500);
            });
        }
        (function() {
            try {
                var imageList = [];
                var fileList = [];
                var dataEl = document.getElementById('__data__');
                var b64decode = function(s) {
                    try {
                        var bin = atob(s || '');
                        var bytes = new Uint8Array(bin.length);
                        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
                        try { return decodeURIComponent(escape(bin)); } catch (e2) { return bin; }
                    } catch (e) {
                        return '';
                    }
                };
                var summaryHtml = b64decode((dataEl && dataEl.getAttribute('data-summary')) || '');
                var quickPhrases = JSON.parse(b64decode((dataEl && dataEl.getAttribute('data-phrases')) || '[]'));
                var templates = JSON.parse(b64decode((dataEl && dataEl.getAttribute('data-templates')) || '[]'));
                var currentRound = parseInt((dataEl && dataEl.getAttribute('data-round')) || '1');
                var enterToSend = (dataEl && dataEl.getAttribute('data-enter')) === 'true';

                var summaryEl = document.getElementById('summaryBox');
                if (summaryEl) {
                    summaryEl.innerHTML = summaryHtml;
                    if (!String(summaryEl.innerHTML || '').trim()) summaryEl.innerHTML = '<div style="color:var(--fg2)">暂无摘要</div>';
                }
            
                var feedbackEl = document.getElementById('feedback');
                var imgSectionEl = document.getElementById('imgSection');
                var fileSectionEl = document.getElementById('fileSection');
                var imgListEl = document.getElementById('imgList');
                var fileListEl = document.getElementById('fileList');
                var quickGridEl = document.getElementById('quickGrid');
                var templateSelectEl = document.getElementById('templateSelect');
                var quickSectionEl = document.getElementById('quickSection');
                var templateSectionEl = document.getElementById('templateSection');
                var selectedTemplate = '';
                function toast(msg) {
                    try {
                        var t = document.createElement('div');
                        t.textContent = msg || '';
                        t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(0,0,0,0.72);color:#fff;padding:10px 14px;border-radius:999px;font-size:12px;border:1px solid rgba(255,255,255,0.15);z-index:99999;max-width:90%;text-align:center;backdrop-filter:blur(10px);';
                        document.body.appendChild(t);
                        setTimeout(function(){ try{ document.body.removeChild(t); } catch(e) {} }, 1800);
                    } catch(e) {}
                }

            function initQuickPhrases() {
                if (quickPhrases.length === 0) {
                    quickSectionEl.style.display = 'none';
                    return;
                }
                quickSectionEl.style.display = 'block';
                quickGridEl.innerHTML = '';
                quickPhrases.forEach(function(text) {
                    var btn = document.createElement('button');
                    btn.className = 'quick-btn';
                    btn.textContent = text;
                    btn.addEventListener('click', function() {
                        feedbackEl.value = text;
                        feedbackEl.focus();
                    });
                    quickGridEl.appendChild(btn);
                });
            }

            function initTemplates() {
                if (templates.length === 0) {
                    templateSectionEl.style.display = 'none';
                    return;
                }
                templateSectionEl.style.display = 'block';
                templates.forEach(function(t) {
                    var opt = document.createElement('option');
                    opt.value = t.content;
                    opt.textContent = t.name;
                    templateSelectEl.appendChild(opt);
                });
            }

            templateSelectEl.addEventListener('change', function() {
                selectedTemplate = this.value;
            });

            var searchToggle = document.getElementById('searchToggle');
            var searchBar = document.getElementById('searchBar');
            var searchInput = document.getElementById('searchInput');
            var searchCount = document.getElementById('searchCount');
            var searchPrev = document.getElementById('searchPrev');
            var searchNext = document.getElementById('searchNext');
            var searchClose = document.getElementById('searchClose');
            var searchMatches = [];
            var currentMatchIdx = -1;
            var originalSummaryHtml = summaryEl.innerHTML;

            searchToggle.addEventListener('click', function() {
                if (searchBar.style.display === 'none') {
                    searchBar.style.display = 'flex';
                    searchInput.focus();
                } else {
                    closeSearch();
                }
            });

            searchClose.addEventListener('click', closeSearch);

            function closeSearch() {
                searchBar.style.display = 'none';
                searchInput.value = '';
                clearHighlights();
                searchCount.textContent = '';
            }

            function clearHighlights() {
                summaryEl.innerHTML = originalSummaryHtml;
                searchMatches = [];
                currentMatchIdx = -1;
            }

            searchInput.addEventListener('input', function() {
                var query = this.value.trim();
                if (!query) {
                    clearHighlights();
                    return;
                }
                highlightMatches(query);
            });

            function highlightMatches(query) {
                summaryEl.innerHTML = originalSummaryHtml;
                var text = summaryEl.innerHTML;
                var specialChars = /[.*+?^$\{}()|[\\]\\\\]/g;
                var escaped = query.replace(specialChars, '\\\\$&');
                var regex = new RegExp('(' + escaped + ')', 'gi');
                var count = 0;
                text = text.replace(regex, function(match) {
                    count++;
                    return '<mark class="search-highlight" data-idx="' + (count-1) + '">' + match + '</mark>';
                });
                summaryEl.innerHTML = text;
                searchMatches = summaryEl.querySelectorAll('.search-highlight');
                currentMatchIdx = searchMatches.length > 0 ? 0 : -1;
                updateSearchCount();
                scrollToMatch();
            }

            function updateSearchCount() {
                if (searchMatches.length === 0) {
                    searchCount.textContent = '无结果';
                } else {
                    searchCount.textContent = (currentMatchIdx + 1) + '/' + searchMatches.length;
                }
            }

            function scrollToMatch() {
                searchMatches.forEach(function(m, i) {
                    m.classList.remove('current');
                    if (i === currentMatchIdx) m.classList.add('current');
                });
                if (currentMatchIdx >= 0 && searchMatches[currentMatchIdx]) {
                    searchMatches[currentMatchIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }

            searchPrev.addEventListener('click', function() {
                if (searchMatches.length === 0) return;
                currentMatchIdx = (currentMatchIdx - 1 + searchMatches.length) % searchMatches.length;
                updateSearchCount();
                scrollToMatch();
            });

            searchNext.addEventListener('click', function() {
                if (searchMatches.length === 0) return;
                currentMatchIdx = (currentMatchIdx + 1) % searchMatches.length;
                updateSearchCount();
                scrollToMatch();
            });

            searchInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) searchPrev.click();
                    else searchNext.click();
                } else if (e.key === 'Escape') {
                    closeSearch();
                }
            });

            function parseMarkdownClient(text) {
                var html = text;
                var tables = [];
                html = html.replace(/(\|.+\|[\r\n]+\|[-:\| ]+\|[\r\n]+((\|.+\|[\r\n]*)+))/g, function(m) {
                    var idx = tables.length;
                    var lines = m.trim().split(/[\r\n]+/);
                    if (lines.length < 2) return m;
                    var headerCells = lines[0].split('|').filter(function(c) { return c.trim(); });
                    var rows = lines.slice(2);
                    var tableHtml = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
                    headerCells.forEach(function(c) { tableHtml += '<th>' + c.trim().replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\`([^\`]+)\`/g, '<code>$1</code>') + '</th>'; });
                    tableHtml += '</tr></thead><tbody>';
                    rows.forEach(function(row) {
                        var cells = row.split('|').filter(function(c) { return c.trim() !== ''; });
                        if (cells.length > 0) {
                            tableHtml += '<tr>';
                            cells.forEach(function(c) { tableHtml += '<td>' + c.trim().replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\`([^\`]+)\`/g, '<code>$1</code>') + '</td>'; });
                            tableHtml += '</tr>';
                        }
                    });
                    tableHtml += '</tbody></table></div>';
                    tables.push(tableHtml);
                    return '%%TABLE' + idx + '%%';
                });
                
                html = html.replace(/\$\$([^$]+)\$\$/g, '<div class="katex-block">$1</div>');
                html = html.replace(/\$([^$\n]+)\$/g, '<span class="katex-inline">$1</span>');
                html = html.replace(/\`\`\`(\w*)\n?([\s\S]*?)\`\`\`/g, function(m, lang, code) {
                    var langLabel = lang ? '<span class="code-lang">' + lang + '</span>' : '';
                    var escaped = code.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    var encodedCode = btoa(unescape(encodeURIComponent(code.trim())));
                    return '<div class="code-block" data-code="' + encodedCode + '">' + langLabel + '<button class="code-copy" onclick="copyCode(this)" title="复制代码">📋</button><pre><code>' + escaped + '</code></pre></div>';
                });
                html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link" title="$2">$1</a>');
                html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" class="md-link" title="$1">$1</a>');
                html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:600;margin:12px 0 8px;color:var(--fg0);">$1</h3>');
                html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:15px;font-weight:600;margin:14px 0 10px;color:var(--fg0);">$1</h2>');
                html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:16px;font-weight:700;margin:16px 0 12px;color:var(--fg0);">$1</h1>');
                html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--fg0);">$1</strong>');
                html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
                html = html.replace(/\`([^\`]+)\`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;font-size:12px;">$1</code>');
                html = html.replace(/^- (.+)$/gm, '<div style="display:flex;gap:8px;margin:6px 0;"><span style="color:var(--accent);">•</span><span>$1</span></div>');
                html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:12px 0;">');
                html = html.replace(/\n\n/g, '</p><p style="margin:8px 0;">');
                html = html.replace(/\n/g, '<br>');
                tables.forEach(function(t, i) { html = html.replace('%%TABLE' + i + '%%', t); });
                return '<p style="margin:8px 0;">' + html + '</p>';
            }
            function renderKatex() {
                if (typeof katex !== 'undefined') {
                    document.querySelectorAll('.katex-block').forEach(function(el) {
                        if (!el.classList.contains('katex-rendered')) {
                            try { katex.render(el.textContent, el, { throwOnError: false, displayMode: true }); el.classList.add('katex-rendered'); } catch(e) {}
                        }
                    });
                    document.querySelectorAll('.katex-inline').forEach(function(el) {
                        if (!el.classList.contains('katex-rendered')) {
                            try { katex.render(el.textContent, el, { throwOnError: false, displayMode: false }); el.classList.add('katex-rendered'); } catch(e) {}
                        }
                    });
                }
            }

            function renderImages() {
                imgSectionEl.className = 'att-section' + (imageList.length > 0 ? ' show' : '');
                imgListEl.innerHTML = '';
                imageList.forEach(function (img, idx) {
                    var div = document.createElement('div');
                    div.className = 'att-img';
                    var imgEl = document.createElement('img');
                    imgEl.src = img.data;
                    div.appendChild(imgEl);
                    var del = document.createElement('button');
                    del.className = 'idel';
                    del.textContent = '×';
                    del.onclick = function () {
                        imageList.splice(idx, 1);
                        renderImages();
                    };
                    div.appendChild(del);
                    imgListEl.appendChild(div);
                });
            }
            function renderFiles() {
                fileSectionEl.className = 'att-section' + (fileList.length > 0 ? ' show' : '');
                fileListEl.innerHTML = '';
                fileList.forEach(function (f, idx) {
                    var div = document.createElement('div');
                    div.className = 'att-file' + (f.processing ? ' processing' : '');
                    if (f.processing) {
                        var progress = document.createElement('div');
                        progress.className = 'progress-overlay';
                        progress.style.width = (f.progress || 0) + '%';
                        div.appendChild(progress);
                    }
                    var name = document.createElement('span');
                    name.className = 'fname';
                    name.textContent = f.processing ? f.name + ' (' + (f.progress || 0) + '%)' : f.name;
                    name.title = f.name;
                    div.appendChild(name);
                    var del = document.createElement('button');
                    del.className = 'fdel';
                    del.textContent = '×';
                    del.onclick = function () {
                        fileList.splice(idx, 1);
                        renderFiles();
                    };
                    div.appendChild(del);
                    fileListEl.appendChild(div);
                });
            }
            function compressImage(dataUrl, maxWidth, quality, callback) {
                var img = new Image();
                img.onload = function () {
                    var canvas = document.createElement('canvas');
                    var w = img.width, h = img.height;
                    if (w > maxWidth) {
                        h = h * maxWidth / w;
                        w = maxWidth;
                    }
                    canvas.width = w;
                    canvas.height = h;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    callback(canvas.toDataURL('image/jpeg', quality));
                };
                img.src = dataUrl;
            }
            function addImage(file) {
                var reader = new FileReader();
                reader.onload = function (e) {
                    var dataUrl = e.target.result;
                    if (file.size > 500000) {
                        compressImage(dataUrl, 1200, 0.8, function (compressed) {
                            imageList.push({ name: file.name, data: compressed, type: 'image/jpeg', size: compressed.length });
                            renderImages();
                        });
                    }
                    else {
                        imageList.push({ name: file.name, data: dataUrl, type: file.type, size: file.size });
                        renderImages();
                    }
                };
                reader.readAsDataURL(file);
            }
            function addFile(file) {
                var maxSize = 15 * 1024 * 1024;
                if (file.size > maxSize) {
                    toast('文件过大（最大 15MB）');
                    return;
                }
                var ext = (file.name || '').toLowerCase();
                var needsProcessing = ext.endsWith('.pdf') || ext.endsWith('.xlsx') || ext.endsWith('.xls') || ext.endsWith('.docx') || ext.endsWith('.doc');
                var fileObj = { name: file.name, path: file.path || '', type: file.type || '', size: file.size || 0, processing: needsProcessing && (file instanceof File), progress: 0, data: '' };
                fileList.push(fileObj);
                renderFiles();
                if (needsProcessing && file instanceof File) {
                    var idx = fileList.length - 1;
                    var reader = new FileReader();
                    reader.onprogress = function (e) {
                        if (e.lengthComputable && fileList[idx]) {
                            fileList[idx].progress = Math.floor((e.loaded / e.total) * 100);
                            renderFiles();
                        }
                    };
                    reader.onload = function (e) {
                        if (fileList[idx]) {
                            fileList[idx].data = e.target.result;
                            fileList[idx].processing = false;
                            fileList[idx].progress = 100;
                            renderFiles();
                        }
                    };
                    reader.onerror = function () {
                        if (fileList[idx]) {
                            fileList[idx].processing = false;
                            fileList[idx].progress = 100;
                            renderFiles();
                        }
                    };
                    reader.readAsDataURL(file);
                }
            }
            function isImageFile(file) {
                if (file.type && file.type.startsWith('image/')) return true;
                var name = (file.name || '').toLowerCase();
                var imgExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.heic'];
                for (var i = 0; i < imgExts.length; i++) {
                    if (name.endsWith(imgExts[i])) return true;
                }
                return false;
            }
            function handleDrop(files) {
                if (!files || files.length === 0) return;
                for (var i = 0; i < files.length; i++) {
                    var f = files[i];
                    if (isImageFile(f)) addImage(f);
                    else addFile(f);
                }
            }
            var dragCount = 0;
            document.body.addEventListener('dragenter', function (e) {
                e.preventDefault();
                dragCount++;
                feedbackEl.classList.add('dragover');
            });
            document.body.addEventListener('dragleave', function (e) {
                e.preventDefault();
                dragCount--;
                if (dragCount <= 0) {
                    dragCount = 0;
                    feedbackEl.classList.remove('dragover');
                }
            });
            document.body.addEventListener('dragover', function (e) { e.preventDefault(); });
            document.body.addEventListener('drop', function (e) {
                e.preventDefault();
                dragCount = 0;
                feedbackEl.classList.remove('dragover');
                processDropEvent(e);
            });
            function processDropEvent(e) {
                if (!e.dataTransfer) return;
                var hasFile = false;
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    for (var i = 0; i < e.dataTransfer.files.length; i++) {
                        var f = e.dataTransfer.files[i];
                        if (isImageFile(f)) addImage(f);
                        else addFile(f);
                        hasFile = true;
                    }
                }
                if (!hasFile && e.dataTransfer.items) {
                    for (var j = 0; j < e.dataTransfer.items.length; j++) {
                        var item = e.dataTransfer.items[j];
                        if (item.kind === 'file') {
                            var file = item.getAsFile();
                            if (file) {
                                if (isImageFile(file)) addImage(file);
                                else addFile(file);
                                hasFile = true;
                            }
                        }
                    }
                }
                if (!hasFile) {
                    var textData = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text');
                    if (textData) {
                        var lines = textData.trim().split(/[\\r\\n]+/);
                        for (var k = 0; k < lines.length; k++) {
                            var line = lines[k].trim();
                            if (!line) continue;
                            var path = line;
                            if (line.indexOf('file:///') === 0) path = decodeURIComponent(line.substring(8));
                            else if (line.indexOf('file://') === 0) path = decodeURIComponent(line.substring(7));
                            path = path.replace(/\\\\/g, '/');
                            var name = path.split('/').pop() || path;
                            if (name && name.indexOf('.') > 0) {
                                fileList.push({ name: name, path: path, type: '', size: 0 });
                                renderFiles();
                            }
                        }
                    }
                }
            }
            document.addEventListener('paste', function (e) {
                if (!e.clipboardData || !e.clipboardData.items) return;
                var dominated = false;
                for (var i = 0; i < e.clipboardData.items.length; i++) {
                    var item = e.clipboardData.items[i];
                    if (item.kind === 'file') {
                        var f = item.getAsFile();
                        if (f) {
                            if (isImageFile(f)) addImage(f);
                            else addFile(f);
                            dominated = true;
                        }
                    }
                }
                if (dominated) e.preventDefault();
            });
            function submit(action) {
                var processingFiles = fileList.filter(function (f) { return f.processing; });
                if (processingFiles.length > 0 && action !== 'end') {
                    toast('文件处理中，请稍后再发送');
                    return;
                }
                vscode.postMessage({
                    type: 'submit',
                    feedback: feedbackEl.value,
                    action: action,
                    images: imageList,
                    filePaths: fileList.map(function (f) { return f.path || f.name; }),
                    fileData: fileList.filter(function (f) { return f.data; }).map(function (f) { return { name: f.name, data: f.data }; }),
                    systemPrompt: selectedTemplate
                });
            }
            document.getElementById('btnContinue').addEventListener('click', function () { submit('continue'); });
            document.getElementById('btnEnd').addEventListener('click', function () { showEndConfirm(); });
            function showEndConfirm() {
                var overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px);';
                var modal = document.createElement('div');
                modal.style.cssText = 'background:var(--bg1);border:1px solid var(--stroke);border-radius:16px;padding:24px;max-width:300px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.3);';
                modal.innerHTML = '<div style="font-size:16px;font-weight:600;margin-bottom:12px;color:var(--fg);">确定要结束对话吗？</div><div style="font-size:13px;color:var(--fg2);margin-bottom:20px;">AI将停止当前任务</div><div style="display:flex;gap:12px;justify-content:center;"><button id="confirmCancel" style="padding:10px 20px;border-radius:10px;border:1px solid var(--stroke);background:var(--bg2);color:var(--fg);cursor:pointer;font-size:14px;">取消</button><button id="confirmEnd" style="padding:10px 20px;border-radius:10px;border:none;background:rgba(255,90,95,0.9);color:#fff;cursor:pointer;font-size:14px;font-weight:600;">结束</button></div>';
                overlay.appendChild(modal);
                document.body.appendChild(overlay);
                document.getElementById('confirmCancel').onclick = function () { document.body.removeChild(overlay); };
                document.getElementById('confirmEnd').onclick = function () { document.body.removeChild(overlay); submit('end'); };
                overlay.onclick = function (e) { if (e.target === overlay) document.body.removeChild(overlay); };
            }
            document.addEventListener('keydown', function (e) {
                if (e.ctrlKey && e.key === 'c') {
                    // copy logic
                    return;
                }
                if (e.ctrlKey && e.key === 'Enter') {
                    e.preventDefault();
                    submit('continue');
                }
                else if (enterToSend && e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && document.activeElement === feedbackEl) {
                    e.preventDefault();
                    submit('continue');
                }
                else if (e.key === 'Escape') {
                    e.preventDefault();
                    showEndConfirm();
                }
            });
            window.addEventListener('message', function (e) {
                if (e.data && e.data.type === 'setFeedback') {
                    feedbackEl.value = e.data.text;
                    feedbackEl.focus();
                }
            });
            initQuickPhrases();
            initTemplates();
            feedbackEl.focus();
            document.getElementById('copyMdBtn').addEventListener('click', function () {
                var markdown = dataEl.getAttribute('data-summary');
                if (markdown) {
                    try { markdown = decodeURIComponent(escape(atob(markdown))); } catch(e) { markdown = atob(markdown); }
                }
                navigator.clipboard.writeText(markdown || '').then(function () {
                    var btn = document.getElementById('copyMdBtn');
                    btn.textContent = '✅';
                    setTimeout(function () { btn.textContent = '📋'; }, 1500);
                });
            });
            if (typeof katex !== 'undefined') {
                document.querySelectorAll('.katex-block').forEach(function (el) {
                    try { katex.render(el.textContent, el, { throwOnError: false, displayMode: true }); } catch (e) { }
                });
                document.querySelectorAll('.katex-inline').forEach(function (el) {
                    try { katex.render(el.textContent, el, { throwOnError: false, displayMode: false }); } catch (e) { }
                });
            }
            initResize('summaryResize', 'summaryBox', 80, 600);
            initResize('feedbackResize', 'feedback', 60, 300);
            } catch (e) {
                __showFatal(e);
                try {
                    var btnC = document.getElementById('btnContinue');
                    var btnE = document.getElementById('btnEnd');
                    if (btnC) btnC.addEventListener('click', function () {
                        var fb = document.getElementById('feedback');
                        vscode.postMessage({ type: 'submit', feedback: fb ? fb.value : '', action: 'continue', images: [], filePaths: [], fileData: [], systemPrompt: '' });
                    });
                    if (btnE) btnE.addEventListener('click', function () {
                        var fb2 = document.getElementById('feedback');
                        vscode.postMessage({ type: 'submit', feedback: fb2 ? fb2.value : '', action: 'end', images: [], filePaths: [], fileData: [], systemPrompt: '' });
                    });
                } catch (e2) {}
            }
        })();
    </script>
</body>
</html>`;
  }

  public async formatFeedbackResult(result: FeedbackResult): Promise<string> {
    let text = `## User Feedback\n\n`;
    text += `**Action**: ${result.action}\n\n`;

    if (result.feedback) {
      text += `**Feedback**:\n${result.feedback}\n\n`;
    }

    if (result.images && result.images.length > 0) {
      text += `**Images**: ${result.images.length} image(s) attached\n\n`;
    }

    if (result.fileData && result.fileData.length > 0) {
      text += `**Files**: ${result.fileData.length} file(s) attached\n`;
      for (let i = 0; i < result.fileData.length; i++) {
        const f = result.fileData[i];
        text += `- File ${i + 1}: \`${f.name}\`\n`;
        const ext = f.name.toLowerCase();
        if ((ext.endsWith('.xlsx') || ext.endsWith('.xls')) && xlsx && f.data) {
          try {
            const base64Data = f.data.replace(/^data:[^;]+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const workbook = xlsx.read(buffer, { type: 'buffer' });
            let excelContent = '';
            for (const sheetName of workbook.SheetNames) {
              const sheet = workbook.Sheets[sheetName];
              const csv = xlsx.utils.sheet_to_csv(sheet);
              excelContent += `\n--- Sheet: ${sheetName} ---\n${csv}\n`;
            }
            text += `\n**Excel Content:**\n\`\`\`\n${excelContent.substring(0, 200000)}\n\`\`\`\n`;
          } catch (e) {
            text += `  (Excel解析失败: ${e})\n`;
          }
        } else if ((ext.endsWith('.docx') || ext.endsWith('.doc')) && mammoth && f.data) {
          try {
            const base64Data = f.data.replace(/^data:[^;]+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const res = await mammoth.convertToHtml({ buffer });
            const htmlContent = res.value || '';
            const textContent = htmlContent
              .replace(/<[^>]+>/g, '\n')
              .replace(/\n{3,}/g, '\n\n')
              .trim();
            text += `\n**Word Content:**\n${textContent.substring(0, 200000)}\n`;
          } catch (e) {
            text += `  (Word解析失败: ${e})\n`;
          }
        } else if (f.data) {
          text += `  (文件已附加)\n`;
        }
      }
      text += `\n`;
    } else if (result.filePaths && result.filePaths.length > 0) {
      text += `**Files**: ${result.filePaths.length} file(s) attached\n`;
      for (let i = 0; i < result.filePaths.length; i++) {
        text += `- File ${i + 1}: \`${result.filePaths[i]}\`\n`;
      }
      text += `\n`;
    }

    if (result.action === 'continue') {
      text += `\n---\n## ⚠️ MANDATORY NEXT STEP\n\n**You MUST call \`${this._toolName}\` again after processing this feedback.**\n\nThis is NOT optional. The feedback loop continues until user clicks "End".\n\n1. Process the user feedback above\n2. Make any requested changes\n3. Call \`${this._toolName}\` with a summary of what you did\n\n**DO NOT SKIP THIS STEP.**\n`;
    } else if (result.action === 'pause') {
      text += `\n---\n## ⏸️ PAUSED\n\n**User wants to pause.** Wait for user to initiate the next action. Do not call any tools until user sends a new message.\n`;
    } else {
      text += `\n---\n## 🛑 CONVERSATION ENDED\n\n**User wants to end.** Stop immediately. Do NOT call any more tools. The conversation is complete.\n`;
    }

    return text;
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private parseTableCell(text: string): string {
    let result = this.escapeHtml(text);
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
    result = result.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;font-size:11px;">$1</code>');
    return result;
  }

  private highlightCode(code: string, lang: string): string {
    const keywords: Record<string, string[]> = {
        'javascript': ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class', 'extends', 'import', 'export', 'default', 'from', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'null', 'undefined', 'true', 'false', 'in', 'of'],
        'typescript': ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class', 'extends', 'import', 'export', 'default', 'from', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'null', 'undefined', 'true', 'false', 'in', 'of', 'interface', 'type', 'enum', 'implements', 'private', 'public', 'protected', 'readonly', 'static', 'abstract', 'as', 'is'],
        'python': ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'pass', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'yield', 'global', 'nonlocal', 'assert', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'async', 'await'],
        'java': ['public', 'private', 'protected', 'class', 'interface', 'extends', 'implements', 'static', 'final', 'void', 'int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'super', 'try', 'catch', 'finally', 'throw', 'throws', 'import', 'package', 'null', 'true', 'false', 'instanceof', 'abstract', 'synchronized'],
        'cpp': ['int', 'long', 'double', 'float', 'char', 'bool', 'void', 'class', 'struct', 'enum', 'union', 'public', 'private', 'protected', 'virtual', 'static', 'const', 'constexpr', 'inline', 'template', 'typename', 'namespace', 'using', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'delete', 'this', 'try', 'catch', 'throw', 'nullptr', 'true', 'false', 'include', 'define', 'ifdef', 'ifndef', 'endif', 'std', 'cout', 'cin', 'endl', 'string', 'vector', 'auto'],
        'c': ['int', 'long', 'double', 'float', 'char', 'void', 'struct', 'enum', 'union', 'static', 'const', 'extern', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'sizeof', 'typedef', 'NULL', 'include', 'define', 'ifdef', 'ifndef', 'endif'],
        'go': ['func', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'break', 'continue', 'go', 'defer', 'select', 'chan', 'map', 'struct', 'interface', 'package', 'import', 'const', 'var', 'type', 'nil', 'true', 'false', 'make', 'new', 'append', 'len', 'cap'],
        'rust': ['fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait', 'pub', 'mod', 'use', 'return', 'if', 'else', 'for', 'while', 'loop', 'match', 'break', 'continue', 'move', 'ref', 'self', 'Self', 'true', 'false', 'Some', 'None', 'Ok', 'Err', 'async', 'await', 'where', 'type', 'unsafe', 'extern', 'crate'],
        'sql': ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'ORDER', 'BY', 'GROUP', 'HAVING', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AS', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'DROP', 'ALTER', 'INDEX', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'NULL', 'NOT', 'DISTINCT', 'LIMIT', 'OFFSET', 'UNION', 'ALL'],
        'html': ['html', 'head', 'body', 'div', 'span', 'p', 'a', 'img', 'table', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'form', 'input', 'button', 'select', 'option', 'script', 'style', 'link', 'meta', 'title', 'header', 'footer', 'nav', 'section', 'article', 'aside', 'main'],
        'css': ['color', 'background', 'border', 'margin', 'padding', 'width', 'height', 'display', 'flex', 'grid', 'position', 'top', 'left', 'right', 'bottom', 'font', 'text', 'align', 'justify', 'transform', 'transition', 'animation', 'opacity', 'visibility', 'overflow'],
        'json': ['true', 'false', 'null'],
        'bash': ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'exit', 'echo', 'read', 'export', 'source', 'cd', 'pwd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'grep', 'sed', 'awk', 'chmod', 'chown', 'sudo', 'apt', 'yum', 'npm', 'pip', 'git'],
        'shell': ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'exit', 'echo', 'read', 'export', 'source', 'cd', 'pwd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'grep', 'sed', 'awk'],
        'ruby': ['def', 'end', 'class', 'module', 'if', 'elsif', 'else', 'unless', 'case', 'when', 'while', 'until', 'for', 'do', 'begin', 'rescue', 'ensure', 'raise', 'return', 'yield', 'self', 'super', 'nil', 'true', 'false', 'and', 'or', 'not', 'in', 'then', 'attr_accessor', 'attr_reader', 'attr_writer', 'require', 'include', 'extend', 'private', 'public', 'protected'],
        'kotlin': ['fun', 'val', 'var', 'class', 'interface', 'object', 'if', 'else', 'when', 'for', 'while', 'do', 'return', 'break', 'continue', 'throw', 'try', 'catch', 'finally', 'import', 'package', 'as', 'is', 'in', 'out', 'null', 'true', 'false', 'this', 'super', 'override', 'open', 'final', 'abstract', 'sealed', 'data', 'enum', 'companion', 'suspend', 'inline', 'crossinline', 'noinline', 'reified', 'lateinit', 'by', 'init', 'constructor', 'private', 'public', 'protected', 'internal'],
        'swift': ['func', 'let', 'var', 'class', 'struct', 'enum', 'protocol', 'extension', 'if', 'else', 'guard', 'switch', 'case', 'default', 'for', 'while', 'repeat', 'return', 'break', 'continue', 'throw', 'throws', 'try', 'catch', 'do', 'import', 'as', 'is', 'in', 'nil', 'true', 'false', 'self', 'Self', 'super', 'override', 'final', 'open', 'public', 'private', 'fileprivate', 'internal', 'static', 'lazy', 'weak', 'unowned', 'mutating', 'inout', 'some', 'any', 'async', 'await', 'actor'],
        'php': ['function', 'class', 'interface', 'trait', 'extends', 'implements', 'public', 'private', 'protected', 'static', 'final', 'abstract', 'const', 'var', 'if', 'else', 'elseif', 'switch', 'case', 'default', 'for', 'foreach', 'while', 'do', 'return', 'break', 'continue', 'throw', 'try', 'catch', 'finally', 'new', 'echo', 'print', 'require', 'include', 'use', 'namespace', 'null', 'true', 'false', 'array', 'isset', 'empty', 'unset'],
        'csharp': ['class', 'interface', 'struct', 'enum', 'namespace', 'using', 'public', 'private', 'protected', 'internal', 'static', 'readonly', 'const', 'virtual', 'override', 'abstract', 'sealed', 'partial', 'async', 'await', 'if', 'else', 'switch', 'case', 'default', 'for', 'foreach', 'while', 'do', 'return', 'break', 'continue', 'throw', 'try', 'catch', 'finally', 'new', 'this', 'base', 'null', 'true', 'false', 'var', 'void', 'int', 'long', 'float', 'double', 'bool', 'string', 'object', 'get', 'set', 'value', 'where', 'select', 'from', 'in', 'out', 'ref', 'params'],
        'scala': ['def', 'val', 'var', 'class', 'object', 'trait', 'extends', 'with', 'if', 'else', 'match', 'case', 'for', 'while', 'do', 'return', 'yield', 'throw', 'try', 'catch', 'finally', 'import', 'package', 'type', 'this', 'super', 'null', 'true', 'false', 'new', 'override', 'final', 'abstract', 'sealed', 'private', 'protected', 'implicit', 'lazy'],
        'lua': ['function', 'local', 'if', 'then', 'else', 'elseif', 'end', 'for', 'while', 'do', 'repeat', 'until', 'return', 'break', 'in', 'and', 'or', 'not', 'nil', 'true', 'false', 'require', 'module'],
        'r': ['function', 'if', 'else', 'for', 'while', 'repeat', 'in', 'next', 'break', 'return', 'TRUE', 'FALSE', 'NULL', 'NA', 'Inf', 'NaN', 'library', 'require', 'source'],
        'dart': ['class', 'abstract', 'extends', 'implements', 'mixin', 'with', 'if', 'else', 'switch', 'case', 'default', 'for', 'while', 'do', 'return', 'break', 'continue', 'throw', 'try', 'catch', 'finally', 'async', 'await', 'import', 'export', 'library', 'part', 'typedef', 'var', 'final', 'const', 'static', 'void', 'null', 'true', 'false', 'this', 'super', 'new', 'get', 'set', 'late', 'required'],
        'yaml': ['true', 'false', 'null', 'yes', 'no', 'on', 'off'],
        'xml': ['xml', 'version', 'encoding', 'xmlns'],
        'markdown': [],
    };
    const aliasMap: Record<string, string> = { 'js': 'javascript', 'ts': 'typescript', 'py': 'python', 'sh': 'bash', 'c++': 'cpp', 'jsx': 'javascript', 'tsx': 'typescript', 'rb': 'ruby', 'kt': 'kotlin', 'cs': 'csharp', 'md': 'markdown', 'yml': 'yaml' };
    const resolvedLang = aliasMap[lang] || lang;
    const langKeywords = keywords[resolvedLang] || [];
    const tokens: { type: string; value: string }[] = [];
    const lines = code.split('\n');
    for (const line of lines) {
        let remaining = line;
        let lineTokens: { type: string; value: string }[] = [];
        const commentMatch = resolvedLang === 'python' || resolvedLang === 'bash' || resolvedLang === 'shell'
            ? remaining.match(/^(.*?)(#.*)$/)
            : remaining.match(/^(.*?)(\/\/.*)$/);
        if (commentMatch) {
            remaining = commentMatch[1];
            lineTokens.push({ type: 'comment', value: commentMatch[2] });
        }
        const parts = remaining.split(/(\s+|[{}()\[\];,.:+\-*/%=<>!&|^~?])/g);
        for (const part of parts) {
            if (!part) continue;
            if (/^\s+$/.test(part)) {
                tokens.push({ type: 'plain', value: part });
            }
            else if (/^["'].*["']$/.test(part) || /^`.*`$/.test(part)) {
                tokens.push({ type: 'string', value: part });
            }
            else if (/^f["']/.test(part) || /^["']/.test(part)) {
                tokens.push({ type: 'string', value: part });
            }
            else if (/^\d+\.?\d*$/.test(part)) {
                tokens.push({ type: 'number', value: part });
            }
            else if (langKeywords.includes(part)) {
                tokens.push({ type: 'keyword', value: part });
            }
            else if (/^[A-Z][a-zA-Z0-9_]*$/.test(part)) {
                tokens.push({ type: 'type', value: part });
            }
            else {
                tokens.push({ type: 'plain', value: part });
            }
        }
        for (const t of lineTokens) {
            tokens.push(t);
        }
        tokens.push({ type: 'plain', value: '\n' });
    }
    let result = '';
    for (const token of tokens) {
        const escaped = this.escapeHtml(token.value);
        switch (token.type) {
            case 'keyword':
                result += `<span class="hl-kw">${escaped}</span>`;
                break;
            case 'string':
                result += `<span class="hl-str">${escaped}</span>`;
                break;
            case 'number':
                result += `<span class="hl-num">${escaped}</span>`;
                break;
            case 'comment':
                result += `<span class="hl-cmt">${escaped}</span>`;
                break;
            case 'type':
                result += `<span class="hl-typ">${escaped}</span>`;
                break;
            default: result += escaped;
        }
    }
    return result;
  }

  private parseMarkdown(text: string): string {
    let html = text;
    const codeBlocks: string[] = [];
    const tables: string[] = [];
    const mathBlocks: string[] = [];
    const links: string[] = [];

    // Math
    html = html.replace(/\$\$([^$]+)\$\$/g, (_match, formula) => {
        const idx = mathBlocks.length;
        mathBlocks.push(`<div class="katex-block">${this.escapeHtml(formula.trim())}</div>`);
        return `%%MATH${idx}%%`;
    });
    html = html.replace(/\$([^$\n]+)\$/g, (_match, formula) => {
        const idx = mathBlocks.length;
        mathBlocks.push(`<span class="katex-inline">${this.escapeHtml(formula.trim())}</span>`);
        return `%%MATH${idx}%%`;
    });

    // Code blocks
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
        const idx = codeBlocks.length;
        const rawCode = code.trim();
        const highlightedCode = this.highlightCode(rawCode, lang.toLowerCase());
        const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
        const encodedCode = Buffer.from(rawCode).toString('base64');
        codeBlocks.push(`<div class="code-block" data-code="${encodedCode}">${langLabel}<button class="code-copy" onclick="copyCode(this)" title="复制代码">📋</button><pre><code>${highlightedCode}</code></pre></div>`);
        return `%%CODEBLOCK${idx}%%`;
    });

    // Tables
    html = html.replace(/(\|[^\n]+\|\n)((?:\|[-:| ]+\|\n))(\|[^\n]+\|\n?)+/g, (match) => {
        const idx = tables.length;
        const lines = match.trim().split('\n');
        if (lines.length < 2) return match;
        const headerCells = lines[0].split('|').filter(c => c.trim());
        const alignLine = lines[1];
        const aligns = alignLine.split('|').filter(c => c.trim()).map(c => {
            c = c.trim();
            if (c.startsWith(':') && c.endsWith(':')) return 'center';
            if (c.endsWith(':')) return 'right';
            return 'left';
        });
        let tableHtml = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
        headerCells.forEach((cell, i) => {
            tableHtml += `<th style="text-align:${aligns[i] || 'left'}">${this.parseTableCell(cell.trim())}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';
        for (let i = 2; i < lines.length; i++) {
            const cells = lines[i].split('|').filter(c => c.trim());
            tableHtml += '<tr>';
            cells.forEach((cell, j) => {
                tableHtml += `<td style="text-align:${aligns[j] || 'left'}">${this.parseTableCell(cell.trim())}</td>`;
            });
            tableHtml += '</tr>';
        }
        tableHtml += '</tbody></table></div>';
        tables.push(tableHtml);
        return `%%TABLE${idx}%%`;
    });

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
        const idx = links.length;
        links.push(`<a href="${this.escapeHtml(url)}" class="md-link" onclick="openLink(event,'${url.replace(/'/g, "\\'")}');" title="${this.escapeHtml(url)}">${this.escapeHtml(text)}</a>`);
        return `%%MDLINK${idx}%%`;
    });
    html = html.replace(/(https?:\/\/[^\s<\]\)]+)/g, (_match, url) => {
        const idx = links.length;
        links.push(`<a href="${this.escapeHtml(url)}" class="md-link" onclick="openLink(event,'${url.replace(/'/g, "\\'")}');" title="${this.escapeHtml(url)}">${this.escapeHtml(url)}</a>`);
        return `%%MDLINK${idx}%%`;
    });

    // Headers and Formatting
    html = html.replace(/^#### (.+)$/gm, '%%H4%%$1%%/H4%%');
    html = html.replace(/^### (.+)$/gm, '%%H3%%$1%%/H3%%');
    html = html.replace(/^## (.+)$/gm, '%%H2%%$1%%/H2%%');
    html = html.replace(/^# (.+)$/gm, '%%H1%%$1%%/H1%%');
    html = html.replace(/\*\*(.+?)\*\*/g, '%%B%%$1%%/B%%');
    html = html.replace(/\*(.+?)\*/g, '%%I%%$1%%/I%%');
    html = html.replace(/`([^`]+)`/g, '%%C%%$1%%/C%%');
    html = html.replace(/^(\d+)\. (.+)$/gm, '%%OL%%$1%%D%%$2%%/OL%%');
    html = html.replace(/^- (.+)$/gm, '%%UL%%$1%%/UL%%');
    html = html.replace(/^---$/gm, '%%HR%%');

    html = this.escapeHtml(html);

    // Restore
    html = html.replace(/%%H4%%(.+?)%%\/H4%%/g, '<h4 style="font-size:13px;font-weight:600;margin:10px 0 6px;color:var(--fg0);">$1</h4>');
    html = html.replace(/%%H3%%(.+?)%%\/H3%%/g, '<h3 style="font-size:14px;font-weight:600;margin:12px 0 8px;color:var(--fg0);">$1</h3>');
    html = html.replace(/%%H2%%(.+?)%%\/H2%%/g, '<h2 style="font-size:15px;font-weight:600;margin:14px 0 10px;color:var(--fg0);">$1</h2>');
    html = html.replace(/%%H1%%(.+?)%%\/H1%%/g, '<h1 style="font-size:16px;font-weight:700;margin:16px 0 12px;color:var(--fg0);">$1</h1>');
    html = html.replace(/%%B%%(.+?)%%\/B%%/g, '<strong style="color:var(--fg0);">$1</strong>');
    html = html.replace(/%%I%%(.+?)%%\/I%%/g, '<em>$1</em>');
    html = html.replace(/%%C%%(.+?)%%\/C%%/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;font-size:12px;">$1</code>');
    html = html.replace(/%%OL%%(\d+)%%D%%(.+?)%%\/OL%%/g, '<div style="display:flex;gap:8px;margin:6px 0;"><span style="color:var(--accent);font-weight:600;min-width:20px;">$1.</span><span>$2</span></div>');
    html = html.replace(/%%UL%%(.+?)%%\/UL%%/g, '<div style="display:flex;gap:8px;margin:4px 0;padding:0;"><span style="color:var(--accent);flex-shrink:0;">•</span><span>$1</span></div>');
    html = html.replace(/%%HR%%/g, '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:12px 0;">');

    for (let i = 0; i < links.length; i++) {
        html = html.replace(`%%MDLINK${i}%%`, links[i]);
    }
    for (let i = 0; i < tables.length; i++) {
        html = html.replace(`%%TABLE${i}%%`, tables[i]);
    }
    for (let i = 0; i < codeBlocks.length; i++) {
        html = html.replace(`%%CODEBLOCK${i}%%`, codeBlocks[i]);
    }
    for (let i = 0; i < mathBlocks.length; i++) {
        html = html.replace(`%%MATH${i}%%`, mathBlocks[i]);
    }

    html = html.replace(/\n\n/g, '</p><p style="margin:8px 0;">');
    html = html.replace(/\n/g, '<br>');

    return '<p style="margin:8px 0;">' + html + '</p>';
  }
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
