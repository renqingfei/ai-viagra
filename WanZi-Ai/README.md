# 丸子AI (Wanzi AI)

一款 VS Code / Windsurf / Cursor 扩展，通过 MCP 协议实现 **AI 反馈交互**，让 AI 在完成任务后主动等待用户确认，实现真正的人机协作对话。

## 核心功能

### 🔄 AI 反馈循环
- AI 完成任务后自动弹出反馈面板，等待用户确认或提供进一步指示
- 支持快捷回复，一键发送常用指令
- 支持 Markdown 格式渲染，代码块自动添加复制按钮

### � MCP 协议支持
- 内置 MCP HTTP 服务器，自动配置 Windsurf / Cursor 的 MCP 连接
- 自动生成 `.windsurfrules` 规则文件，引导 AI 正确使用反馈工具
- 无需手动配置，开箱即用

### ⚙️ 丰富的自定义选项
- **通知音效**：多种提示音可选（通知、叮咚、风铃、和弦、庆祝）
- **面板位置**：侧边、当前、左侧、右侧
- **快捷回复**：自定义常用回复短语
- **Enter 发送**：可选回车键直接发送

### � 统计与监控
- 实时显示 MCP 服务状态和连接数
- 调用统计：总调用次数、成功率
- 数据清理和配置导出功能

## 工作原理

1. 扩展启动时自动运行 MCP HTTP 服务器（默认端口 3456）
2. 自动配置 Windsurf/Cursor 的 MCP 连接
3. 自动在工作区创建 `.windsurfrules` 文件，指导 AI 使用 `infinite_dialog_feedback` 工具
4. AI 完成任务后调用反馈工具，弹出面板等待用户输入
5. 用户确认后，AI 继续执行或结束对话

## 安装

### 从 Release 安装（推荐）

1. 前往 [Releases](https://github.com/zsck2020/wanzi-ai/releases) 页面
2. 下载最新版本的 `.vsix` 文件
3. 在 VS Code / Windsurf / Cursor 中按 `Ctrl+Shift+P`，输入 `Install from VSIX`
4. 选择下载的 `.vsix` 文件进行安装
5. 重启编辑器，扩展会自动配置 MCP

### 从源码构建

```bash
git clone https://github.com/zsck2020/wanzi-ai.git
cd wanzi-ai
npm install
npm run compile
npm run package
```

## 配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `infiniteDialog.serverPort` | 3456 | MCP 服务端口 |
| `infiniteDialog.autoConfigureRules` | true | 自动生成规则文件 |
| `infiniteDialog.autoConfigureMcp` | true | 自动配置 MCP 服务器 |

## 命令

- `丸子AI: 打开面板` - 打开侧边栏面板
- `丸子AI: 刷新` - 刷新面板状态
- `丸子AI: 测试弹窗` - 测试反馈弹窗功能
- `丸子AI: 显示状态` - 显示服务状态信息
- `丸子AI: 配置 MCP` - 手动配置 MCP

## 许可证

MIT License

## 版本历史

- **v1.0.0** - 初始版本发布
