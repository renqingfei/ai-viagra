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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
function activate(context) {
    console.log('AI伟哥 is now active!');
    const service = new AiWeigeService(context);
    context.subscriptions.push(service);
    service.start().catch(() => undefined);
    const settingsProvider = new SettingsViewProvider(context, service);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewType, settingsProvider));
}
function getWebviewContent() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI伟哥面板</title>
    <style>
        :root {
            --card-bg: color-mix(in srgb, var(--vscode-editor-background) 86%, var(--vscode-editor-foreground) 14%);
            --card-border: color-mix(in srgb, var(--vscode-panel-border) 80%, transparent 20%);
            --soft: color-mix(in srgb, var(--vscode-editor-foreground) 16%, transparent 84%);
            --soft2: color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent 90%);
        }
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 16px 14px;
        }
        .header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 14px;
        }
        .title {
            font-size: 18px;
            font-weight: 700;
            margin: 0;
            letter-spacing: 0.2px;
        }
        .subtitle {
            margin-top: 6px;
            font-size: 12px;
            opacity: 0.8;
        }
        .pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            border-radius: 999px;
            border: 1px solid var(--card-border);
            background: var(--soft2);
            font-size: 12px;
            user-select: none;
        }
        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: rgba(200, 60, 60, 0.95);
        }
        .pill.ok .dot { background: rgba(60, 200, 120, 0.95); }
        .pill.bad .dot { background: rgba(200, 60, 60, 0.95); }
        .layout {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 12px;
        }
        .card {
            border: 1px solid var(--card-border);
            background: var(--soft2);
            border-radius: 14px;
            padding: 14px;
        }
        .card h2 {
            margin: 0 0 10px 0;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.2px;
        }
        .kv {
            display: grid;
            grid-template-columns: 110px 1fr;
            gap: 8px 12px;
            align-items: center;
        }
        .k {
            opacity: 0.78;
            font-size: 12px;
        }
        .v {
            font-size: 12px;
        }
        .mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }
        .form-group { margin-bottom: 12px; }
        label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 12px; opacity: 0.9; }
        input[type="text"], select, textarea {
            width: 100%;
            padding: 9px 10px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 10px;
            box-sizing: border-box;
            outline: none;
        }
        input[type="text"]:focus, select:focus, textarea:focus {
            border-color: var(--vscode-focusBorder);
        }
        .row {
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
        }
        .row.end { justify-content: flex-end; }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 9px 12px;
            border: none;
            cursor: pointer;
            border-radius: 10px;
            font-weight: 600;
        }
        button.secondary {
            background: transparent;
            border: 1px solid var(--card-border);
            color: var(--vscode-editor-foreground);
        }
        button:hover { background-color: var(--vscode-button-hoverBackground); }
        button.secondary:hover { background: var(--soft2); }
        .tip {
            padding: 10px 12px;
            border-radius: 12px;
            border: 1px dashed var(--card-border);
            background: color-mix(in srgb, var(--soft2) 70%, transparent 30%);
            font-size: 12px;
            line-height: 1.5;
        }
        .legend {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            margin-top: 10px;
            font-size: 12px;
            opacity: 0.86;
        }
        .legend .item { display: inline-flex; align-items: center; gap: 8px; }
        .swatch { width: 10px; height: 10px; border-radius: 3px; }
        .swatch.blue { background: rgba(80, 160, 255, 0.9); }
        .swatch.green { background: rgba(80, 200, 120, 0.9); }
        .chartWrap {
            border: 1px solid var(--card-border);
            border-radius: 14px;
            padding: 10px;
            background: color-mix(in srgb, var(--soft2) 70%, transparent 30%);
        }
        canvas { width: 100%; height: 220px; display: block; }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1 class="title">AI伟哥</h1>
            <div class="subtitle">MCP（HTTP）+ 反馈弹出页 + 使用统计</div>
        </div>
        <div id="service-status" class="pill bad"><span class="dot"></span><span id="service-status-text">未运行</span></div>
    </div>

    <div class="layout">
        <section class="card">
            <h2>服务</h2>
            <div class="kv">
                <div class="k">地址</div>
                <div class="v mono" id="service-url">-</div>
                <div class="k">端口</div>
                <div class="v"><input type="text" id="servicePort" placeholder="3456"></div>
                <div class="k">MCP 入口</div>
                <div class="v mono" id="service-mcp">-</div>
                <div class="k">反馈页</div>
                <div class="v mono" id="service-feedback">-</div>
            </div>
            <div class="row" style="margin-top: 12px;">
                <button onclick="startService()">启动</button>
                <button class="secondary" onclick="stopService()">停止</button>
            </div>
        </section>

        <section class="card">
            <h2>提示</h2>
            <div class="tip">只有思考模型才可唤醒当前的插件功能，越聪明的AI继续率就越高</div>
        </section>

        <section class="card" style="grid-column: 1 / -1;">
            <h2>使用统计（最近 7 天）</h2>
            <div class="chartWrap">
                <canvas id="statsChart"></canvas>
            </div>
            <div class="legend">
                <div class="item"><span class="swatch blue"></span><span>MCP 调用次数</span></div>
                <div class="item"><span class="swatch green"></span><span>反馈提交次数</span></div>
            </div>
        </section>

        <section class="card">
            <h2>配置</h2>
            <div class="form-group">
                <label for="theme">主题</label>
                <select id="theme">
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                    <option value="system">跟随系统</option>
                </select>
            </div>
            <div class="form-group">
                <label for="apiKey">API Key</label>
                <input type="text" id="apiKey" placeholder="请输入 API Key">
            </div>
            <div class="row end">
                <button onclick="saveConfig()">保存</button>
            </div>
        </section>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        vscode.postMessage({ command: 'requestConfig' });
        vscode.postMessage({ command: 'requestService' });
        vscode.postMessage({ command: 'requestStats' });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'loadConfig':
                    document.getElementById('theme').value = message.theme;
                    document.getElementById('apiKey').value = message.apiKey;
                    document.getElementById('servicePort').value = message.servicePort;
                    break;
                case 'serviceStatus':
                    renderService(message.running, message.url);
                    break;
                case 'stats':
                    renderStats(message.points);
                    break;
            }
        });

        function saveConfig() {
            const theme = document.getElementById('theme').value;
            const apiKey = document.getElementById('apiKey').value;
            const servicePort = document.getElementById('servicePort').value;
            vscode.postMessage({
                command: 'saveConfig',
                theme: theme,
                apiKey: apiKey,
                servicePort: servicePort
            });
        }

        function startService() {
            const servicePort = document.getElementById('servicePort').value;
            vscode.postMessage({ command: 'startService', servicePort });
        }

        function stopService() {
            vscode.postMessage({ command: 'stopService' });
        }

        function renderService(running, url) {
            const statusEl = document.getElementById('service-status');
            const urlEl = document.getElementById('service-url');
            const statusTextEl = document.getElementById('service-status-text');
            const mcpEl = document.getElementById('service-mcp');
            const fbEl = document.getElementById('service-feedback');
            statusEl.classList.toggle('ok', !!running);
            statusEl.classList.toggle('bad', !running);
            statusTextEl.textContent = running ? '运行中' : '未运行';
            urlEl.textContent = url || '-';
            mcpEl.textContent = url ? url + '/mcp' : '-';
            fbEl.textContent = url ? url + '/feedback' : '-';
        }

        function drawBar(ctx, x, y, w, h, color) {
            ctx.fillStyle = color;
            ctx.fillRect(x, y, w, h);
        }

        function renderStats(points) {
            const canvas = document.getElementById('statsChart');
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
            const displayW = Math.max(320, canvas.clientWidth || 700);
            const displayH = 220;
            canvas.width = displayW * dpr;
            canvas.height = displayH * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const width = displayW;
            const height = displayH;
            ctx.clearRect(0, 0, width, height);

            const padding = 26;
            const chartW = width - padding * 2;
            const chartH = height - padding * 2;

            const maxValue = Math.max(1, ...points.map(p => Math.max(p.mcpCalls, p.feedbackSubmits)));
            ctx.strokeStyle = 'rgba(128,128,128,0.28)';
            ctx.beginPath();
            ctx.moveTo(padding, padding);
            ctx.lineTo(padding, height - padding);
            ctx.lineTo(width - padding, height - padding);
            ctx.stroke();

            const barGroupW = chartW / points.length;
            const barW = Math.max(6, Math.min(18, barGroupW * 0.26));

            points.forEach((p, i) => {
                const baseX = padding + i * barGroupW + barGroupW / 2;
                const mcpH = (p.mcpCalls / maxValue) * chartH;
                const fbH = (p.feedbackSubmits / maxValue) * chartH;

                drawBar(ctx, baseX - barW - 2, height - padding - mcpH, barW, mcpH, 'rgba(80, 160, 255, 0.9)');
                drawBar(ctx, baseX + 2, height - padding - fbH, barW, fbH, 'rgba(80, 200, 120, 0.9)');

                ctx.fillStyle = 'rgba(128,128,128,0.85)';
                ctx.font = '11px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(p.label, baseX, height - padding + 16);
            });
        }
    </script>
