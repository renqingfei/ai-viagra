import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const DATA_DIR = path.join(os.homedir(), '.infinite-dialog');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export type ThemeMode = 'dark' | 'light' | 'auto';
export type Language = 'zh' | 'en';
export type NotifySoundName = 'None' | 'Notify' | 'Ding' | 'Chimes' | 'Chord' | 'Tada' | 'Error';
export type PanelPosition = 'beside' | 'right' | 'left' | 'active';
export type FeedbackAction = 'continue' | 'pause' | 'end' | string;

export type QuickPhrase = { id: string; text: string; order: number };
export type Template = { id: string; name: string; content: string; category: string; createdAt: number };
export type Favorite = { id: string; content: string; note: string; createdAt: number };
export type Stats = {
  totalCalls: number;
  totalContinues: number;
  totalPauses: number;
  totalEnds: number;
  firstUse: number;
  lastUse: number;
};

export type HistoryItem = {
  id: string;
  date: string;
  timestamp: number;
  summary: string;
  feedback: string;
  action: FeedbackAction;
  images: number;
};

export type Config = {
  theme: ThemeMode;
  language: Language;
  notifySound: NotifySoundName;
  panelPosition: PanelPosition;
  summaryHeight: number;
  feedbackHeight: number;
  fontSize: number;
  enterToSend: boolean;
  quickPhrases: QuickPhrase[];
  templates: Template[];
  favorites: Favorite[];
  stats: Stats;
};

const DEFAULT_QUICK_PHRASES: QuickPhrase[] = [];
const DEFAULT_TEMPLATES: Template[] = [];

function getDefaultConfig(): Config {
  return {
    theme: 'dark',
    language: 'zh',
    notifySound: 'Tada',
    panelPosition: 'beside',
    summaryHeight: 180,
    feedbackHeight: 120,
    fontSize: 14,
    enterToSend: false,
    quickPhrases: DEFAULT_QUICK_PHRASES,
    templates: DEFAULT_TEMPLATES,
    favorites: [],
    stats: {
      totalCalls: 0,
      totalContinues: 0,
      totalPauses: 0,
      totalEnds: 0,
      firstUse: Date.now(),
      lastUse: Date.now(),
    },
  };
}

export class DataManager {
  private static instance: DataManager | undefined;

  private config: Config;

  private constructor() {
    this.ensureDataDir();
    this.config = this.loadConfig();
  }

