const vscode = require("vscode");
const net = require("net");
const crypto = require("crypto");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 61337;
const MAX_PORT_TRIES = 20;

function randomId() {
  return crypto.randomBytes(12).toString("hex");
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function createOutputChannel() {
  return vscode.window.createOutputChannel("AI伟哥", { log: true });
}

function getNonce() {
  return crypto.randomBytes(16).toString("base64");
}

function buildWebviewHtml({ cspNonce }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${cspNonce}'; script-src 'nonce-${cspNonce}';" />
    <title>AI伟哥</title>
    <style nonce="${cspNonce}">
      :root {
        --bg: var(--vscode-editor-background);
        --fg: var(--vscode-editor-foreground);
        --muted: color-mix(in srgb, var(--fg) 55%, transparent);
        --border: color-mix(in srgb, var(--fg) 12%, transparent);
        --panel: color-mix(in srgb, var(--bg) 92%, white);
        --bubble-ai: color-mix(in srgb, #7c3aed 14%, var(--bg));
        --bubble-me: color-mix(in srgb, #0ea5e9 18%, var(--bg));
        --shadow: 0 10px 28px rgba(0, 0, 0, 0.25);
        --radius: 14px;
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body {
        margin: 0;
        background: radial-gradient(1200px 800px at 20% -10%, rgba(124,58,237,.18), transparent 60%),
                    radial-gradient(900px 700px at 110% 10%, rgba(14,165,233,.16), transparent 55%),
                    var(--bg);
        color: var(--fg);
        font: 13px/1.45 var(--vscode-font-family);
      }
      .wrap {
        height: 100%;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 10px;
        padding: 12px;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: color-mix(in srgb, var(--panel) 88%, transparent);
        box-shadow: var(--shadow);
      }
      .brand {
        display: flex;
        gap: 10px;
        align-items: center;
        min-width: 0;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: linear-gradient(135deg, #7c3aed, #0ea5e9);
        box-shadow: 0 0 0 4px rgba(124,58,237,.12);
      }
      .title {
        font-weight: 700;
        letter-spacing: 0.2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .subtitle {
        color: var(--muted);
        font-size: 12px;
      }
      .right {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .badge {
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel) 86%, transparent);
        padding: 6px 10px;
        border-radius: 999px;
        color: var(--muted);
        font-size: 12px;
      }
      select.reqsel {
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel) 86%, transparent);
        color: color-mix(in srgb, var(--fg) 80%, transparent);
        border-radius: 999px;
        padding: 6px 10px;
        font: 12px/1.2 var(--vscode-font-family);
        max-width: 260px;
        outline: none;
      }
      select.reqsel:focus {
        border-color: color-mix(in srgb, #7c3aed 55%, var(--border));
        box-shadow: 0 0 0 4px rgba(124,58,237,.14);
      }
      .log {
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: color-mix(in srgb, var(--panel) 86%, transparent);
        box-shadow: var(--shadow);
        overflow: hidden;
        display: grid;
        grid-template-rows: 1fr;
      }
      .scroll {
        overflow: auto;
        padding: 14px;
        scrollbar-gutter: stable;
      }
      .row {
        display: flex;
        margin: 10px 0;
        gap: 10px;
        align-items: flex-end;
      }
      .row.ai { justify-content: flex-start; }
      .row.me { justify-content: flex-end; }
      .avatar {
        width: 34px;
        height: 34px;
        border-radius: 999px;
        border: 1px solid var(--border);
        display: grid;
        place-items: center;
        font-weight: 800;
        letter-spacing: 0.2px;
        user-select: none;
        flex: 0 0 auto;
        box-shadow: 0 8px 18px rgba(0,0,0,.18);
      }
      .avatar.ai {
        background: linear-gradient(135deg, rgba(124,58,237,.85), rgba(14,165,233,.70));
        color: rgba(255,255,255,.92);
      }
      .avatar.me {
        background: linear-gradient(135deg, rgba(14,165,233,.85), rgba(34,197,94,.70));
        color: rgba(255,255,255,.92);
      }
      .bubble {
        max-width: min(820px, 92%);
        padding: 10px 12px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: var(--panel);
        box-shadow: 0 8px 18px rgba(0,0,0,.18);
        position: relative;
        overflow: hidden;
      }
      .row.ai .bubble { background: var(--bubble-ai); }
      .row.me .bubble { background: var(--bubble-me); }
      .meta {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin-bottom: 6px;
      }
      .actions {
        margin-left: auto;
        display: flex;
        gap: 6px;
        align-items: center;
      }
      button.iconbtn {
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel) 86%, transparent);
        color: color-mix(in srgb, var(--fg) 78%, transparent);
        border-radius: 10px;
        padding: 4px 8px;
        font-weight: 700;
        cursor: pointer;
        min-width: unset;
      }
      button.iconbtn:hover {
        border-color: color-mix(in srgb, #7c3aed 55%, var(--border));
      }
      .who { font-weight: 700; font-size: 12px; }
      .when { color: var(--muted); font-size: 11px; }
      .text {
        white-space: pre-wrap;
        word-break: break-word;
      }
      .text .md p { margin: 6px 0; }
      .text .md h1, .text .md h2, .text .md h3 {
        margin: 10px 0 6px;
        line-height: 1.2;
      }
      .text .md h1 { font-size: 16px; }
      .text .md h2 { font-size: 15px; }
      .text .md h3 { font-size: 14px; }
      .text .md a { color: color-mix(in srgb, #0ea5e9 78%, white); text-decoration: none; }
      .text .md a:hover { text-decoration: underline; }
      .text code.inline {
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--bg) 88%, white);
      }
      .text pre.code {
        margin: 0;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--bg) 86%, black);
        overflow: auto;
      }
      .codewrap {
        margin: 8px 0 2px;
        border-radius: 12px;
        border: 1px solid var(--border);
        overflow: hidden;
      }
      .codebar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 10px;
        background: color-mix(in srgb, var(--panel) 88%, transparent);
        border-bottom: 1px solid var(--border);
      }
      .codebar .lang {
        font-size: 11px;
        color: color-mix(in srgb, var(--fg) 70%, transparent);
        font-weight: 800;
        letter-spacing: 0.2px;
      }
      .codebar .btns {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .codewrap.collapsed pre { display: none; }
      .text pre.code code {
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        white-space: pre;
      }
      .hl-comment { color: color-mix(in srgb, var(--fg) 45%, transparent); }
      .hl-string { color: color-mix(in srgb, #f59e0b 78%, var(--fg)); }
      .hl-number { color: color-mix(in srgb, #22c55e 70%, var(--fg)); }
      .hl-keyword { color: color-mix(in srgb, #a78bfa 78%, var(--fg)); font-weight: 700; }
      .hl-builtin { color: color-mix(in srgb, #38bdf8 75%, var(--fg)); }
      .hl-type { color: color-mix(in srgb, #fb7185 70%, var(--fg)); font-weight: 700; }
      .request {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed color-mix(in srgb, var(--fg) 18%, transparent);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .pill {
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid var(--border);
        color: color-mix(in srgb, var(--fg) 72%, transparent);
        background: color-mix(in srgb, var(--panel) 86%, transparent);
      }
      .composer {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 10px;
        padding: 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: color-mix(in srgb, var(--panel) 88%, transparent);
        box-shadow: var(--shadow);
      }
      .optionsBox {
        margin-bottom: 10px;
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: color-mix(in srgb, var(--panel) 88%, transparent);
        box-shadow: var(--shadow);
      }
      .optionsTop {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }
      .optionsTop .label {
        font-weight: 800;
        color: color-mix(in srgb, var(--fg) 85%, transparent);
      }
      .optionsList {
        display: grid;
        gap: 8px;
      }
      .opt {
        display: grid;
        grid-template-columns: 18px 1fr;
        gap: 10px;
        align-items: start;
        padding: 8px 10px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: color-mix(in srgb, var(--bg) 88%, white);
      }
      .opt input { margin-top: 2px; }
      .opt .txt { white-space: pre-wrap; word-break: break-word; }
      .attachmentsBox {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        padding: 6px 10px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: color-mix(in srgb, var(--panel) 88%, transparent);
        color: color-mix(in srgb, var(--fg) 80%, transparent);
        font-size: 12px;
        max-width: 100%;
      }
      .chip .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 360px;
      }
      .chip .x {
        border: 1px solid var(--border);
        background: transparent;
        color: color-mix(in srgb, var(--fg) 75%, transparent);
        border-radius: 999px;
        padding: 2px 6px;
        cursor: pointer;
        min-width: unset;
      }
      .imgPrev {
        width: 44px;
        height: 44px;
        border-radius: 10px;
        border: 1px solid var(--border);
        object-fit: cover;
        box-shadow: 0 8px 18px rgba(0,0,0,.18);
      }
      textarea {
        resize: none;
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 10px 12px;
        outline: none;
        background: color-mix(in srgb, var(--bg) 88%, white);
        color: var(--fg);
        font: 13px/1.45 var(--vscode-font-family);
        min-height: 44px;
        max-height: 160px;
        overflow: auto;
      }
      textarea.dropActive {
        border-color: color-mix(in srgb, #22c55e 55%, var(--border));
        box-shadow: 0 0 0 4px rgba(34,197,94,.16);
      }
      textarea:focus {
        border-color: color-mix(in srgb, #7c3aed 55%, var(--border));
        box-shadow: 0 0 0 4px rgba(124,58,237,.14);
      }
      button {
        border: 1px solid color-mix(in srgb, #7c3aed 50%, var(--border));
        background: linear-gradient(135deg, rgba(124,58,237,.92), rgba(14,165,233,.92));
        color: white;
        border-radius: 12px;
        padding: 10px 14px;
        font-weight: 700;
        cursor: pointer;
        min-width: 90px;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
        filter: grayscale(0.25);
      }
      button.attach {
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel) 86%, transparent);
        color: color-mix(in srgb, var(--fg) 85%, transparent);
        min-width: unset;
        padding: 10px 12px;
      }
      button.attach:hover {
        border-color: color-mix(in srgb, #0ea5e9 55%, var(--border));
      }
      .hint {
        padding: 0 2px;
        margin-top: 8px;
        color: var(--muted);
        font-size: 11px;
      }
      .empty {
        height: 100%;
        display: grid;
        place-items: center;
        color: var(--muted);
        font-size: 12px;
        padding: 18px;
        text-align: center;
      }
      .kbd {
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel) 88%, transparent);
        padding: 2px 6px;
        border-radius: 6px;
        font-size: 11px;
        color: color-mix(in srgb, var(--fg) 75%, transparent);
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <div class="brand">
          <div class="dot"></div>
          <div style="min-width: 0;">
            <div class="title">AI伟哥</div>
            <div class="subtitle" id="subtitle">Waiting for MCP tool calls…</div>
          </div>
        </div>
        <div class="right">
          <div class="badge" id="pendingBadge">pending: 0</div>
          <div class="badge" id="callsBadge">calls: 0</div>
          <select class="reqsel" id="requestSelect" style="display:none;"></select>
          <div class="badge" id="portBadge">port: ?</div>
        </div>
      </div>

      <div class="log">
        <div class="scroll" id="scroll">
          <div class="empty" id="empty">
            No messages yet.<br/>
            When the AI calls the MCP tool, the message will appear here.
          </div>
        </div>
      </div>

      <div>
        <div class="optionsBox" id="optionsBox" style="display:none;">
          <div class="optionsTop">
            <div class="label" id="optionsLabel">Options</div>
            <button class="iconbtn" id="optionsClear" type="button">Clear</button>
          </div>
          <div class="optionsList" id="optionsList"></div>
        </div>
        <div class="composer">
          <textarea id="input" placeholder="Type your reply…"></textarea>
          <button class="attach" id="attach" type="button">Attach</button>
          <button id="send" disabled>Send</button>
          <input id="fileInput" type="file" multiple style="display:none;" />
        </div>
        <div class="attachmentsBox" id="attachmentsBox" style="display:none;"></div>
        <div class="hint">
          <span class="kbd">Enter</span> send · <span class="kbd">Shift</span> + <span class="kbd">Enter</span> newline
        </div>
      </div>
    </div>

    <script nonce="${cspNonce}">
      const vscode = acquireVsCodeApi();
      const scroll = document.getElementById("scroll");
      let empty = document.getElementById("empty");
      const input = document.getElementById("input");
      const attach = document.getElementById("attach");
      const fileInput = document.getElementById("fileInput");
      const send = document.getElementById("send");
      const optionsBox = document.getElementById("optionsBox");
      const optionsList = document.getElementById("optionsList");
      const optionsClear = document.getElementById("optionsClear");
      const attachmentsBox = document.getElementById("attachmentsBox");
      const pendingBadge = document.getElementById("pendingBadge");
      const callsBadge = document.getElementById("callsBadge");
      const requestSelect = document.getElementById("requestSelect");
      const portBadge = document.getElementById("portBadge");
      const subtitle = document.getElementById("subtitle");

      let pendingQueue = [];
      let activeRequest = null;
      let selectedOptions = new Set();
      let attachments = [];
      let bridgePort = null;
      let callCount = 0;

      function escapeHtml(s) {
        return String(s)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function highlightCode(escapedCode, lang) {
        const keywordsByLang = {
          js: ["await","break","case","catch","class","const","continue","debugger","default","delete","do","else","export","extends","finally","for","function","if","import","in","instanceof","let","new","of","return","super","switch","this","throw","try","typeof","var","void","while","with","yield"],
          ts: ["abstract","any","as","asserts","async","await","bigint","boolean","break","case","catch","class","const","constructor","continue","debugger","declare","default","delete","do","else","enum","export","extends","false","finally","for","from","function","get","if","implements","import","in","infer","instanceof","interface","is","keyof","let","module","namespace","never","new","null","number","object","of","private","protected","public","readonly","return","set","static","string","super","switch","symbol","this","throw","true","try","type","typeof","undefined","unique","unknown","var","void","while","with","yield"],
          json: ["true","false","null"],
          py: ["and","as","assert","async","await","break","class","continue","def","del","elif","else","except","False","finally","for","from","global","if","import","in","is","lambda","None","nonlocal","not","or","pass","raise","return","True","try","while","with","yield"],
          bash: ["if","then","else","elif","fi","for","in","do","done","case","esac","while","until","function","return","local","export","unset","readonly","shift","break","continue"],
          go: ["break","case","chan","const","continue","default","defer","else","fallthrough","for","func","go","goto","if","import","interface","map","package","range","return","select","struct","switch","type","var"],
          rust: ["as","async","await","break","const","continue","crate","dyn","else","enum","extern","false","fn","for","if","impl","in","let","loop","match","mod","move","mut","pub","ref","return","self","Self","static","struct","super","trait","true","type","unsafe","use","where","while"],
          java: ["abstract","assert","boolean","break","byte","case","catch","char","class","const","continue","default","do","double","else","enum","extends","final","finally","float","for","goto","if","implements","import","instanceof","int","interface","long","native","new","package","private","protected","public","return","short","static","strictfp","super","switch","synchronized","this","throw","throws","transient","try","void","volatile","while"],
          c: ["auto","break","case","char","const","continue","default","do","double","else","enum","extern","float","for","goto","if","inline","int","long","register","restrict","return","short","signed","sizeof","static","struct","switch","typedef","union","unsigned","void","volatile","while"],
          cpp: ["alignas","alignof","and","and_eq","asm","auto","bitand","bitor","bool","break","case","catch","char","char8_t","char16_t","char32_t","class","compl","concept","const","consteval","constexpr","constinit","continue","co_await","co_return","co_yield","decltype","default","delete","do","double","dynamic_cast","else","enum","explicit","export","extern","false","float","for","friend","goto","if","inline","int","long","mutable","namespace","new","noexcept","not","not_eq","nullptr","operator","or","or_eq","private","protected","public","register","reinterpret_cast","requires","return","short","signed","sizeof","static","static_assert","static_cast","struct","switch","template","this","thread_local","throw","true","try","typedef","typeid","typename","union","unsigned","using","virtual","void","volatile","wchar_t","while","xor","xor_eq"],
          sql: ["select","from","where","and","or","insert","into","update","set","delete","join","left","right","inner","outer","on","group","by","order","limit","offset","having","as","distinct","create","table","alter","drop","primary","key","foreign","values","null","not","is","in","like","between","exists","union","all"]
        };

        const builtinsByLang = {
          js: ["console","Math","JSON","Date","Promise","Map","Set","RegExp","String","Number","Boolean","Object","Array","Error","BigInt"],
          py: ["print","len","range","str","int","float","dict","list","set","tuple","bool","type","isinstance","enumerate","zip","map","filter","sum","min","max","sorted","open","Exception"],
          go: ["len","cap","make","new","append","copy","delete","panic","recover","close","complex","real","imag","println","print"],
          rust: ["println","format","vec","Some","None","Ok","Err"]
        };

        const typesByLang = {
          ts: ["string","number","boolean","any","unknown","never","void","null","undefined","object","Record","Partial","Pick","Omit","Readonly","Promise","Array","Map","Set"],
          go: ["string","int","int64","float64","bool","byte","rune","error"],
          rust: ["String","str","i32","i64","u32","u64","usize","isize","bool","Option","Result","Vec"]
        };

        const map = new Map();
        let s = escapedCode;
        let idx = 0;

        const placehold = (match, cls) => {
          const token = "@@HL_" + (idx++) + "@@";
          map.set(token, "<span class=\"" + cls + "\">" + match + "</span>");
          return token;
        };

        const commentRe = lang === "py"
          ? /#.*$/gm
          : /\/\/.*$|\/\*[\s\S]*?\*\//gm;

        const stringRe = lang === "json"
          ? /"(?:\\.|[^"\\])*"/g
          : /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\\x60(?:\\.|[^\\x60\\\\])*\\x60/g;

        s = s.replace(commentRe, (m) => placehold(m, "hl-comment"));
        s = s.replace(stringRe, (m) => placehold(m, "hl-string"));

        s = s.replace(/\b\d+(?:\.\d+)?\b/g, "<span class=\"hl-number\">$&</span>");

        const langKey = lang === "typescript" ? "ts" : lang === "javascript" ? "js" : lang;
        const kws = keywordsByLang[langKey] || keywordsByLang.js;
        const kwRe = new RegExp("\\\\b(" + kws.map((k) => k.replace(/[.*+?^\\$\\{\\}()|[\\]\\\\]/g, "\\\\$&")).join("|") + ")\\\\b", "g");
        s = s.replace(kwRe, "<span class=\"hl-keyword\">$1</span>");

        const builtins = builtinsByLang[langKey];
        if (builtins && builtins.length) {
          const biRe = new RegExp("\\\\b(" + builtins.map((k) => k.replace(/[.*+?^\\$\\{\\}()|[\\]\\\\]/g, "\\\\$&")).join("|") + ")\\\\b", "g");
          s = s.replace(biRe, "<span class=\"hl-builtin\">$1</span>");
        }

        const types = typesByLang[langKey];
        if (types && types.length) {
          const tyRe = new RegExp("\\\\b(" + types.map((k) => k.replace(/[.*+?^\\$\\{\\}()|[\\]\\\\]/g, "\\\\$&")).join("|") + ")\\\\b", "g");
          s = s.replace(tyRe, "<span class=\"hl-type\">$1</span>");
        }

        for (const [token, html] of map.entries()) {
          s = s.replaceAll(token, html);
        }
        return s;
      }

      function renderMarkdown(md) {
        const lines = String(md ?? "").split("\\n");
        let inCode = false;
        let codeLang = "text";
        let codeBuf = [];
        let html = "";
        let para = [];

        const flushPara = () => {
          if (para.length === 0) return;
          const raw = para.join("\\n");
          const tokenMap = new Map();
          let tokenIdx = 0;

          const token = (htmlChunk) => {
            const t = "@@MD_" + (tokenIdx++) + "@@";
            tokenMap.set(t, htmlChunk);
            return t;
          };

          let s = raw;
          s = s.replace(/\\x60([^\\x60]+)\\x60/g, (_m, g1) => token("<code class=\"inline\">" + escapeHtml(g1) + "</code>"));
          s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, (_m, t, u) => token("<a href=\"" + escapeHtml(u) + "\">" + escapeHtml(t) + "</a>"));
          s = escapeHtml(s);

          const withHeadings = s
            .replace(/^###\\s+(.+)$/gm, "<h3>$1</h3>")
            .replace(/^##\\s+(.+)$/gm, "<h2>$1</h2>")
            .replace(/^#\\s+(.+)$/gm, "<h1>$1</h1>");

          let out = withHeadings;
          for (const [t, htmlChunk] of tokenMap.entries()) {
            out = out.replaceAll(t, htmlChunk);
          }

          html += "<p>" + out.replaceAll("\\n", "<br/>") + "</p>";
          para = [];
        };

        for (const line of lines) {
          const fence = line.match(/^\\x60\\x60\\x60\\s*([A-Za-z0-9_-]+)?\\s*$/);
          if (fence) {
            if (!inCode) {
              flushPara();
              inCode = true;
              codeLang = (fence[1] || "text").toLowerCase();
              codeBuf = [];
            } else {
              inCode = false;
              const code = codeBuf.join("\\n");
              const escapedCode = escapeHtml(code);
              const highlighted = highlightCode(escapedCode, codeLang);
              const safeLang = escapeHtml(codeLang);
              html += "<div class=\"codewrap\" data-lang=\"" + safeLang + "\"><div class=\"codebar\"><div class=\"lang\">" + safeLang + "</div><div class=\"btns\"><button class=\"iconbtn\" data-action=\"copy-code\">Copy</button><button class=\"iconbtn\" data-action=\"toggle-code\">Collapse</button></div></div><pre class=\"code\"><code data-lang=\"" + safeLang + "\">" + highlighted + "</code></pre></div>";
              codeBuf = [];
            }
            continue;
          }

          if (inCode) {
            codeBuf.push(line);
            continue;
          }

          if (line.trim() === "") {
            flushPara();
            continue;
          }

          para.push(line);
        }

        flushPara();
        return "<div class=\"md\">" + html + "</div>";
      }

      function renderBody(text, isMarkdown) {
        if (isMarkdown === false) {
          const s = escapeHtml(String(text ?? ""));
          return "<div class=\"md\"><p>" + s.replaceAll("\\n", "<br/>") + "</p></div>";
        }
        return renderMarkdown(text);
      }

      function updateBadges() {
        pendingBadge.textContent = "pending: " + pendingQueue.length;
        callsBadge.textContent = "calls: " + callCount;
        portBadge.textContent = "port: " + (bridgePort ?? "?");
        const hasPayload = input.value.trim().length > 0 || selectedOptions.size > 0 || attachments.length > 0;
        send.disabled = pendingQueue.length === 0 || !hasPayload;
        subtitle.textContent =
          pendingQueue.length === 0 ? "Waiting for MCP tool calls…" : "Awaiting your reply… · calls: " + callCount;
      }

      function setActiveFromQueue() {
        activeRequest = pendingQueue.length ? pendingQueue[0] : null;
        selectedOptions = new Set();
        attachments = [];
        attach.style.display = activeRequest && activeRequest.acceptAttachments === false ? "none" : "";
        renderOptions();
        renderAttachments();
        renderRequestSelect();
        updateBadges();
      }

      function setActiveById(requestId) {
        const r = pendingQueue.find((x) => x.requestId === requestId) || null;
        activeRequest = r;
        selectedOptions = new Set();
        attachments = [];
        attach.style.display = activeRequest && activeRequest.acceptAttachments === false ? "none" : "";
        renderOptions();
        renderAttachments();
        renderRequestSelect();
        updateBadges();
      }

      function normalizeOptions(opts) {
        if (!Array.isArray(opts)) return [];
        const out = [];
        for (const o of opts) {
          if (typeof o === "string") out.push({ label: o, value: o });
          else if (o && typeof o === "object") {
            const label = typeof o.label === "string" ? o.label : typeof o.value === "string" ? o.value : "";
            const value = typeof o.value === "string" ? o.value : label;
            if (label) out.push({ label, value });
          }
        }
        return out;
      }

      function renderOptions() {
        const opts = normalizeOptions(activeRequest?.options);
        if (!activeRequest || opts.length === 0) {
          optionsBox.style.display = "none";
          while (optionsList.firstChild) optionsList.removeChild(optionsList.firstChild);
          return;
        }
        optionsBox.style.display = "";
        while (optionsList.firstChild) optionsList.removeChild(optionsList.firstChild);

        const multi = activeRequest.multiSelect !== false;
        for (const opt of opts) {
          const row = document.createElement("label");
          row.className = "opt";

          const cb = document.createElement("input");
          cb.type = multi ? "checkbox" : "radio";
          cb.name = "reqopt";
          cb.checked = selectedOptions.has(opt.value);
          cb.addEventListener("change", () => {
            if (multi) {
              if (cb.checked) selectedOptions.add(opt.value);
              else selectedOptions.delete(opt.value);
            } else {
              selectedOptions = cb.checked ? new Set([opt.value]) : new Set();
              renderOptions();
            }
            updateBadges();
          });

          const txt = document.createElement("div");
          txt.className = "txt";
          txt.textContent = opt.label;

          row.appendChild(cb);
          row.appendChild(txt);
          optionsList.appendChild(row);
        }
      }

      optionsClear.addEventListener("click", () => {
        selectedOptions = new Set();
        renderOptions();
        updateBadges();
      });

      function renderRequestSelect() {
        if (pendingQueue.length <= 1) {
          requestSelect.style.display = "none";
          while (requestSelect.firstChild) requestSelect.removeChild(requestSelect.firstChild);
          return;
        }
        requestSelect.style.display = "";
        const current = activeRequest?.requestId || pendingQueue[0]?.requestId;
        while (requestSelect.firstChild) requestSelect.removeChild(requestSelect.firstChild);
        for (const r of pendingQueue) {
          const opt = document.createElement("option");
          const idShort = String(r.requestId || "").slice(0, 8);
          const label = r.title ? String(r.title) : "AI";
          opt.value = r.requestId;
          opt.textContent = label + " · " + idShort;
          if (r.requestId === current) opt.selected = true;
          requestSelect.appendChild(opt);
        }
      }

      requestSelect.addEventListener("change", () => {
        const id = requestSelect.value;
        if (id) setActiveById(id);
      });

      function base64FromArrayBuffer(buf) {
        let binary = "";
        const bytes = new Uint8Array(buf);
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.subarray(i, i + chunkSize);
          binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
      }

      async function fileToAttachment(file) {
        const arrayBuffer = await file.arrayBuffer();
        const dataBase64 = base64FromArrayBuffer(arrayBuffer);
        const mime = file.type || "application/octet-stream";
        const kind = mime.startsWith("image/") ? "image" : "file";
        const id = String(Date.now()) + "-" + Math.random().toString(16).slice(2);
        return {
          id,
          kind,
          name: file.name || (kind === "image" ? "pasted-image" : "file"),
          mime,
          size: file.size || arrayBuffer.byteLength,
          dataBase64
        };
      }

      async function addFiles(files) {
        if (activeRequest && activeRequest.acceptAttachments === false) return;
        const list = Array.from(files || []);
        if (list.length === 0) return;
        for (const f of list) {
          if (attachments.length >= 8) break;
          if (f.size && f.size > 8 * 1024 * 1024) continue;
          const att = await fileToAttachment(f);
          attachments.push(att);
        }
        renderAttachments();
        updateBadges();
      }

      function renderAttachments() {
        if (activeRequest && activeRequest.acceptAttachments === false) {
          attachmentsBox.style.display = "none";
          while (attachmentsBox.firstChild) attachmentsBox.removeChild(attachmentsBox.firstChild);
          attachments = [];
          return;
        }
        if (attachments.length === 0) {
          attachmentsBox.style.display = "none";
          while (attachmentsBox.firstChild) attachmentsBox.removeChild(attachmentsBox.firstChild);
          return;
        }
        attachmentsBox.style.display = "";
        while (attachmentsBox.firstChild) attachmentsBox.removeChild(attachmentsBox.firstChild);

        for (const att of attachments) {
          const chip = document.createElement("div");
          chip.className = "chip";
          chip.dataset.id = att.id;

          if (att.kind === "image") {
            const img = document.createElement("img");
            img.className = "imgPrev";
            img.alt = att.name;
            img.src = "data:" + att.mime + ";base64," + att.dataBase64;
            chip.appendChild(img);
          }

          const name = document.createElement("div");
          name.className = "name";
          name.textContent = att.name;
          chip.appendChild(name);

          const x = document.createElement("button");
          x.className = "x";
          x.type = "button";
          x.textContent = "×";
          x.addEventListener("click", () => {
            attachments = attachments.filter((a) => a.id !== att.id);
            renderAttachments();
            updateBadges();
          });
          chip.appendChild(x);

          attachmentsBox.appendChild(chip);
        }
      }

      function nowLabel() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
      }

      function appendMessage({ who, text, requestId, title, isMarkdown, callIndex }) {
        if (empty) {
          empty.remove();
          empty = null;
        }
        const row = document.createElement("div");
        row.className = "row " + (who === "me" ? "me" : "ai");

        const avatar = document.createElement("div");
        avatar.className = "avatar " + (who === "me" ? "me" : "ai");
        avatar.textContent = who === "me" ? "Y" : "A";

        const bubble = document.createElement("div");
        bubble.className = "bubble";
        bubble.dataset.raw = String(text ?? "");

        const meta = document.createElement("div");
        meta.className = "meta";
        const whoEl = document.createElement("div");
        whoEl.className = "who";
        whoEl.textContent = who === "me" ? "You" : (title ? title : "AI");
        const whenEl = document.createElement("div");
        whenEl.className = "when";
        whenEl.textContent = nowLabel();
        meta.appendChild(whoEl);
        meta.appendChild(whenEl);

        const actions = document.createElement("div");
        actions.className = "actions";
        const copyBtn = document.createElement("button");
        copyBtn.className = "iconbtn";
        copyBtn.dataset.action = "copy-message";
        copyBtn.textContent = "Copy";
        actions.appendChild(copyBtn);
        meta.appendChild(actions);

        const body = document.createElement("div");
        body.className = "text";
        body.innerHTML = renderBody(text ?? "", isMarkdown);

        bubble.appendChild(meta);
        bubble.appendChild(body);

        if (requestId && who !== "me") {
          const req = document.createElement("div");
          req.className = "request";
          const pill = document.createElement("div");
          pill.className = "pill";
          pill.textContent = "requestId: " + requestId.slice(0, 8);
          const cnt = document.createElement("div");
          cnt.className = "pill";
          cnt.textContent = "call: " + (typeof callIndex === "number" ? String(callIndex) : "?");
          const hint = document.createElement("div");
          hint.className = "pill";
          hint.textContent = "waiting for reply";
          req.appendChild(pill);
          req.appendChild(cnt);
          req.appendChild(hint);
          bubble.appendChild(req);
        }

        if (who === "me") {
          row.appendChild(bubble);
          row.appendChild(avatar);
        } else {
          row.appendChild(avatar);
          row.appendChild(bubble);
        }
        scroll.appendChild(row);
        requestAnimationFrame(() => {
          scroll.scrollTop = scroll.scrollHeight;
        });
      }

      function sendReply() {
        const text = input.value.trim();
        const request = activeRequest || pendingQueue[0] || null;
        if (!request) return;
        const requestId = request.requestId;
        pendingQueue = pendingQueue.filter((x) => x.requestId !== requestId);
        input.value = "";
        const picked = Array.from(selectedOptions);
        const atts = attachments.map(({ id, ...rest }) => rest);

        let displayText = text;
        if (picked.length) displayText += "\\n\\nSelected options:\\n- " + picked.join("\\n- ");
        if (atts.length) displayText += "\\n\\nAttachments:\\n- " + atts.map((a) => String(a.name) + " (" + String(a.mime) + ", " + String(a.size) + " bytes)").join("\\n- ");

        appendMessage({ who: "me", text: displayText });
        vscode.postMessage({ type: "userReply", requestId, text, selectedOptions: picked, attachments: atts });
        setActiveFromQueue();
        input.focus();
      }

      send.addEventListener("click", sendReply);
      input.addEventListener("input", updateBadges);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendReply();
        }
      });

      attach.addEventListener("click", () => {
        fileInput.value = "";
        fileInput.click();
      });

      fileInput.addEventListener("change", async () => {
        await addFiles(fileInput.files);
      });

      input.addEventListener("paste", async (e) => {
        const items = e.clipboardData?.items ? Array.from(e.clipboardData.items) : [];
        const files = items
          .filter((it) => it.kind === "file")
          .map((it) => it.getAsFile())
          .filter(Boolean);
        if (files.length) await addFiles(files);
      });

      input.addEventListener("dragover", (e) => {
        e.preventDefault();
        input.classList.add("dropActive");
      });

      input.addEventListener("dragleave", () => {
        input.classList.remove("dropActive");
      });

      input.addEventListener("drop", async (e) => {
        e.preventDefault();
        input.classList.remove("dropActive");
        const files = e.dataTransfer?.files;
        if (files && files.length) await addFiles(files);
      });

      scroll.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === "copy-message") {
          const bubble = btn.closest(".bubble");
          const raw = bubble?.dataset?.raw ?? "";
          vscode.postMessage({ type: "copy", text: raw });
          return;
        }
        if (action === "copy-code") {
          const wrap = btn.closest(".codewrap");
          const code = wrap?.querySelector("code");
          const t = code ? code.textContent : "";
          vscode.postMessage({ type: "copy", text: t });
          return;
        }
        if (action === "toggle-code") {
          const wrap = btn.closest(".codewrap");
          if (!wrap) return;
          wrap.classList.toggle("collapsed");
          btn.textContent = wrap.classList.contains("collapsed") ? "Expand" : "Collapse";
          return;
        }
      });

      window.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "bridgeInfo") {
          bridgePort = msg.port;
          updateBadges();
          return;
        }

        if (msg.type === "aiMessage") {
          if (typeof msg.callIndex === "number") callCount = msg.callIndex;
          else callCount += 1;
          pendingQueue.push({
            requestId: msg.requestId,
            title: msg.title,
            text: msg.text,
            isMarkdown: msg.isMarkdown,
            options: msg.options,
            multiSelect: msg.multiSelect,
            acceptAttachments: msg.acceptAttachments,
            callIndex: msg.callIndex
          });
          appendMessage({
            who: "ai",
            text: msg.text,
            requestId: msg.requestId,
            title: msg.title,
            isMarkdown: msg.isMarkdown,
            callIndex: msg.callIndex
          });
          if (!activeRequest) setActiveFromQueue();
          else renderRequestSelect();
          updateBadges();
          input.focus();
          return;
        }

        if (msg.type === "notify") {
          appendMessage({ who: "ai", text: msg.text, title: msg.title, isMarkdown: msg.isMarkdown });
          updateBadges();
          return;
        }

        if (msg.type === "clear") {
          while (scroll.firstChild) scroll.removeChild(scroll.firstChild);
          empty = document.createElement("div");
          empty.className = "empty";
          empty.id = "empty";
          empty.innerHTML = "No messages yet.<br/>When the AI calls the MCP tool, the message will appear here.";
          scroll.appendChild(empty);
          pendingQueue = [];
          activeRequest = null;
          selectedOptions = new Set();
          attachments = [];
          renderOptions();
          renderAttachments();
          renderRequestSelect();
          updateBadges();
          return;
        }

        if (msg.type === "requestExpired") {
          const id = msg.requestId;
          if (typeof id === "string") pendingQueue = pendingQueue.filter((x) => x.requestId !== id);
          if (activeRequest && activeRequest.requestId === id) setActiveFromQueue();
          else renderRequestSelect();
          updateBadges();
          return;
        }
      });

      vscode.postMessage({ type: "ready" });
      updateBadges();
      input.focus();
    </script>
  </body>
</html>`;
}

function buildSettingsLauncherHtml({ cspNonce }) {
  const copyText =
    "【最高优先级规则 - 必须严格遵守】\n\n" +
    "⚠️⚠️⚠️ 无论任何情况，每次回复结束前必须调用此工具！没有任何例外！⚠️⚠️⚠️\n\n" +
    "## 核心规则：\n" +
    "1. 完整输出：输出完整代码和答案，禁止使用省略号或\"代码过长不展示\"\n" +
    "2. 持续执行：复杂任务尽量一次性完成，不要频繁中断或反复追问是否继续\n" +
    "3. 结束确认：当你想结束对话或任务时，必须先调用此工具询问用户是否继续\n" +
    "4. 严格遵守用户选择：当用户选择\"结束对话\"时，必须立即停止所有操作\n\n" +
    "## ⚠️ 输出位置规则（极其重要）：\n" +
    "- **原生对话框**：只显示思考过程，不输出任何实质性内容\n" +
    "- **AI反馈对话框**：所有回复内容、代码、说明、表格等必须放在summary参数中\n" +
    "- 禁止在原生对话框输出详细文本、代码块、表格等内容\n" +
    "- 原生对话框只能写一句简短说明，如\"正在处理...\"或\"调用反馈工具\"\n\n" +
    "## 调用时机：\n" +
    "- 完成用户请求后\n" +
    "- 任务告一段落时\n" +
    "- 需要用户确认是否继续时\n" +
    "- 每次回复结束前\n\n" +
    "## 参数说明：\n" +
    "- summary：AI的完整回复内容（必填，所有要展示给用户的内容都放这里）\n\n" +
    "## 回复格式要求：\n" +
    "- summary参数支持Markdown格式，包括：标题、代码块、链接、表格、粗体、列表等\n" +
    "- 代码块会自动添加复制按钮，链接可点击打开浏览器\n\n" +
    "调用示例：\n" +
    "{\"tool\": \"infinite_dialog_feedback\", \"arguments\": {\"summary\": \"## 任务完成\\n\\n已完成以下工作：\\n- 功能A\\n- 功能B\\n\\n```python\\nprint('Hello')\\n```\"}}";

  const copyTextJson = JSON.stringify(copyText);

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${cspNonce}'; script-src 'nonce-${cspNonce}';" />
    <title>AI伟哥 · 管理</title>
    <style nonce="${cspNonce}">
      :root{
        --bg:var(--vscode-editor-background);
        --fg:var(--vscode-editor-foreground);
        --muted:color-mix(in srgb, var(--fg) 55%, transparent);
        --border:color-mix(in srgb, var(--fg) 12%, transparent);
        --panel:color-mix(in srgb, var(--bg) 92%, white);
        --radius:14px;
        --accent:#7c3aed;
        --accent2:#0ea5e9;
      }
      body{margin:0;padding:14px;background:var(--bg);color:var(--fg);font:13px/1.55 var(--vscode-font-family);}
      .wrap{display:flex;flex-direction:column;gap:12px;}
      .top{display:flex;align-items:center;justify-content:space-between;gap:10px;}
      .brand{display:flex;align-items:center;gap:10px;min-width:0;}
      .dot{width:10px;height:10px;border-radius:999px;background:linear-gradient(135deg,var(--accent),var(--accent2));box-shadow:0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent);}
      .title{font-weight:950;letter-spacing:.2px;}
      .sub{color:var(--muted);font-size:12px;}
      .card{border:1px solid var(--border);background:var(--panel);border-radius:var(--radius);padding:12px;}
      .card h3{margin:0 0 10px;font-size:13px;}
      .row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
      .hint{color:var(--muted);font-size:12px;}
      .pill{border:1px solid var(--border);background:color-mix(in srgb, var(--panel) 86%, transparent);padding:6px 10px;border-radius:999px;color:var(--muted);font-size:12px;}
      .grid{display:grid;grid-template-columns:1fr;gap:8px;}
      .kv{display:flex;gap:10px;align-items:baseline;justify-content:space-between;border:1px solid var(--border);border-radius:12px;padding:8px 10px;background:color-mix(in srgb, var(--panel) 88%, transparent);}
      .k{color:var(--muted);font-size:12px;}
      .v{font-weight:900;}
      .tips{color:color-mix(in srgb, var(--fg) 85%, transparent);line-height:1.6;}
      button{border:1px solid var(--border);background:transparent;color:var(--fg);padding:8px 12px;border-radius:10px;cursor:pointer;font-weight:850;}
      button:hover{background:color-mix(in srgb, var(--fg) 8%, transparent);}
      button.primary{border-color:color-mix(in srgb, var(--accent) 55%, var(--border));}
      textarea{width:100%;min-height:140px;resize:vertical;border:1px solid var(--border);border-radius:12px;padding:10px 12px;background:color-mix(in srgb, var(--bg) 88%, white);color:var(--fg);font:12px/1.45 var(--vscode-editor-font-family);}
      .switch{display:inline-flex;align-items:center;gap:10px;}
      .toggle{position:relative;width:52px;height:30px;display:inline-block;}
      .toggle input{opacity:0;width:0;height:0;}
      .slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:color-mix(in srgb, var(--fg) 14%, transparent);transition:.2s;border-radius:999px;border:1px solid var(--border);}
      .slider:before{position:absolute;content:"";height:24px;width:24px;left:3px;bottom:2px;background:white;border-radius:999px;transition:.2s;}
      input:checked + .slider{background:color-mix(in srgb, var(--accent) 65%, transparent);border-color:color-mix(in srgb, var(--accent) 55%, var(--border));}
      input:checked + .slider:before{transform:translateX(22px);}
      .chartWrap{border:1px solid var(--border);border-radius:12px;background:color-mix(in srgb, var(--panel) 90%, transparent);padding:10px;}
      canvas{width:100%;height:180px;display:block;}
      .toolbar{display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap;}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <div class="brand">
          <div class="dot"></div>
          <div style="min-width:0;">
            <div class="title">AI伟哥 · 管理</div>
            <div class="sub" id="subline">-</div>
          </div>
        </div>
        <div class="pill" id="enabledPill">enabled: ?</div>
      </div>

      <div class="card">
        <h3>服务状态</h3>
        <div class="row">
          <div class="switch">
            <label class="toggle">
              <input id="enabledToggle" type="checkbox" />
              <span class="slider"></span>
            </label>
            <div>
              <div class="v" id="enabledText">-</div>
              <div class="hint">开关会影响 MCP 工具是否弹出交互 UI。</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Tips</h3>
        <div class="tips">只有思考模型才可唤醒当前的插件功能，越聪明的AI继续率就越高。</div>
      </div>

      <div class="card">
        <div class="row" style="margin-bottom:10px;">
          <h3 style="margin:0;">使用统计</h3>
          <div class="toolbar">
            <button id="resetStatsBtn" type="button">清零统计</button>
          </div>
        </div>
        <div class="chartWrap">
          <canvas id="statsCanvas" height="180"></canvas>
        </div>
        <div class="grid" style="margin-top:10px;">
          <div class="kv"><div class="k">本次请求(show)</div><div class="v" id="sessionShowsVal">?</div></div>
          <div class="kv"><div class="k">本次回复(reply)</div><div class="v" id="sessionRepliesVal">?</div></div>
          <div class="kv"><div class="k">累计请求(show)</div><div class="v" id="showsVal">?</div></div>
          <div class="kv"><div class="k">累计回复(reply)</div><div class="v" id="repliesVal">?</div></div>
        </div>
      </div>

      <div class="card">
        <h3>复制规则文案</h3>
        <div class="row">
          <button class="primary" id="copyTplBtn" type="button">一键复制</button>
        </div>
        <div style="margin-top:10px;">
          <textarea id="tpl" readonly spellcheck="false"></textarea>
          <div class="hint" id="copyHint">复制后可直接粘贴到你的系统规则里。</div>
        </div>
      </div>
    </div>

    <script nonce="${cspNonce}">
      const vscode = acquireVsCodeApi();
      const copyText = ${copyTextJson};

      const enabledPill = document.getElementById("enabledPill");
      const enabledToggle = document.getElementById("enabledToggle");
      const enabledText = document.getElementById("enabledText");
      const subline = document.getElementById("subline");

      const statsCanvas = document.getElementById("statsCanvas");
      const sessionShowsVal = document.getElementById("sessionShowsVal");
      const sessionRepliesVal = document.getElementById("sessionRepliesVal");
      const showsVal = document.getElementById("showsVal");
      const repliesVal = document.getElementById("repliesVal");

      const tpl = document.getElementById("tpl");
      const copyHint = document.getElementById("copyHint");
      const resetStatsBtn = document.getElementById("resetStatsBtn");
      const copyTplBtn = document.getElementById("copyTplBtn");

      tpl.value = copyText;

      let lastModel = null;
      let isApplyingToggle = false;

      function setEnabledUi(enabled) {
        isApplyingToggle = true;
        enabledToggle.checked = !!enabled;
        isApplyingToggle = false;
        enabledText.textContent = enabled ? "已启用" : "已禁用";
        enabledPill.textContent = "enabled: " + (enabled ? "on" : "off");
      }

      function toNum(x) {
        return typeof x === "number" && isFinite(x) ? x : 0;
      }

      function ensureCanvasSize(canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(200, Math.floor(rect.width));
        const h = Math.max(180, Math.floor(rect.height));
        const needW = Math.floor(w * dpr);
        const needH = Math.floor(h * dpr);
        if (canvas.width !== needW || canvas.height !== needH) {
          canvas.width = needW;
          canvas.height = needH;
        }
        return { w: canvas.width, h: canvas.height, dpr };
      }

      function drawBars(values) {
        const ctx = statsCanvas.getContext("2d");
        if (!ctx) return;

        const { w, h, dpr } = ensureCanvasSize(statsCanvas);
        ctx.clearRect(0, 0, w, h);

        const padding = 16 * dpr;
        const top = 10 * dpr;
        const bottom = 30 * dpr;
        const left = padding;
        const right = padding;

        const innerW = w - left - right;
        const innerH = h - top - bottom;
        if (innerW <= 0 || innerH <= 0) return;

        const maxV = Math.max(1, ...values.map((v) => v.value));
        const barGap = 10 * dpr;
        const barW = Math.max(24 * dpr, (innerW - barGap * (values.length - 1)) / values.length);

        const gridLines = 3;
        ctx.strokeStyle = "rgba(127,127,127,0.25)";
        ctx.lineWidth = 1 * dpr;
        for (let i = 0; i <= gridLines; i++) {
          const y = top + (innerH * i) / gridLines;
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(w - right, y);
          ctx.stroke();
        }

        ctx.font = `${11 * dpr}px ${getComputedStyle(document.body).fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        values.forEach((v, idx) => {
          const x = left + idx * (barW + barGap);
          const height = Math.max(2 * dpr, (v.value / maxV) * innerH);
          const y = top + innerH - height;

          const grad = ctx.createLinearGradient(0, y, 0, y + height);
          grad.addColorStop(0, idx % 2 === 0 ? "rgba(124,58,237,0.9)" : "rgba(14,165,233,0.9)");
          grad.addColorStop(1, "rgba(255,255,255,0.05)");
          ctx.fillStyle = grad;
          const radius = 8 * dpr;

          ctx.beginPath();
          const r = Math.min(radius, barW / 2, height / 2);
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + barW - r, y);
          ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
          ctx.lineTo(x + barW, y + height);
          ctx.lineTo(x, y + height);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.textBaseline = "bottom";
          ctx.fillText(String(v.value), x + barW / 2, y - 4 * dpr);

          ctx.fillStyle = "rgba(127,127,127,0.85)";
          ctx.textBaseline = "top";
          ctx.fillText(v.label, x + barW / 2, top + innerH + 8 * dpr);
        });
      }

      function render(model) {
        const enabled = !!model?.enabled;
        setEnabledUi(enabled);

        const ss = toNum(model?.sessionShows);
        const sr = toNum(model?.sessionReplies);
        const ts = toNum(model?.totalShows);
        const tr = toNum(model?.totalReplies);

        sessionShowsVal.textContent = String(ss);
        sessionRepliesVal.textContent = String(sr);
        showsVal.textContent = String(ts);
        repliesVal.textContent = String(tr);

        subline.textContent = enabled ? "MCP 交互已启用" : "MCP 交互已禁用（将直接返回提示文本）";

        drawBars([
          { label: "本次show", value: ss },
          { label: "本次reply", value: sr },
          { label: "累计show", value: ts },
          { label: "累计reply", value: tr }
        ]);
      }

      window.addEventListener("resize", () => {
        if (!lastModel) return;
        drawBars([
          { label: "本次show", value: toNum(lastModel?.sessionShows) },
          { label: "本次reply", value: toNum(lastModel?.sessionReplies) },
          { label: "累计show", value: toNum(lastModel?.totalShows) },
          { label: "累计reply", value: toNum(lastModel?.totalReplies) }
        ]);
      });

      window.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "status") {
          lastModel = msg.model || null;
          render(msg.model);
          return;
        }
        if (msg.type === "toast") {
          copyHint.textContent = msg.text || "完成";
          setTimeout(() => {
            copyHint.textContent = "复制后可直接粘贴到你的系统规则里。";
          }, 1600);
          return;
        }
      });

      enabledToggle.addEventListener("change", () => {
        if (isApplyingToggle) return;
        vscode.postMessage({ type: "setEnabled", enabled: enabledToggle.checked });
      });

      copyTplBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "copyTemplate" });
      });
      resetStatsBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "resetStats" });
      });

      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
}