</body>
</html>`;
}
function wireWebview(context, service, webview, getPanelOrView) {
    webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'saveConfig':
                {
                    const parsed = ConfigSchema.safeParse(message);
                    if (!parsed.success) {
                        vscode.window.showErrorMessage('配置格式不正确');
                        return;
                    }
                    await context.globalState.update('theme', parsed.data.theme);
                    await context.globalState.update('apiKey', parsed.data.apiKey);
                    await context.globalState.update('servicePort', parsed.data.servicePort);
                    vscode.window.showInformationMessage('配置已保存');
                    getPanelOrView()?.webview.postMessage({
                        command: 'loadConfig',
                        theme: parsed.data.theme,
                        apiKey: parsed.data.apiKey,
                        servicePort: parsed.data.servicePort
                    });
                    return;
                }
            case 'requestConfig':
                {
                    const theme = context.globalState.get('theme') || 'dark';
                    const apiKey = context.globalState.get('apiKey') || '';
                    const servicePort = context.globalState.get('servicePort') || '3456';
                    getPanelOrView()?.webview.postMessage({ command: 'loadConfig', theme, apiKey, servicePort });
                    return;
                }
            case 'requestService':
                {
                    getPanelOrView()?.webview.postMessage({
                        command: 'serviceStatus',
                        running: service.isRunning(),
                        url: service.getBaseUrl()
                    });
                    return;
                }
            case 'startService':
                {
                    const port = typeof message.servicePort === 'string' ? message.servicePort : undefined;
                    if (port) {
                        await context.globalState.update('servicePort', port);
                    }
                    await service.start();
                    getPanelOrView()?.webview.postMessage({
                        command: 'serviceStatus',
                        running: service.isRunning(),
                        url: service.getBaseUrl()
                    });
                    return;
                }
            case 'stopService':
                {
                    await service.stop();
                    getPanelOrView()?.webview.postMessage({
                        command: 'serviceStatus',
                        running: service.isRunning(),
                        url: service.getBaseUrl()
                    });
                    return;
                }
            case 'requestStats':
                {
                    const points = await service.getStatsPoints();
                    getPanelOrView()?.webview.postMessage({ command: 'stats', points });
                    return;
                }
        }
    }, undefined, context.subscriptions);
}
class SettingsViewProvider {
    constructor(context, service) {
        this.context = context;
        this.service = service;
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(this.context.extensionPath)]
        };
        wireWebview(this.context, this.service, webviewView.webview, () => this.view);
        webviewView.webview.html = getWebviewContent();
    }
}
SettingsViewProvider.viewType = 'aiweige.panel';
const ConfigSchema = zod_1.z.object({
    command: zod_1.z.literal('saveConfig'),
    theme: zod_1.z.enum(['light', 'dark', 'system']),
    apiKey: zod_1.z.string(),
    servicePort: zod_1.z.string().regex(/^\d{2,5}$/)
});
class AiWeigeService {
    constructor(context) {
        this.context = context;
        this.feedbacks = [];
    }
    dispose() {
        void this.stop();
    }
    isRunning() {
        return !!this.httpServer;
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    async start() {
        const portRaw = this.context.globalState.get('servicePort') || '3456';
        const port = Number(portRaw);
        if (!Number.isFinite(port) || port <= 0 || port > 65535) {
            throw new Error('Invalid port');
        }
        if (this.httpServer) {
            if (this.port === port)
                return;
            await this.stop();
        }
        const sdkServer = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/server/index.js')));
        const sdkTransport = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/server/streamableHttp.js')));
        const sdkTypes = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/types.js')));
        const app = (0, express_1.default)();
        app.use(express_1.default.json({ limit: '1mb' }));
        app.get('/feedback', (req, res) => {
            res.setHeader('content-type', 'text/html; charset=utf-8');
            res.send(getFeedbackPageHtml());
        });
        app.get('/api/status', (req, res) => {
            res.json({ running: true, url: this.baseUrl });
        });
        app.post('/api/feedback', async (req, res) => {
            const parsed = FeedbackSchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json({ ok: false });
                return;
            }
            this.feedbacks.push(parsed.data.message);
            if (this.feedbacks.length > 200)
                this.feedbacks.shift();
            await this.bumpStat('feedbackSubmits');
            res.json({ ok: true });
        });
        this.mcpServer = createMcpServer({
            Server: sdkServer.Server,
            CallToolRequestSchema: sdkTypes.CallToolRequestSchema,
            ListToolsRequestSchema: sdkTypes.ListToolsRequestSchema
        }, {
            openFeedback: async () => {
                if (!this.baseUrl) {
                    throw new Error('Service not running');
                }
                const url = `${this.baseUrl}/feedback`;
                await this.bumpStat('mcpCalls');
                await vscode.env.openExternal(vscode.Uri.parse(url));
                return url;
            },
            getLatestFeedback: async () => {
                await this.bumpStat('mcpCalls');
                const latest = this.feedbacks.length ? this.feedbacks[this.feedbacks.length - 1] : '';
                return latest;
            },
            getConfig: async () => {
                await this.bumpStat('mcpCalls');
                const theme = this.context.globalState.get('theme') || 'dark';
                const apiKey = this.context.globalState.get('apiKey') || '';
                const servicePort = this.context.globalState.get('servicePort') || '3456';
                return { theme, apiKey, servicePort };
            }
        });
        this.transport = new sdkTransport.StreamableHTTPServerTransport({
            sessionIdGenerator: undefined
        });
        await this.mcpServer.connect(this.transport);
        app.all('/mcp', async (req, res) => {
            if (!this.transport) {
                res.status(503).json({ error: 'service not ready' });
                return;
            }
            await this.transport.handleRequest(req, res, req.body);
        });
        await new Promise((resolve, reject) => {
            const server = app.listen(port, '127.0.0.1', () => {
                this.httpServer = server;
                this.baseUrl = `http://127.0.0.1:${port}`;
                this.port = port;
                resolve();
            });
            server.on('error', reject);
        });
    }
    async stop() {
        if (!this.httpServer)
            return;
        const server = this.httpServer;
        this.httpServer = undefined;
        this.baseUrl = undefined;
        this.port = undefined;
        if (this.transport) {
            await this.transport.close();
        }
        this.transport = undefined;
        this.mcpServer = undefined;
        await new Promise(resolve => server.close(() => resolve()));
    }
    async getStatsPoints() {
        const raw = this.context.globalState.get('stats');
        const parsed = StatsSchema.safeParse(raw);
        const stats = parsed.success ? parsed.data : {};
        const points = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            const label = key.slice(5);
            const day = stats[key] || { mcpCalls: 0, feedbackSubmits: 0 };
            points.push({ label, mcpCalls: day.mcpCalls, feedbackSubmits: day.feedbackSubmits });
        }
        return points;
    }
    async bumpStat(field) {
        const raw = this.context.globalState.get('stats');
        const parsed = StatsSchema.safeParse(raw);
        const stats = parsed.success ? parsed.data : {};
        const key = new Date().toISOString().slice(0, 10);
        const day = stats[key] || { mcpCalls: 0, feedbackSubmits: 0 };
        stats[key] = { ...day, [field]: (day[field] || 0) + 1 };
        await this.context.globalState.update('stats', stats);
    }
}
const FeedbackSchema = zod_1.z.object({
    message: zod_1.z.string().min(1).max(4000)
});
const StatsSchema = zod_1.z.record(zod_1.z.string(), zod_1.z.object({
    mcpCalls: zod_1.z.number(),
    feedbackSubmits: zod_1.z.number()
}));
function createMcpServer(sdk, handlers) {
    const server = new sdk.Server({ name: 'aiweige', version: '0.1.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(sdk.ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: 'aiweige_open_feedback',
                    description: '打开反馈页面（HTTP）',
                    inputSchema: { type: 'object', properties: {} }
                },
                {
                    name: 'aiweige_get_latest_feedback',
                    description: '获取最近一次反馈内容',
                    inputSchema: { type: 'object', properties: {} }
                },
                {
                    name: 'aiweige_get_config',
                    description: '获取插件配置',
                    inputSchema: { type: 'object', properties: {} }
                }
            ]
        };
    });
    server.setRequestHandler(sdk.CallToolRequestSchema, async (request) => {
        switch (request?.params?.name) {
            case 'aiweige_open_feedback': {
                const url = await handlers.openFeedback();
                return { content: [{ type: 'text', text: url }] };
            }
            case 'aiweige_get_latest_feedback': {
                const text = await handlers.getLatestFeedback();
                return { content: [{ type: 'text', text }] };
            }
            case 'aiweige_get_config': {
                const cfg = await handlers.getConfig();
                return { content: [{ type: 'text', text: JSON.stringify(cfg) }] };
            }
            default:
                throw new Error('Unknown tool');
        }
    });
    return server;
}
function getFeedbackPageHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI伟哥 - 反馈</title>
  <style>
    body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial; padding: 24px; max-width: 720px; margin: 0 auto; }
    h1 { font-size: 18px; margin: 0 0 12px 0; }
    textarea { width: 100%; min-height: 160px; padding: 10px; border: 1px solid #ccc; border-radius: 8px; box-sizing: border-box; }
    .row { display: flex; gap: 10px; align-items: center; margin-top: 12px; }
    button { background: #1677ff; color: #fff; border: 0; padding: 10px 14px; border-radius: 8px; cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .msg { color: #333; }
  </style>
</head>
<body>
  <h1>反馈（MCP 调用时弹出）</h1>
  <textarea id="message" placeholder="请输入反馈内容..."></textarea>
  <div class="row">
    <button id="submit">提交</button>
    <span id="status" class="msg"></span>
  </div>
  <script>
    const btn = document.getElementById('submit');
    const statusEl = document.getElementById('status');
    btn.addEventListener('click', async () => {
      const message = document.getElementById('message').value.trim();
      if (!message) return;
      btn.disabled = true;
      statusEl.textContent = '提交中...';
      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message })
        });
        if (res.ok) {
          statusEl.textContent = '已提交，可以关闭此页面';
        } else {
          statusEl.textContent = '提交失败';
        }
      } catch (e) {
        statusEl.textContent = '提交失败';
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map