  public static getInstance(): DataManager {
    if (!DataManager.instance) DataManager.instance = new DataManager();
    return DataManager.instance;
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  private loadConfig(): Config {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const loaded = JSON.parse(data) as Partial<Config>;
        return { ...getDefaultConfig(), ...loaded };
      }
    } catch {}
    return getDefaultConfig();
  }

  private saveConfig() {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch {}
  }

  public resetToDefault() {
    this.config = getDefaultConfig();
    this.saveConfig();
  }

  public getConfig(): Config {
    return this.config;
  }

  public getTheme(): ThemeMode {
    return this.config.theme;
  }

  public setTheme(theme: ThemeMode) {
    this.config.theme = theme;
    this.saveConfig();
  }

  public getLanguage(): Language {
    return this.config.language;
  }

  public setLanguage(lang: Language) {
    this.config.language = lang;
    this.saveConfig();
  }

  public getNotifySound(): NotifySoundName {
    return (this.config.notifySound || 'Notify') as NotifySoundName;
  }

  public setNotifySound(sound: NotifySoundName) {
    this.config.notifySound = sound;
    this.saveConfig();
  }

  public getPanelPosition(): PanelPosition {
    return (this.config.panelPosition || 'right') as PanelPosition;
  }

  public setPanelPosition(position: PanelPosition) {
    this.config.panelPosition = position;
    this.saveConfig();
  }

  public getSummaryHeight(): number {
    return this.config.summaryHeight || 550;
  }

  public setSummaryHeight(height: number) {
    this.config.summaryHeight = Math.max(80, Math.min(600, height));
    this.saveConfig();
  }

  public getFeedbackHeight(): number {
    return this.config.feedbackHeight || 110;
  }

  public setFeedbackHeight(height: number) {
    this.config.feedbackHeight = Math.max(60, Math.min(300, height));
    this.saveConfig();
  }

  public getFontSize(): number {
    return this.config.fontSize || 13;
  }

  public setFontSize(size: number) {
    this.config.fontSize = Math.max(12, Math.min(20, size));
    this.saveConfig();
  }

  public getEnterToSend(): boolean {
    return this.config.enterToSend || false;
  }

  public setEnterToSend(enabled: boolean) {
    this.config.enterToSend = enabled;
    this.saveConfig();
  }

  public getQuickPhrases(): QuickPhrase[] {
    return this.config.quickPhrases.sort((a, b) => a.order - b.order);
  }

  public addQuickPhrase(text: string) {
    const id = Date.now().toString();
    const order = this.config.quickPhrases.length;
    this.config.quickPhrases.push({ id, text, order });
    this.saveConfig();
  }

  public updateQuickPhrase(id: string, text: string) {
    const phrase = this.config.quickPhrases.find((p) => p.id === id);
    if (!phrase) return;
    phrase.text = text;
    this.saveConfig();
  }

  public deleteQuickPhrase(id: string) {
    this.config.quickPhrases = this.config.quickPhrases.filter((p) => p.id !== id);
    this.saveConfig();
  }

  public getTemplates(): Template[] {
    return this.config.templates;
  }

  public addTemplate(name: string, content: string, category: string) {
    const id = Date.now().toString();
    this.config.templates.push({ id, name, content, category, createdAt: Date.now() });
    this.saveConfig();
  }

  public updateTemplate(id: string, name: string, content: string, category: string) {
    const template = this.config.templates.find((t) => t.id === id);
    if (!template) return;
    template.name = name;
    template.content = content;
    template.category = category;
    this.saveConfig();
  }

  public deleteTemplate(id: string) {
    this.config.templates = this.config.templates.filter((t) => t.id !== id);
    this.saveConfig();
  }

  public getFavorites(): Favorite[] {
    return this.config.favorites.sort((a, b) => b.createdAt - a.createdAt);
  }

  public addFavorite(content: string, note = '') {
    const id = Date.now().toString();
    this.config.favorites.push({ id, content, note, createdAt: Date.now() });
    this.saveConfig();
  }

  public updateFavorite(id: string, content: string, note: string) {
    const fav = this.config.favorites.find((f) => f.id === id);
    if (!fav) return;
    fav.content = content;
    fav.note = note;
    this.saveConfig();
  }

  public deleteFavorite(id: string) {
    this.config.favorites = this.config.favorites.filter((f) => f.id !== id);
    this.saveConfig();
  }

  public getStats(): Stats {
    return this.config.stats;
  }

  public resetStats() {
    this.config.stats = {
      totalCalls: 0,
      totalContinues: 0,
      totalPauses: 0,
      totalEnds: 0,
      firstUse: Date.now(),
      lastUse: Date.now(),
    };
    this.saveConfig();
  }

  public updateStats(action: FeedbackAction) {
    this.config.stats.totalCalls++;
    this.config.stats.lastUse = Date.now();
    if (action === 'continue') this.config.stats.totalContinues++;
    else if (action === 'pause') this.config.stats.totalPauses++;
    else this.config.stats.totalEnds++;
    this.saveConfig();
  }

  private getHistoryFilePath(date: string) {
    return path.join(HISTORY_DIR, `${date}.json`);
  }

  public saveHistory(item: Omit<HistoryItem, 'id' | 'date'> & Partial<Pick<HistoryItem, 'date'>>) {
    const date = item.date || new Date().toISOString().split('T')[0]!;
    const filePath = this.getHistoryFilePath(date);
    let history: HistoryItem[] = [];
    try {
      if (fs.existsSync(filePath)) history = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HistoryItem[];
    } catch {}

    const newItem: HistoryItem = {
      id: Date.now().toString(),
      date,
      timestamp: item.timestamp,
      summary: item.summary,
      feedback: item.feedback,
      action: item.action,
      images: item.images,
    };

    history.push(newItem);
    if (history.length > 100) history = history.slice(-100);
    try {
      fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf-8');
    } catch {}

    this.updateStats(item.action);
    this.cleanOldData();
  }

  private cleanOldData() {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    try {
      const historyFiles = fs.readdirSync(HISTORY_DIR);
      for (const file of historyFiles) {
        const dateStr = file.replace('.json', '');
        const fileDate = new Date(dateStr).getTime();
        if (Number.isFinite(fileDate) && fileDate < thirtyDaysAgo) fs.unlinkSync(path.join(HISTORY_DIR, file));
      }
    } catch {}

    try {
      const logFiles = fs.readdirSync(LOG_DIR);
      for (const file of logFiles) {
        const filePath = path.join(LOG_DIR, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < thirtyDaysAgo) fs.unlinkSync(filePath);
      }
    } catch {}
  }

  public getHistoryDates(): string[] {
    try {
      const files = fs.readdirSync(HISTORY_DIR);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''))
        .sort((a, b) => b.localeCompare(a));
    } catch {
      return [];
    }
  }

  public getHistoryByDate(date: string): HistoryItem[] {
    const filePath = this.getHistoryFilePath(date);
    try {
      if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HistoryItem[];
    } catch {}
    return [];
  }

  public getAllHistory(): HistoryItem[] {
    const dates = this.getHistoryDates();
    let all: HistoryItem[] = [];
    for (const date of dates) all = all.concat(this.getHistoryByDate(date));
    return all.sort((a, b) => b.timestamp - a.timestamp);
  }

  public searchHistory(query: string): HistoryItem[] {
    const all = this.getAllHistory();
    const q = query.toLowerCase();
    return all.filter((item) => item.summary.toLowerCase().includes(q) || item.feedback.toLowerCase().includes(q));
  }

  public filterHistory(startDate: string, endDate: string, action: 'all' | FeedbackAction): HistoryItem[] {
    let all = this.getAllHistory();
    if (startDate) all = all.filter((item) => item.date >= startDate);
    if (endDate) all = all.filter((item) => item.date <= endDate);
    if (action && action !== 'all') all = all.filter((item) => item.action === action);
    return all;
  }

  public exportHistory(format: 'json' | 'csv' | 'md'): string {
    const history = this.getAllHistory();
    if (format === 'json') return JSON.stringify(history, null, 2);
    if (format === 'csv') {
      const header = 'ID,Date,Time,Summary,Feedback,Action,Images\n';
      const rows = history
        .map((h) => {
          const time = new Date(h.timestamp).toLocaleTimeString();
          return `"${h.id}","${h.date}","${time}","${h.summary.replace(/"/g, '""')}","${h.feedback.replace(/"/g, '""')}","${h.action}",${h.images}`;
        })
        .join('\n');
      return header + rows;
    }
    if (format === 'md') {
      let md = '# Infinite Dialog History\n\n';
      const grouped = new Map<string, HistoryItem[]>();
      for (const item of history) {
        if (!grouped.has(item.date)) grouped.set(item.date, []);
        grouped.get(item.date)!.push(item);
      }
      for (const [date, items] of grouped) {
        md += `## ${date}\n\n`;
        for (const item of items) {
          const time = new Date(item.timestamp).toLocaleTimeString();
          const actionIcon = item.action === 'continue' ? '✅' : item.action === 'pause' ? '⏸️' : '🛑';
          md += `### ${time} ${actionIcon}\n\n`;
          md += `**Summary:** ${item.summary}\n\n`;
          if (item.feedback) md += `**Feedback:** ${item.feedback}\n\n`;
          md += '---\n\n';
        }
      }
      return md;
    }
    return '';
  }

  public async exportToFile() {
    const format = await vscode.window.showQuickPick(['JSON', 'CSV', 'Markdown'], { placeHolder: '选择导出格式' });
    if (!format) return;
    const ext = format === 'JSON' ? 'json' : format === 'CSV' ? 'csv' : 'md';
    const content = this.exportHistory(ext);
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`infinite-dialog-history.${ext}`),
      filters: { [format]: [ext] },
    });
    if (!uri) return;
    fs.writeFileSync(uri.fsPath, content, 'utf-8');
    void vscode.window.showInformationMessage(`历史记录已导出到 ${uri.fsPath}`);
  }

  public async exportHistoryByIds(ids: string[]) {
    const allHistory = this.getAllHistory();
    const selected = allHistory.filter((h) => ids.includes(h.id));
    if (selected.length === 0) {
      void vscode.window.showWarningMessage('未找到选中的历史记录');
      return;
    }
    const format = await vscode.window.showQuickPick(['JSON', 'Markdown'], { placeHolder: '选择导出格式' });
    if (!format) return;
    let content = '';
    let ext = '';
    if (format === 'JSON') {
      content = JSON.stringify(selected, null, 2);
      ext = 'json';
    } else {
      let md = '# 导出的历史记录\n\n';
      for (const item of selected) {
        const time = new Date(item.timestamp).toLocaleString();
        const actionIcon = item.action === 'continue' ? '✅' : item.action === 'pause' ? '⏸️' : '🛑';
        md += `## ${time} ${actionIcon}\n\n`;
        md += `**摘要:** ${item.summary}\n\n`;
        if (item.feedback) md += `**反馈:** ${item.feedback}\n\n`;
        md += '---\n\n';
      }
      content = md;
      ext = 'md';
    }
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`history-export.${ext}`),
      filters: { [format]: [ext] },
    });
    if (!uri) return;
    fs.writeFileSync(uri.fsPath, content, 'utf-8');
    void vscode.window.showInformationMessage(`已导出 ${selected.length} 条记录到 ${uri.fsPath}`);
  }

  public async importFromFile() {
    const uri = await vscode.window.showOpenDialog({ filters: { JSON: ['json'] }, canSelectMany: false });
    if (!uri || uri.length === 0) return;
    try {
      const content = fs.readFileSync(uri[0].fsPath, 'utf-8');
      const data = JSON.parse(content) as Partial<Pick<Config, 'quickPhrases' | 'templates' | 'favorites'>>;
      if (data.quickPhrases) this.config.quickPhrases = data.quickPhrases as QuickPhrase[];
      if (data.templates) this.config.templates = data.templates as Template[];
      if (data.favorites) this.config.favorites = data.favorites as Favorite[];
      this.saveConfig();
      void vscode.window.showInformationMessage('导入成功！');
    } catch {
      void vscode.window.showErrorMessage('导入失败，请检查文件格式');
    }
  }

  public exportConfig(): string {
    return JSON.stringify(
      {
        quickPhrases: this.config.quickPhrases,
        templates: this.config.templates,
        favorites: this.config.favorites,
      },
      null,
      2
    );
  }

  public clearHistory() {
    try {
      const files = fs.readdirSync(HISTORY_DIR);
      for (const file of files) fs.unlinkSync(path.join(HISTORY_DIR, file));
      void vscode.window.showInformationMessage('历史记录已清空');
    } catch {}
  }

  public log(event: string, payload?: unknown) {
    try {
      const date = new Date().toISOString().split('T')[0]!;
      const filePath = path.join(LOG_DIR, `${date}.log`);
      const time = new Date().toISOString();
      const line = payload ? `${time} ${event} ${JSON.stringify(payload)}\n` : `${time} ${event}\n`;
      fs.appendFileSync(filePath, line, 'utf-8');
    } catch {}
  }
}

