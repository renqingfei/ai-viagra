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
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
function activate(context) {
    console.log('Trae MCP Plugin is now active!');
    let currentPanel = undefined;
    let disposable = vscode.commands.registerCommand('trae-mcp-plugin.showConfig', () => {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        // If we already have a panel, show it.
        if (currentPanel) {
            currentPanel.reveal(column);
            return;
        }
        // Otherwise, create a new panel.
        currentPanel = vscode.window.createWebviewPanel('traeMcpConfig', 'Trae MCP Config', column || vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(context.extensionPath)]
        });
        currentPanel.webview.html = getWebviewContent();
        // Handle messages from the webview
        currentPanel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'saveConfig':
                    vscode.window.showInformationMessage(`Configuration saved: Theme=${message.theme}, API Key=${message.apiKey}`);
                    // Here you would save to globalState or workspaceState
                    context.globalState.update('theme', message.theme);
                    context.globalState.update('apiKey', message.apiKey);
                    return;
                case 'sendFeedback':
                    vscode.window.showInformationMessage(`Feedback received: ${message.text}`);
                    // Here you would process the feedback
                    return;
                case 'requestConfig':
                    const theme = context.globalState.get('theme') || 'dark';
                    const apiKey = context.globalState.get('apiKey') || '';
                    currentPanel?.webview.postMessage({ command: 'loadConfig', theme, apiKey });
                    return;
            }
        }, undefined, context.subscriptions);
        currentPanel.onDidDispose(() => {
            currentPanel = undefined;
        }, null, context.subscriptions);
    });
    context.subscriptions.push(disposable);
}
function getWebviewContent() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trae MCP Plugin Config</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
        }
        h1 { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 0.5rem; }
        .section { margin-bottom: 2rem; }
        .form-group { margin-bottom: 1rem; }
        label { display: block; margin-bottom: 0.5rem; font-weight: bold; }
        input[type="text"], select, textarea {
            width: 100%;
            padding: 0.5rem;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 0.5rem 1rem;
            border: none;
            cursor: pointer;
        }
        button:hover { background-color: var(--vscode-button-hoverBackground); }
    </style>
</head>
<body>
    <div class="container">
        <h1>Trae MCP Plugin Settings</h1>
        
        <div class="section">
            <h2>Configuration</h2>
            <div class="form-group">
                <label for="theme">Theme</label>
                <select id="theme">
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="system">System</option>
                </select>
            </div>
            <div class="form-group">
                <label for="apiKey">API Key</label>
                <input type="text" id="apiKey" placeholder="Enter your API Key">
            </div>
            <button onclick="saveConfig()">Save Configuration</button>
        </div>

        <div class="section">
            <h2>Dialog Feedback</h2>
            <div class="form-group">
                <label for="feedback">Provide Feedback to AI</label>
                <textarea id="feedback" rows="4" placeholder="Type your feedback here..."></textarea>
            </div>
            <button onclick="sendFeedback()">Send Feedback</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // Request initial config
        vscode.postMessage({ command: 'requestConfig' });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'loadConfig':
                    document.getElementById('theme').value = message.theme;
                    document.getElementById('apiKey').value = message.apiKey;
                    break;
            }
        });

        function saveConfig() {
            const theme = document.getElementById('theme').value;
            const apiKey = document.getElementById('apiKey').value;
            vscode.postMessage({
                command: 'saveConfig',
                theme: theme,
                apiKey: apiKey
            });
        }

        function sendFeedback() {
            const text = document.getElementById('feedback').value;
            if (text) {
                vscode.postMessage({
                    command: 'sendFeedback',
                    text: text
                });
                document.getElementById('feedback').value = '';
            }
        }
    </script>
</body>
</html>`;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map