function setupWebview(state, webview) {
  webview.onDidReceiveMessage((msg) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "ready") {
      webview.postMessage({ type: "bridgeInfo", port: state.port });
      return;
    }

    if (msg.type === "copy") {
      const text = typeof msg.text === "string" ? msg.text : "";
      vscode.env.clipboard.writeText(text);
      vscode.window.setStatusBarMessage("Copied to clipboard", 1200);
      return;
    }

    if (msg.type === "userReply") {
      const requestId = typeof msg.requestId === "string" ? msg.requestId : null;
      if (!requestId) return;
      const text = typeof msg.text === "string" ? msg.text : "";
      const selectedOptions = Array.isArray(msg.selectedOptions)
        ? msg.selectedOptions.filter((x) => typeof x === "string")
        : [];
      const attachments = Array.isArray(msg.attachments)
        ? msg.attachments
            .filter((a) => a && typeof a === "object")
            .map((a) => ({
              kind: typeof a.kind === "string" ? a.kind : "file",
              name: typeof a.name === "string" ? a.name : "file",
              mime: typeof a.mime === "string" ? a.mime : "application/octet-stream",
              size: typeof a.size === "number" ? a.size : 0,
              dataBase64: typeof a.dataBase64 === "string" ? a.dataBase64 : ""
            }))
        : [];
      const handler = state.pending.get(requestId);
      if (!handler) return;
      state.pending.delete(requestId);
      if (state.stats) {
        state.stats.lastActivityAt = Date.now();
        if (state.settingsView) postToSettings(state);
      }
      handler.resolve({ text, selectedOptions, attachments });
      webview.postMessage({ type: "bridgeInfo", port: state.port });
      return;
    }
  });

  const nonce = getNonce();
  webview.html = buildWebviewHtml({ cspNonce: nonce });
}