export const I18N = {
  zh: {
    serverStatus: '服务状态',
    running: '运行中',
    stopped: '未启动',
    stats: '统计数据',
    totalCalls: '总调用',
    continues: '继续',
    pauses: '暂缓',
    ends: '结束',
    history: '历史记录',
    templates: '模板',
    favorites: '收藏',
    settings: '设置',
    testPanel: '测试弹窗',
    copyPort: '复制端口',
    refresh: '刷新',
    export: '导出',
    import: '导入',
    search: '搜索',
    filter: '过滤',
    clear: '清空',
    save: '保存',
    cancel: '取消',
    delete: '删除',
    edit: '编辑',
    add: '添加',
    quickReplies: '快捷回复',
    customFeedback: '自定义反馈',
    images: '图片',
    continue: '继续',
    pause: '暂缓',
    end: '结束',
    dragOrPaste: '点击或拖拽图片，或 Ctrl+V 粘贴',
    dragFile: '拖拽文件获取路径',
    noHistory: '暂无历史记录',
    theme: '主题',
    language: '语言',
    dark: '深色',
    light: '浅色',
    auto: '自动',
  },
  en: {
    serverStatus: 'Server Status',
    running: 'Running',
    stopped: 'Stopped',
    stats: 'Statistics',
    totalCalls: 'Total Calls',
    continues: 'Continues',
    pauses: 'Pauses',
    ends: 'Ends',
    history: 'History',
    templates: 'Templates',
    favorites: 'Favorites',
    settings: 'Settings',
    testPanel: 'Test Panel',
    copyPort: 'Copy Port',
    refresh: 'Refresh',
    export: 'Export',
    import: 'Import',
    search: 'Search',
    filter: 'Filter',
    clear: 'Clear',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    quickReplies: 'Quick Replies',
    customFeedback: 'Custom Feedback',
    images: 'Images',
    continue: 'Continue',
    pause: 'Pause',
    end: 'End',
    dragOrPaste: 'Click or drag image, or Ctrl+V to paste',
    dragFile: 'Drag file to get path',
    noHistory: 'No history yet',
    theme: 'Theme',
    language: 'Language',
    dark: 'Dark',
    light: 'Light',
    auto: 'Auto',
  },
} as const;

export function t(key: keyof (typeof I18N)['zh']): string {
  const dm = DataManager.getInstance();
  const lang = dm.getLanguage();
  return (I18N[lang] as any)[key] || (I18N.zh as any)[key];
}

