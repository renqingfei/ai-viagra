import * as vscode from "vscode";

interface DashboardState {
  status: string;
  statusColor: string;
  statusText: string;
  lastRequestPreview: string;
  totalSessions: number;
  completedSessions: number;
  daysActive: number;
}

interface StoredStats {
  totalSessions: number;
  completedSessions: number;
  firstSessionDate: string | null;
}

export class AiFeedbackViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  private status = "未连接";
  private lastRequestPreview = "";

  private totalSessions = 0;
  private completedSessions = 0;
  private firstSessionDate: string | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {
    const stored = context.globalState.get<StoredStats>("aiFeedbackStats");
    if (stored) {
      this.totalSessions = stored.totalSessions || 0;
      this.completedSessions = stored.completedSessions || 0;
      this.firstSessionDate = stored.firstSessionDate || null;
    }
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = {
      enableScripts: true
    };
    view.webview.html = this.getHtml(view.webview);

    view.webview.onDidReceiveMessage(message => {
      if (message?.type === "refresh") {
        this.pushState();
      }
    });

    this.pushState();
  }

  updateStatus(status: string, lastRequestPreview?: string) {
    this.status = status;
    if (lastRequestPreview) {
      this.lastRequestPreview = lastRequestPreview;
    }
    this.pushState();
  }

  recordSessionStart(preview: string) {
    this.totalSessions += 1;
    this.lastRequestPreview = preview;
    if (!this.firstSessionDate) {
      this.firstSessionDate = new Date().toISOString().slice(0, 10);
    }
    this.saveStats();
    this.pushState();
  }

  recordSessionCompleted() {
    this.completedSessions += 1;
    this.saveStats();
    this.pushState();
  }

  private saveStats() {
    const payload: StoredStats = {
      totalSessions: this.totalSessions,
      completedSessions: this.completedSessions,
      firstSessionDate: this.firstSessionDate
    };
    this.context.globalState.update("aiFeedbackStats", payload);
  }

  private computeState(): DashboardState {
    const status = this.status;
    let statusColor = "#999999";
    let statusText = "未知";

    if (status.includes("已连接") || status.includes("运行")) {
      statusColor = "#22c55e";
      statusText = "运行中";
    } else if (status.includes("连接中")) {
      statusColor = "#eab308";
      statusText = "连接中";
    } else if (status.includes("连接失败") || status.includes("异常")) {
      statusColor = "#ef4444";
      statusText = "异常";
    } else if (status.includes("未连接")) {
      statusColor = "#6b7280";
      statusText = "未连接";
    }

    const daysActive = this.getDaysActive();

    return {
      status,
      statusColor,
      statusText,
      lastRequestPreview: this.lastRequestPreview,
      totalSessions: this.totalSessions,
      completedSessions: this.completedSessions,
      daysActive
    };
  }

  private getDaysActive(): number {
    if (!this.firstSessionDate) {
      return 0;
    }
    const first = new Date(this.firstSessionDate);
    const now = new Date();
    const diffMs = now.getTime() - first.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
    return days > 0 ? days : 0;
  }

  private pushState() {
    if (!this.view) {
      return;
    }
    const state = this.computeState();
    this.view.webview.postMessage({
      type: "state",
      payload: state
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = Date.now().toString();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI Feedback 状态</title>
  <style>
    :root {
      color-scheme: dark;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #09090b;
      color: #e5e7eb;
    }
    .root {
      padding: 10px 10px 16px 10px;
      box-sizing: border-box;
    }
    .tabs {
      display: flex;
      gap: 8px;
      padding: 4px;
      border-radius: 999px;
      background: #18181b;
      margin-bottom: 12px;
    }
    .tab {
      flex: 1;
      text-align: center;
      padding: 6px 0;
      border-radius: 999px;
      font-size: 11px;
      cursor: default;
      color: #a1a1aa;
    }
    .tab.active {
      background: #1d4ed8;
      color: #f9fafb;
    }
    .card {
      background: #111827;
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 10px;
      box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.8);
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .card-title {
      font-size: 12px;
      font-weight: 600;
      color: #e5e7eb;
    }
    .card-subtitle {
      font-size: 11px;
      color: #9ca3af;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: #020617;
      font-size: 11px;
      color: #e5e7eb;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #22c55e;
    }
    .status-text {
      font-weight: 500;
    }
    .hint {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 8px;
      line-height: 1.4;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 4px;
    }
    .stat-card {
      background: #020617;
      border-radius: 10px;
      padding: 8px 10px;
    }
    .stat-label {
      font-size: 11px;
      color: #9ca3af;
      margin-bottom: 4px;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 600;
      color: #e5e7eb;
    }
    .stat-sub {
      font-size: 10px;
      color: #6b7280;
      margin-top: 2px;
    }
    .footer {
      margin-top: 10px;
      font-size: 10px;
      color: #6b7280;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .refresh-btn {
      padding: 3px 8px;
      border-radius: 999px;
      background: #020617;
      border: 1px solid #1f2937;
      font-size: 10px;
      color: #9ca3af;
      cursor: pointer;
    }
    .last-request {
      margin-top: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      background: #020617;
      font-size: 11px;
      color: #9ca3af;
      max-height: 72px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
    }
  </style>
</head>
<body>
  <div class="root">
    <div class="tabs">
      <div class="tab active">状态</div>
      <div class="tab">历史</div>
      <div class="tab">快捷</div>
      <div class="tab">模板</div>
      <div class="tab">设置</div>
    </div>

    <div class="card" id="status-card">
      <div class="card-header">
        <div>
          <div class="card-title">服务状态</div>
          <div class="card-subtitle" id="status-raw"></div>
        </div>
        <div class="status-pill">
          <div class="status-dot" id="status-dot"></div>
          <span class="status-text" id="status-text">未连接</span>
        </div>
      </div>
      <div class="hint">
        只有思考模型才可唤醒当前的插件功能，越聪明的 AI 续续率就越高。
      </div>
      <div class="last-request" id="last-request" style="display:none;"></div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">使用统计</div>
        <button class="refresh-btn" id="refresh-btn">刷新</button>
      </div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">总对话</div>
          <div class="stat-value" id="stat-total">0</div>
          <div class="stat-sub">从安装以来</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">响应率</div>
          <div class="stat-value" id="stat-rate">0%</div>
          <div class="stat-sub" id="stat-rate-sub">0 次反馈</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">活跃天数</div>
          <div class="stat-value" id="stat-days">0</div>
          <div class="stat-sub">有交互的天数</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">已结束对话</div>
          <div class="stat-value" id="stat-finished">0</div>
          <div class="stat-sub">本地统计</div>
        </div>
      </div>
      <div class="footer">
        <span id="footer-summary">等待首次对话</span>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function updateDashboard(state) {
      const statusRaw = document.getElementById("status-raw");
      const statusDot = document.getElementById("status-dot");
      const statusText = document.getElementById("status-text");
      const lastRequest = document.getElementById("last-request");
      const statTotal = document.getElementById("stat-total");
      const statRate = document.getElementById("stat-rate");
      const statRateSub = document.getElementById("stat-rate-sub");
      const statDays = document.getElementById("stat-days");
      const statFinished = document.getElementById("stat-finished");
      const footerSummary = document.getElementById("footer-summary");

      if (statusRaw) {
        statusRaw.textContent = state.status;
      }
      if (statusDot) {
        statusDot.style.backgroundColor = state.statusColor;
      }
      if (statusText) {
        statusText.textContent = state.statusText;
      }

      if (lastRequest) {
        if (state.lastRequestPreview && state.lastRequestPreview.trim().length > 0) {
          lastRequest.style.display = "block";
          lastRequest.textContent = state.lastRequestPreview;
        } else {
          lastRequest.style.display = "none";
        }
      }

      const total = state.totalSessions || 0;
      const completed = state.completedSessions || 0;
      const daysActive = state.daysActive || 0;
      const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

      if (statTotal) {
        statTotal.textContent = String(total);
      }
      if (statRate) {
        statRate.textContent = rate + "%";
      }
      if (statRateSub) {
        statRateSub.textContent = completed + " 次反馈";
      }
      if (statDays) {
        statDays.textContent = String(daysActive);
      }
      if (statFinished) {
        statFinished.textContent = String(completed);
      }
      if (footerSummary) {
        if (total === 0) {
          footerSummary.textContent = "等待首次对话";
        } else {
          footerSummary.textContent = "本统计基于本地扩展会话数据，仅供参考";
        }
      }
    }

    window.addEventListener("message", event => {
      const message = event.data;
      if (message && message.type === "state" && message.payload) {
        updateDashboard(message.payload);
      }
    });

    const refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "refresh" });
      });
    }
  </script>
</body>
</html>`;
  }
}

