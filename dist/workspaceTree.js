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
exports.WorkspaceTreeDataProvider = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
class WorkspaceEntryItem extends vscode.TreeItem {
    fullPath;
    entryType;
    constructor({ label, fullPath, entryType }) {
        super(label, entryType === "directory" ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.fullPath = fullPath;
        this.entryType = entryType;
        if (entryType === "directory") {
            this.contextValue = "directory";
            this.iconPath = new vscode.ThemeIcon("folder");
        }
        else if (entryType === "file") {
            this.contextValue = "file";
            this.iconPath = new vscode.ThemeIcon("file");
            this.resourceUri = vscode.Uri.file(fullPath);
            this.command = {
                command: "vscode.open",
                title: "Open",
                arguments: [this.resourceUri]
            };
        }
        else {
            this.contextValue = "other";
            this.iconPath = new vscode.ThemeIcon("question");
        }
    }
}
class WorkspaceTreeDataProvider {
    onDidChangeTreeDataEmitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    refresh() {
        this.onDidChangeTreeDataEmitter.fire();
    }
    dispose() {
        this.onDidChangeTreeDataEmitter.dispose();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        const root = this.getWorkspaceRootPath();
        const targetPath = element?.fullPath ?? root;
        if (!targetPath) {
            return [
                new WorkspaceEntryItem({
                    label: "No workspace folder is open",
                    fullPath: "",
                    entryType: "other"
                })
            ];
        }
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        const items = entries.map((e) => {
            const fullPath = path.join(targetPath, e.name);
            const entryType = e.isDirectory() ? "directory" : e.isFile() ? "file" : "other";
            return new WorkspaceEntryItem({ label: e.name, fullPath, entryType });
        });
        items.sort((a, b) => {
            if (a.entryType !== b.entryType) {
                if (a.entryType === "directory")
                    return -1;
                if (b.entryType === "directory")
                    return 1;
            }
            return a.label.toString().localeCompare(b.label.toString());
        });
        return items;
    }
    getWorkspaceRootPath() {
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (!folders.length)
            return "";
        return path.resolve(folders[0].uri.fsPath);
    }
}
exports.WorkspaceTreeDataProvider = WorkspaceTreeDataProvider;