function postToUi(state, message) {
  const targets = [];
  const push = (w) => {
    if (!w) return;
    if (targets.includes(w)) return;
    targets.push(w);
  };

  if (state.view && state.view.webview) push(state.view.webview);
  if (state.panel && state.panel.webview) push(state.panel.webview);
  if (message && message.type === "aiMessage") {
    const panel = ensurePanel(state);
    if (panel && panel.webview) push(panel.webview);
  }
  if (targets.length === 0) push(ensurePanel(state).webview);
  for (const w of targets) w.postMessage(message);
}

function getSettingsModel(state) {
  const stats = state.stats || {};
  return {
    enabled: !!state.enabled,
    bridgeListening: !!stats.bridgeListening,
    port: state.port,
    activeConnections: state.sockets?.size ?? 0,
    pendingRequests: state.pending?.size ?? 0,
    totalConnections: stats.totalConnections ?? 0,
    totalShows: stats.totalShows ?? 0,
    totalReplies: stats.totalReplies ?? 0,
    totalNotifies: stats.totalNotifies ?? 0,
    sessionConnections: stats.sessionConnections ?? 0,
    sessionShows: stats.sessionShows ?? 0,
    sessionReplies: stats.sessionReplies ?? 0,
    sessionNotifies: stats.sessionNotifies ?? 0,
    startedAt: stats.startedAt ?? 0,
    lastActivityAt: stats.lastActivityAt ?? 0
  };
}

