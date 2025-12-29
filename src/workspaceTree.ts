import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

type EntryType = "directory" | "file" | "other";

class WorkspaceEntryItem extends vscode.TreeItem {
  readonly fullPath: string;
  readonly entryType: EntryType;

  constructor({
    label,
    fullPath,
    entryType
  }: {
    label: string;
    fullPath: string;
    entryType: EntryType;
  }) {
    super(label, entryType === "directory" ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.fullPath = fullPath;
    this.entryType = entryType;

    if (entryType === "directory") {
      this.contextValue = "directory";
      this.iconPath = new vscode.ThemeIcon("folder");
    } else if (entryType === "file") {
      this.contextValue = "file";
      this.iconPath = new vscode.ThemeIcon("file");
      this.resourceUri = vscode.Uri.file(fullPath);
      this.command = {
        command: "vscode.open",
        title: "Open",
        arguments: [this.resourceUri]
      };
    } else {
      this.contextValue = "other";
      this.iconPath = new vscode.ThemeIcon("question");
    }
  }
}

export class WorkspaceTreeDataProvider implements vscode.TreeDataProvider<WorkspaceEntryItem>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<WorkspaceEntryItem | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  refresh() {
    this.onDidChangeTreeDataEmitter.fire();
  }

  dispose() {
    this.onDidChangeTreeDataEmitter.dispose();
  }

  getTreeItem(element: WorkspaceEntryItem) {
    return element;
  }

  async getChildren(element?: WorkspaceEntryItem) {
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
      const entryType: EntryType = e.isDirectory() ? "directory" : e.isFile() ? "file" : "other";
      return new WorkspaceEntryItem({ label: e.name, fullPath, entryType });
    });

    items.sort((a, b) => {
      if (a.entryType !== b.entryType) {
        if (a.entryType === "directory") return -1;
        if (b.entryType === "directory") return 1;
      }
      return a.label!.toString().localeCompare(b.label!.toString());
    });

    return items;
  }

  private getWorkspaceRootPath() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) return "";
    return path.resolve(folders[0]!.uri.fsPath);
  }
}

