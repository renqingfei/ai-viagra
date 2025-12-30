import * as vscode from 'vscode';
import { exec } from 'child_process';
import { DataManager, type Language, type NotifySoundName, type PanelPosition, type ThemeMode } from './dataManager';

type TabKey = 'status' | 'settings';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'infiniteDialogView';

  private _view: vscode.WebviewView | undefined;
  private _serverRunning = false;
  private _serverPort = 0;
  private _currentTab: TabKey = 'status';
  private readonly _dataManager = DataManager.getInstance();

  public constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    webviewView.webview.html = this.getHtmlContent();

    webviewView.webview.onDidReceiveMessage((message: any) => {
      const type = message?.type;
      switch (type) {
        case 'testFeedback':
          void vscode.commands.executeCommand('infiniteDialog.testFeedback');
          return;
        case 'refresh':
          this.refresh();
          return;
        case 'switchTab':
          this._currentTab = (message.data as TabKey) === 'settings' ? 'settings' : 'status';
          this.refresh();
          return;
        case 'setTheme':
          this._dataManager.setTheme((message.data as ThemeMode) || 'dark');
          this.refresh();
          return;
        case 'setLanguage':
          this._dataManager.setLanguage((message.data as Language) || 'zh');
          this.refresh();
          return;
        case 'setNotifySound': {
          const s = (message.data as NotifySoundName) || 'Notify';
          this._dataManager.setNotifySound(s);
          this.previewSound(s);
          this.refresh();
          return;
        }
        case 'setPanelPosition':
          this._dataManager.setPanelPosition((message.data as PanelPosition) || 'right');
          this.refresh();
          return;
        case 'setSummaryHeight':
          this._dataManager.setSummaryHeight(parseInt(String(message.data || '180'), 10));
          return;
        case 'setFeedbackHeight':
          this._dataManager.setFeedbackHeight(parseInt(String(message.data || '120'), 10));
          return;
        case 'setFontSize':
          this._dataManager.setFontSize(parseInt(String(message.data || '14'), 10));
          return;
        case 'setEnterToSend':
          this._dataManager.setEnterToSend(String(message.data) === 'true');
          return;
        case 'addQuickPhraseInline':
          if (typeof message.text === 'string' && message.text.trim()) {
            this._dataManager.addQuickPhrase(message.text.trim());
            this.refresh();
          }
          return;
        case 'deleteQuickPhrase':
          if (typeof message.data === 'string' && message.data) {
            this._dataManager.deleteQuickPhrase(message.data);
            this.refresh();
          }
          return;
        case 'addTemplateInline':
          if (typeof message.name === 'string' && typeof message.content === 'string' && message.name.trim() && message.content.trim()) {
            this._dataManager.addTemplate(message.name.trim(), message.content, '自定义');
            this.refresh();
          }
          return;
        case 'deleteTemplate':
          if (typeof message.data === 'string' && message.data) {
            this._dataManager.deleteTemplate(message.data);
            this.refresh();
          }
          return;
        case 'cleanMcpConfig':
          this.cleanMcpConfig();
          return;
        case 'resetConfig':
          this.resetConfig();
          return;
        case 'resetStats':
          void vscode.window
            .showWarningMessage('确定要重置使用统计吗？', '确定', '取消')
            .then((selection) => {
              if (selection === '确定') {
                this._dataManager.resetStats();
                this.refresh();
                void vscode.window.showInformationMessage('使用统计已重置');
              }
            });
          return;
      }
    });
  }

  private previewSound(soundName: NotifySoundName) {
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

  public setServerStatus(running: boolean, port: number) {
    this._serverRunning = running;
    this._serverPort = port;
    this.refresh();
  }

  private cleanMcpConfig() {
    const os = require('os') as typeof import('os');
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const HOME_DIR = os.homedir();
    const configs = [
      path.join(HOME_DIR, '.codeium', 'windsurf', 'mcp_config.json'),
      path.join(HOME_DIR, '.cursor', 'mcp.json'),
      path.join(HOME_DIR, '.kiro', 'settings', 'mcp.json'),
      path.join(HOME_DIR, '.trae', 'mcp.json'),
    ];

    let cleaned = 0;
    for (const configPath of configs) {
      try {
        if (!fs.existsSync(configPath)) continue;
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (!config?.mcpServers) continue;
        const keys = Object.keys(config.mcpServers);
        const toDelete = keys.filter((k) => k.startsWith('infinite-dialog-') && k !== 'infinite-dialog');
        toDelete.forEach((k) => {
          delete config.mcpServers[k];
          cleaned++;
        });
        if (toDelete.length > 0) fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      } catch {}
    }
    void vscode.window.showInformationMessage(`已清理 ${cleaned} 条旧MCP配置`);
  }

  private resetConfig() {
    void vscode.window.showWarningMessage('确定要重置所有设置吗？', '确定', '取消').then((selection) => {
      if (selection === '确定') {
        this._dataManager.resetToDefault();
        this.refresh();
        void vscode.window.showInformationMessage('设置已重置为默认值');
      }
    });
  }

  public refresh() {
    if (!this._view) return;
    this._view.webview.html = this.getHtmlContent();
  }

  private getHtmlContent(): string {
    const stats = this._dataManager.getStats();
    const quickPhrases = this._dataManager.getQuickPhrases();
    const templates = this._dataManager.getTemplates();
    const theme = this._dataManager.getTheme();
    const lang = this._dataManager.getLanguage();
    const notifySound = this._dataManager.getNotifySound();
    const panelPosition = this._dataManager.getPanelPosition();
    const summaryHeight = this._dataManager.getSummaryHeight();
    const feedbackHeight = this._dataManager.getFeedbackHeight();
    const fontSize = this._dataManager.getFontSize();
    const enterToSend = this._dataManager.getEnterToSend();

    const isDark = theme === 'dark' || theme === 'auto';

    const validCalls = stats.totalContinues + stats.totalPauses;
    const successRate = validCalls > 0 ? Math.round((stats.totalContinues / validCalls) * 100) : 0;
    const avgDaily = stats.firstUse ? Math.round(stats.totalCalls / Math.max(1, Math.ceil((Date.now() - stats.firstUse) / 86400000))) : 0;

    const quickPhrasesHtml = quickPhrases
      .map((p) => `<div class="list-item"><span>${escapeHtml(p.text)}</span><button data-action="deleteQuickPhrase" data-id="${escapeAttr(p.id)}">×</button></div>`)
      .join('');

    const templatesHtml = templates
      .map((t) => `<div class="list-item"><span>${escapeHtml(t.name)}</span><button data-action="deleteTemplate" data-id="${escapeAttr(t.id)}">×</button></div>`)
      .join('');

    const nonce = makeNonce();
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      ${isDark ? `
        --bg0: #0d0d0f;
        --bg1: rgba(30,30,35,0.85);
        --bg2: rgba(45,45,55,0.6);
        --glass: rgba(255,255,255,0.03);
        --glass-border: rgba(255,255,255,0.08);
        --text: #e8e8ec;
        --text2: #8888a0;
      ` : `
        --bg0: #e8e9ed;
        --bg1: rgba(255,255,255,0.75);
        --bg2: rgba(240,241,245,0.85);
        --glass: rgba(255,255,255,0.55);
        --glass-border: rgba(0,0,0,0.08);
        --text: #1a1a1e;
        --text2: #5a5a6a;
      `}
      --accent: #4da3ff;
      --accent2: #7c5cff;
      --success: #22c55e;
      --danger: #ef4444;
      --warning: #f59e0b;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg0); color: var(--text); padding: 10px; font-size: 12px; }
    .tabs { display: flex; gap: 6px; margin-bottom: 10px; padding: 4px; background: var(--bg1); border: 1px solid var(--glass-border); border-radius: 12px; flex-wrap: wrap; }
    .tab { padding: 7px 10px; border-radius: 10px; cursor: pointer; background: transparent; color: var(--text2); border: 0; }
    .tab.active { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; font-weight: 600; }
    .section { display: none; }
    .section.active { display: block; }
    .card { background: var(--bg1); border: 1px solid var(--glass-border); border-radius: 12px; padding: 12px; margin-bottom: 10px; }
    .title { font-size: 11px; color: var(--text2); margin-bottom: 10px; font-weight: 700; letter-spacing: 0.3px; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; font-weight: 700; }
    .badge.on { color: var(--success); border: 1px solid rgba(34,197,94,0.3); background: rgba(34,197,94,0.12); }
    .badge.off { color: var(--danger); border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.12); }
    .btn { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--glass-border); background: var(--glass); color: var(--text); cursor: pointer; text-align: left; }
    .btn:hover { border-color: rgba(77,163,255,0.5); }
    .btn.primary { background: linear-gradient(135deg, var(--accent), var(--accent2)); border: 0; color: #fff; font-weight: 700; }
    .btn.danger { background: linear-gradient(135deg, var(--danger), #dc2626); border: 0; color: #fff; font-weight: 700; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat { padding: 10px; border-radius: 10px; border: 1px solid var(--glass-border); background: var(--glass); text-align: center; }
    .stat .num { font-size: 18px; font-weight: 800; background: linear-gradient(135deg, var(--accent), var(--accent2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .stat .label { font-size: 10px; color: var(--text2); margin-top: 2px; }
    .list-item { display: flex; gap: 10px; align-items: center; justify-content: space-between; padding: 10px; border-radius: 10px; border: 1px solid var(--glass-border); background: var(--glass); margin-bottom: 6px; }
    .list-item span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .list-item button { width: 26px; height: 26px; border-radius: 8px; border: 1px solid rgba(239,68,68,0.35); background: rgba(239,68,68,0.12); color: var(--danger); cursor: pointer; }
    .empty { color: var(--text2); text-align: center; padding: 10px; }
    label { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 0; color: var(--text); }
    select, input[type="number"], input[type="text"] { width: 160px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--glass-border); background: rgba(0,0,0,0.12); color: var(--text); }
    input[type="checkbox"] { transform: scale(1.05); }
    textarea { width: 100%; min-height: 90px; padding: 10px; border-radius: 10px; border: 1px solid var(--glass-border); background: rgba(0,0,0,0.12); color: var(--text); resize: vertical; }
  </style>
</head>
<body>
  <div class="tabs">
    <button class="tab ${this._currentTab === 'status' ? 'active' : ''}" data-tab="status">📊 状态</button>
    <button class="tab ${this._currentTab === 'settings' ? 'active' : ''}" data-tab="settings">⚙️ 设置</button>
  </div>

  <div class="section ${this._currentTab === 'status' ? 'active' : ''}" id="status">
    <div class="card">
      <div class="title">服务状态</div>
      <div class="row">
        <div class="badge ${this._serverRunning ? 'on' : 'off'}">${this._serverRunning ? '🟢 运行中' : '🔴 未启动'}</div>
        <div style="color:var(--text2)">port: ${escapeHtml(String(this._serverPort || 0))}</div>
      </div>
      <div class="grid" style="margin-top:12px;">
        <div class="stat"><div class="num">${stats.totalCalls}</div><div class="label">总调用</div></div>
        <div class="stat"><div class="num">${stats.totalContinues}</div><div class="label">继续</div></div>
        <div class="stat"><div class="num">${stats.totalPauses}</div><div class="label">暂缓</div></div>
        <div class="stat"><div class="num">${stats.totalEnds}</div><div class="label">结束</div></div>
      </div>
      <div class="grid" style="margin-top:8px;">
        <div class="stat"><div class="num">${successRate}%</div><div class="label">继续率</div></div>
        <div class="stat"><div class="num">${avgDaily}</div><div class="label">日均调用</div></div>
      </div>
      <div style="margin-top:12px;" class="row">
        <button class="btn primary" id="btnTestFeedback">🧪 测试弹窗</button>
        <button class="btn" id="btnRefresh">🔄 刷新</button>
      </div>
    </div>
  </div>

  <div class="section ${this._currentTab === 'settings' ? 'active' : ''}" id="settings">
    <div class="card">
      <div class="title">外观与行为</div>
      <label>🎨 主题
        <select id="themeSelect">
          <option value="dark" ${theme === 'dark' ? 'selected' : ''}>深色</option>
          <option value="light" ${theme === 'light' ? 'selected' : ''}>浅色</option>
          <option value="auto" ${theme === 'auto' ? 'selected' : ''}>自动</option>
        </select>
      </label>
      <label>🌐 语言
        <select id="languageSelect">
          <option value="zh" ${lang === 'zh' ? 'selected' : ''}>中文</option>
          <option value="en" ${lang === 'en' ? 'selected' : ''}>English</option>
        </select>
      </label>
      <label>🔔 提示音
        <select id="notifySoundSelect">
          ${['None','Notify','Ding','Chimes','Chord','Tada','Error'].map(s => `<option value="${s}" ${notifySound === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </label>
      <label>🪟 面板位置
        <select id="panelPositionSelect">
          <option value="beside" ${panelPosition === 'beside' ? 'selected' : ''}>Beside</option>
          <option value="active" ${panelPosition === 'active' ? 'selected' : ''}>Active</option>
          <option value="left" ${panelPosition === 'left' ? 'selected' : ''}>Left</option>
          <option value="right" ${panelPosition === 'right' ? 'selected' : ''}>Right</option>
        </select>
      </label>
      <label>📏 Summary 高度
        <input id="summaryHeightInput" type="number" min="80" max="600" value="${summaryHeight}" />
      </label>
      <label>📏 Feedback 高度
        <input id="feedbackHeightInput" type="number" min="60" max="300" value="${feedbackHeight}" />
      </label>
      <label>🔠 字体大小
        <input id="fontSizeInput" type="number" min="12" max="20" value="${fontSize}" />
      </label>
      <label>⏎ Enter 发送
        <input id="enterToSendInput" type="checkbox" ${enterToSend ? 'checked' : ''} />
      </label>
    </div>

    <div class="card">
      <div class="title">快捷回复</div>
      <div class="row" style="margin-bottom:10px;">
        <input type="text" id="qpText" placeholder="输入一句快捷回复..." />
        <button class="btn" style="width:auto" id="btnAddQuickPhrase">添加</button>
      </div>
      <div>${quickPhrasesHtml || `<div class="empty">暂无</div>`}</div>
    </div>

    <div class="card">
      <div class="title">模板</div>
      <div class="row" style="margin-bottom:10px;">
        <input type="text" id="tplName" placeholder="模板名称" />
      </div>
      <textarea id="tplContent" placeholder="模板内容（将作为 System Prompt 返回给 AI）"></textarea>
      <div class="row" style="margin-top:10px;">
        <button class="btn" style="width:auto" id="btnAddTemplate">添加模板</button>
      </div>
      <div style="margin-top:10px;">${templatesHtml || `<div class="empty">暂无</div>`}</div>
    </div>

    <div class="card">
      <div class="title">维护</div>
      <button class="btn" id="btnCleanMcpConfig">🧽 清理旧 MCP 配置</button>
      <button class="btn danger" id="btnResetConfig">🧨 重置所有设置</button>
      <button class="btn danger" id="btnResetStats">📉 重置统计</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    function send(type, data) { vscode.postMessage({ type, data }); }

    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => send('switchTab', btn.getAttribute('data-tab')));
    });

    const btnTestFeedback = document.getElementById('btnTestFeedback');
    if (btnTestFeedback) btnTestFeedback.addEventListener('click', () => send('testFeedback'));

    const btnRefresh = document.getElementById('btnRefresh');
    if (btnRefresh) btnRefresh.addEventListener('click', () => send('refresh'));

    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) themeSelect.addEventListener('change', () => send('setTheme', themeSelect.value));

    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect) languageSelect.addEventListener('change', () => send('setLanguage', languageSelect.value));

    const notifySoundSelect = document.getElementById('notifySoundSelect');
    if (notifySoundSelect) notifySoundSelect.addEventListener('change', () => send('setNotifySound', notifySoundSelect.value));

    const panelPositionSelect = document.getElementById('panelPositionSelect');
    if (panelPositionSelect) panelPositionSelect.addEventListener('change', () => send('setPanelPosition', panelPositionSelect.value));

    const summaryHeightInput = document.getElementById('summaryHeightInput');
    if (summaryHeightInput) summaryHeightInput.addEventListener('change', () => send('setSummaryHeight', summaryHeightInput.value));

    const feedbackHeightInput = document.getElementById('feedbackHeightInput');
    if (feedbackHeightInput) feedbackHeightInput.addEventListener('change', () => send('setFeedbackHeight', feedbackHeightInput.value));

    const fontSizeInput = document.getElementById('fontSizeInput');
    if (fontSizeInput) fontSizeInput.addEventListener('change', () => send('setFontSize', fontSizeInput.value));

    const enterToSendInput = document.getElementById('enterToSendInput');
    if (enterToSendInput) enterToSendInput.addEventListener('change', () => send('setEnterToSend', enterToSendInput.checked ? 'true' : 'false'));

    const btnAddQuickPhrase = document.getElementById('btnAddQuickPhrase');
    if (btnAddQuickPhrase) {
      btnAddQuickPhrase.addEventListener('click', () => {
        const el = document.getElementById('qpText');
        const text = el && el.value ? el.value.trim() : '';
        if (!text) return;
        vscode.postMessage({ type: 'addQuickPhraseInline', text });
      });
    }

    const btnAddTemplate = document.getElementById('btnAddTemplate');
    if (btnAddTemplate) {
      btnAddTemplate.addEventListener('click', () => {
        const nameEl = document.getElementById('tplName');
        const contentEl = document.getElementById('tplContent');
        const name = nameEl && nameEl.value ? nameEl.value.trim() : '';
        const content = contentEl && contentEl.value ? contentEl.value : '';
        if (!name || !content.trim()) return;
        vscode.postMessage({ type: 'addTemplateInline', name, content });
      });
    }

    const btnCleanMcpConfig = document.getElementById('btnCleanMcpConfig');
    if (btnCleanMcpConfig) btnCleanMcpConfig.addEventListener('click', () => send('cleanMcpConfig'));

    const btnResetConfig = document.getElementById('btnResetConfig');
    if (btnResetConfig) btnResetConfig.addEventListener('click', () => send('resetConfig'));

    const btnResetStats = document.getElementById('btnResetStats');
    if (btnResetStats) btnResetStats.addEventListener('click', () => send('resetStats'));

    document.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      if (action === 'deleteQuickPhrase' && id) send('deleteQuickPhrase', id);
      if (action === 'deleteTemplate' && id) send('deleteTemplate', id);
    });
  </script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(input: string): string {
  return escapeHtml(input).replace(/`/g, '&#96;');
}