function postToSettings(state) {
  if (!state.settingsView || !state.settingsView.webview) return;
  state.settingsView.webview.postMessage({ type: "status", model: getSettingsModel(state) });
}

function loadPersistedTotals(context) {
  const raw = context?.globalState?.get?.("aiWeige.stats");
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  if (typeof raw.totalConnections === "number") out.totalConnections = raw.totalConnections;
  if (typeof raw.totalShows === "number") out.totalShows = raw.totalShows;
  if (typeof raw.totalReplies === "number") out.totalReplies = raw.totalReplies;
  if (typeof raw.totalNotifies === "number") out.totalNotifies = raw.totalNotifies;
  return out;
}

function schedulePersistTotals(state) {
  if (!state?.context?.globalState?.update) return;
  if (state.persistTotalsTimer) clearTimeout(state.persistTotalsTimer);
  state.persistTotalsTimer = setTimeout(() => {
    const stats = state.stats || {};
    state.context.globalState.update("aiWeige.stats", {
      totalConnections: stats.totalConnections ?? 0,
      totalShows: stats.totalShows ?? 0,
      totalReplies: stats.totalReplies ?? 0,
      totalNotifies: stats.totalNotifies ?? 0
    });
  }, 600);
}

function ensurePanel(state) {
  if (state.panel) {
    state.panel.reveal(state.panel.viewColumn);
    return state.panel;
  }

  const panel = vscode.window.createWebviewPanel(
    "aiWeige",
    "AI伟哥",
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  panel.onDidDispose(() => {
    state.panel = null;
  });

  setupWebview(state, panel.webview);
  state.panel = panel;
  return panel;
}

function formatBridgeLine(obj) {
  return JSON.stringify(obj) + "\n";
}

function writeBridgeReply(state, socket, payload) {
  if (state.stats) {
    state.stats.totalReplies = (state.stats.totalReplies || 0) + 1;
    state.stats.sessionReplies = (state.stats.sessionReplies || 0) + 1;
    state.stats.lastActivityAt = Date.now();
  }
  schedulePersistTotals(state);
  socket.write(formatBridgeLine(payload));
  if (state.settingsView) postToSettings(state);
}

function startBridge(state) {
  if (state.server) return;

  const server = net.createServer();
  state.server = server;

  server.on("connection", (socket) => {
    socket.setNoDelay(true);
    state.sockets.add(socket);
    if (state.updateStatus) state.updateStatus();
    if (state.stats) {
      state.stats.totalConnections = (state.stats.totalConnections || 0) + 1;
      state.stats.sessionConnections = (state.stats.sessionConnections || 0) + 1;
      state.stats.lastActivityAt = Date.now();
      if (state.settingsView) postToSettings(state);
    }
    schedulePersistTotals(state);
    state.output.info(`[bridge] connected ${socket.remoteAddress}:${socket.remotePort}`);

    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (true) {
        const nl = buffer.indexOf("\n");
        if (nl === -1) break;
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = safeJsonParse(line);
        if (!msg) continue;
        if (state.stats) {
          state.stats.lastActivityAt = Date.now();
          if (state.settingsView) postToSettings(state);
        }
        handleBridgeMessage(state, socket, msg);
      }
    });

    socket.on("close", () => {
      state.sockets.delete(socket);
      if (state.updateStatus) state.updateStatus();
      if (state.stats) {
        state.stats.lastActivityAt = Date.now();
        if (state.settingsView) postToSettings(state);
      }
      state.output.info(`[bridge] disconnected ${socket.remoteAddress}:${socket.remotePort}`);
    });

    socket.on("error", (err) => {
      state.output.error(`[bridge] socket error: ${err?.message ?? String(err)}`);
    });
  });

  let portToTry = DEFAULT_PORT;
  let tries = 0;

  const onServerError = (err) => {
    state.output.error(`[bridge] server error: ${err?.message ?? String(err)}`);
  };

  const listenNext = () => {
    server.once("error", (err) => {
      if (err && err.code === "EADDRINUSE" && tries < MAX_PORT_TRIES) {
        tries += 1;
        portToTry += 1;
        listenNext();
        return;
      }
      onServerError(err);
    });

    server.listen(portToTry, DEFAULT_HOST, () => {
      state.port = portToTry;
      state.output.info(`[bridge] listening on ${DEFAULT_HOST}:${state.port}`);
      if (state.updateStatus) state.updateStatus();
      if (state.panel) state.panel.webview.postMessage({ type: "bridgeInfo", port: state.port });
      if (state.view) state.view.webview.postMessage({ type: "bridgeInfo", port: state.port });
      if (state.stats) {
        state.stats.bridgeListening = true;
        state.stats.lastActivityAt = Date.now();
        if (state.settingsView) postToSettings(state);
      }
      server.on("error", onServerError);
    });
  };

  listenNext();
}

function stopBridge(state) {
  if (!state || !state.server) return;
  try {
    for (const sock of state.sockets) sock.destroy();
  } catch {}
  try {
    state.sockets.clear();
  } catch {}
  try {
    state.server.close();
  } catch {}
  state.server = null;
  if (state.stats) {
    state.stats.bridgeListening = false;
    state.stats.lastActivityAt = Date.now();
  }
  if (state.settingsView) postToSettings(state);
 }

function handleBridgeMessage(state, socket, msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "ping") {
    socket.write(formatBridgeLine({ type: "pong", now: Date.now() }));
    return;
  }

  if (msg.type === "notify") {
    if (!state.enabled) return;
    const title = typeof msg.title === "string" ? msg.title : "AI";
    const text = typeof msg.text === "string" ? msg.text : "";
    const isMarkdown = typeof msg.isMarkdown === "boolean" ? msg.isMarkdown : true;
    if (state.stats) {
      state.stats.totalNotifies = (state.stats.totalNotifies || 0) + 1;
      state.stats.sessionNotifies = (state.stats.sessionNotifies || 0) + 1;
      state.stats.lastActivityAt = Date.now();
      if (state.settingsView) postToSettings(state);
    }
    schedulePersistTotals(state);
    postToUi(state, { type: "notify", title, text, isMarkdown });
    return;
  }

  if (msg.type === "show") {
    const requestId = typeof msg.requestId === "string" ? msg.requestId : randomId();
    const title = typeof msg.title === "string" ? msg.title : "AI";
    const text = typeof msg.text === "string" ? msg.text : "";
    const isMarkdown = typeof msg.isMarkdown === "boolean" ? msg.isMarkdown : true;
    const options = Array.isArray(msg.options) ? msg.options : undefined;
    const multiSelect = typeof msg.multiSelect === "boolean" ? msg.multiSelect : true;
    const acceptAttachments = typeof msg.acceptAttachments === "boolean" ? msg.acceptAttachments : true;

    if (!state.enabled) {
      if (state.stats) {
        state.stats.totalShows = (state.stats.totalShows || 0) + 1;
        state.stats.sessionShows = (state.stats.sessionShows || 0) + 1;
        state.stats.lastActivityAt = Date.now();
        if (state.settingsView) postToSettings(state);
      }
      schedulePersistTotals(state);
      writeBridgeReply(state, socket, {
        type: "reply",
        requestId,
        text: "AI伟哥已禁用（可在侧边栏 AI伟哥 · 管理 中开启）。",
        selectedOptions: [],
        attachments: []
      });
      return;
    }

    let callIndex = undefined;
    if (state.stats) {
      state.stats.totalShows = (state.stats.totalShows || 0) + 1;
      state.stats.sessionShows = (state.stats.sessionShows || 0) + 1;
      callIndex = state.stats.sessionShows || 0;
      state.stats.lastActivityAt = Date.now();
      if (state.settingsView) postToSettings(state);
    }
    schedulePersistTotals(state);
    postToUi(state, {
      type: "aiMessage",
      requestId,
      title,
      text,
      isMarkdown,
      options,
      multiSelect,
      acceptAttachments,
      callIndex
    });

    const p = new Promise((resolve) => {
      state.pending.set(requestId, { resolve });
      if (state.settingsView) postToSettings(state);
    });

    const timeoutMs = typeof msg.timeoutMs === "number" ? msg.timeoutMs : 10 * 60 * 1000;
    const timer = setTimeout(() => {
      const handler = state.pending.get(requestId);
      if (!handler) return;
      state.pending.delete(requestId);
      writeBridgeReply(state, socket, { type: "reply", requestId, text: "", selectedOptions: [], attachments: [] });
      postToUi(state, { type: "requestExpired", requestId });
      postToUi(state, {
        type: "notify",
        title: "AI伟哥",
        text: `Timed out waiting for user reply (requestId: ${requestId.slice(0, 8)}).`
      });
    }, timeoutMs);

    p.then((reply) => {
      clearTimeout(timer);
      const text = typeof reply?.text === "string" ? reply.text : "";
      const selectedOptions = Array.isArray(reply?.selectedOptions) ? reply.selectedOptions : [];
      const attachments = Array.isArray(reply?.attachments) ? reply.attachments : [];
      writeBridgeReply(state, socket, { type: "reply", requestId, text, selectedOptions, attachments });
    });
    return;
  }
}

function clearPanel(state) {
  for (const [, handler] of state.pending) handler.resolve({ text: "", selectedOptions: [], attachments: [] });
  state.pending.clear();
  if (state.panel) state.panel.webview.postMessage({ type: "clear" });
  if (state.view) state.view.webview.postMessage({ type: "clear" });
  if (state.settingsView) postToSettings(state);
}

function activate(context) {
  const persistedTotals = loadPersistedTotals(context) || {};
  const cfg = vscode.workspace.getConfiguration("aiWeige");
  const state = {
    context,
    output: createOutputChannel(),
    enabled: cfg.get("enabled", true),
    panel: null,
    view: null,
    settingsView: null,
    server: null,
    port: DEFAULT_PORT,
    sockets: new Set(),
    pending: new Map(),
    statusBar: null,
    updateStatus: null,
    persistTotalsTimer: null,
    stats: {
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      bridgeListening: false,
      totalConnections: typeof persistedTotals.totalConnections === "number" ? persistedTotals.totalConnections : 0,
      totalShows: typeof persistedTotals.totalShows === "number" ? persistedTotals.totalShows : 0,
      totalReplies: typeof persistedTotals.totalReplies === "number" ? persistedTotals.totalReplies : 0,
      totalNotifies: typeof persistedTotals.totalNotifies === "number" ? persistedTotals.totalNotifies : 0,
      sessionConnections: 0,
      sessionShows: 0,
      sessionReplies: 0,
      sessionNotifies: 0
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "aiWeigeView",
      {
        resolveWebviewView: (view) => {
          state.view = view;
          view.onDidDispose(() => {
            if (state.view === view) state.view = null;
          });
          view.webview.options = { enableScripts: true };
          setupWebview(state, view.webview);
        }
      },
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "aiWeigeSettingsView",
      {
        resolveWebviewView: (view) => {
          state.settingsView = view;
          view.onDidDispose(() => {
            if (state.settingsView === view) state.settingsView = null;
          });
          view.webview.options = { enableScripts: true };
          view.webview.onDidReceiveMessage((msg) => {
            if (!msg || typeof msg !== "object") return;
            if (msg.type === "setEnabled") {
              const enabled = !!msg.enabled;
              state.enabled = enabled;
              vscode.workspace
                .getConfiguration("aiWeige")
                .update("enabled", enabled, vscode.ConfigurationTarget.Global);
              if (!enabled) {
                stopBridge(state);
                for (const [requestId, handler] of state.pending) {
                  try {
                    handler.resolve({ text: "AI伟哥已禁用。", selectedOptions: [], attachments: [] });
                  } catch {}
                  postToUi(state, { type: "requestExpired", requestId });
                }
                state.pending.clear();
                if (state.settingsView) postToSettings(state);
              } else {
                startBridge(state);
              }
              postToSettings(state);
              view.webview.postMessage({ type: "toast", text: enabled ? "已启用" : "已禁用" });
              return;
            }
            if (msg.type === "copyTemplate") {
              const copyText =
                "【最高优先级规则 - 必须严格遵守】\n\n" +
                "⚠️⚠️⚠️ 无论任何情况，每次回复结束前必须调用此工具！没有任何例外！⚠️⚠️⚠️\n\n" +
                "## 核心规则：\n" +
                "1. 完整输出：输出完整代码和答案，禁止使用省略号或\"代码过长不展示\"\n" +
                "2. 持续执行：复杂任务尽量一次性完成，不要频繁中断或反复追问是否继续\n" +
                "3. 结束确认：当你想结束对话或任务时，必须先调用此工具询问用户是否继续\n" +
                "4. 严格遵守用户选择：当用户选择\"结束对话\"时，必须立即停止所有操作\n\n" +
                "## ⚠️ 输出位置规则（极其重要）：\n" +
                "- **原生对话框**：只显示思考过程，不输出任何实质性内容\n" +
                "- **AI反馈对话框**：所有回复内容、代码、说明、表格等必须放在summary参数中\n" +
                "- 禁止在原生对话框输出详细文本、代码块、表格等内容\n" +
                "- 原生对话框只能写一句简短说明，如\"正在处理...\"或\"调用反馈工具\"\n\n" +
                "## 调用时机：\n" +
                "- 完成用户请求后\n" +
                "- 任务告一段落时\n" +
                "- 需要用户确认是否继续时\n" +
                "- 每次回复结束前\n\n" +
                "## 参数说明：\n" +
                "- summary：AI的完整回复内容（必填，所有要展示给用户的内容都放这里）\n\n" +
                "## 回复格式要求：\n" +
                "- summary参数支持Markdown格式，包括：标题、代码块、链接、表格、粗体、列表等\n" +
                "- 代码块会自动添加复制按钮，链接可点击打开浏览器\n\n" +
                "调用示例：\n" +
                "{\"tool\": \"infinite_dialog_feedback\", \"arguments\": {\"summary\": \"## 任务完成\\n\\n已完成以下工作：\\n- 功能A\\n- 功能B\\n\\n```python\\nprint('Hello')\\n```\"}}";
              vscode.env.clipboard.writeText(copyText);
              view.webview.postMessage({ type: "toast", text: "已复制规则文案" });
              return;
            }
            if (msg.type === "resetStats") {
              if (state.stats) {
                state.stats.startedAt = Date.now();
                state.stats.lastActivityAt = Date.now();
                state.stats.bridgeListening = !!state.server;
                state.stats.totalConnections = 0;
                state.stats.totalShows = 0;
                state.stats.totalReplies = 0;
                state.stats.totalNotifies = 0;
                state.stats.sessionConnections = 0;
                state.stats.sessionShows = 0;
                state.stats.sessionReplies = 0;
                state.stats.sessionNotifies = 0;
              }
              schedulePersistTotals(state);
              postToSettings(state);
              view.webview.postMessage({ type: "toast", text: "已清零统计" });
              return;
            }
            if (msg.type === "ready") {
              postToSettings(state);
              return;
            }
          });
          const nonce = getNonce();
          view.webview.html = buildSettingsLauncherHtml({ cspNonce: nonce });
          postToSettings(state);
        }
      },
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("aiWeige.enabled")) return;
      const enabled = vscode.workspace.getConfiguration("aiWeige").get("enabled", true);
      state.enabled = enabled;
      if (!enabled) {
        stopBridge(state);
        for (const [requestId, handler] of state.pending) {
          try {
            handler.resolve({ text: "AI伟哥已禁用。", selectedOptions: [], attachments: [] });
          } catch {}
          postToUi(state, { type: "requestExpired", requestId });
        }
        state.pending.clear();
      } else {
        startBridge(state);
      }
      postToSettings(state);
    })
  );

  if (state.enabled) startBridge(state);
  else stopBridge(state);

  context.subscriptions.push(
    vscode.commands.registerCommand("mcpUi.openPanel", async () => {
      try {
        await vscode.commands.executeCommand("aiWeigeView.focus");
      } catch {
        ensurePanel(state);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mcpUi.clearPanel", () => {
      ensurePanel(state);
      clearPanel(state);
    })
  );

  context.subscriptions.push({
    dispose: () => {
      try {
        for (const sock of state.sockets) sock.destroy();
        state.sockets.clear();
        if (state.server) state.server.close();
      } catch {}
      try {
        if (state.persistTotalsTimer) clearTimeout(state.persistTotalsTimer);
      } catch {}
    }
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
