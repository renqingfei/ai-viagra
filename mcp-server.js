#!/usr/bin/env node

const net = require("net");

const PROTOCOL_VERSION = "2024-11-05";

function encodeMessage(obj) {
  const json = JSON.stringify(obj);
  const bytes = Buffer.from(json, "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`, "utf8"), bytes]);
}

function writeMessage(obj) {
  process.stdout.write(encodeMessage(obj));
}

function writeError(id, code, message, data) {
  if (id === undefined || id === null) return;
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  });
}

function connectBridge({ host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let done = false;

    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {}
      reject(new Error(`Bridge connect timeout (${host}:${port})`));
    }, timeoutMs);

    socket.on("connect", () => {
      if (done) return;
      clearTimeout(timeout);
      resolve(socket);
    });

    socket.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function readBridgeReply(socket, requestId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting user reply (${requestId})`));
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      while (true) {
        const nl = buffer.indexOf("\n");
        if (nl === -1) break;
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg && msg.type === "reply" && msg.requestId === requestId) {
          cleanup();
          resolve(msg);
          return;
        }
      }
    };

    const onErr = (err) => {
      cleanup();
      reject(err);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("Bridge connection closed"));
    };

    function cleanup() {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onErr);
      socket.off("close", onClose);
      try {
        socket.end();
      } catch {}
    }

    socket.on("data", onData);
    socket.on("error", onErr);
    socket.on("close", onClose);
  });
}

function getBridgeConfig() {
  const host = process.env.VSCODE_MCP_UI_HOST || "127.0.0.1";
  const port = Number(process.env.VSCODE_MCP_UI_PORT || "61337");
  return { host, port };
}

function toolAiViagraSpec() {
  return {
    name: "ai-viagra",
    description: "在 VSCode 里展示消息并等待用户输入（支持预设选项与附件）。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        message: { type: "string", description: "展示给用户的消息内容。" },
        is_markdown: { type: "boolean", description: "message 是否为 Markdown。默认 true。" },
        predefined_options: {
          type: "array",
          description: "预定义选项（可多选）。",
          items: { type: "string" }
        },
        timeoutMs: { type: "number", description: "等待用户输入超时（ms）。默认 10 分钟。" },
        acceptAttachments: { type: "boolean", description: "是否允许附件。默认 true。" },
        title: { type: "string", description: "UI 中显示的标题（可选）。默认 AI伟哥。" }
      },
      required: ["message"]
    }
  };
}

async function callTool(params) {
  const args = params?.arguments ?? {};
  const title = typeof args.title === "string" ? args.title : "AI伟哥";
  const text = typeof args.message === "string" ? args.message : "";
  const isMarkdown = typeof args.is_markdown === "boolean" ? args.is_markdown : true;
  const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 10 * 60 * 1000;
  const options = Array.isArray(args.predefined_options)
    ? args.predefined_options.filter((x) => typeof x === "string" && x)
    : undefined;
  const acceptAttachments = typeof args.acceptAttachments === "boolean" ? args.acceptAttachments : true;

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const { host, port } = getBridgeConfig();

  try {
    const socket = await connectBridge({ host, port, timeoutMs: 1200 });
    socket.setNoDelay(true);
    socket.write(
      JSON.stringify({
        type: "show",
        requestId,
        title,
        text,
        isMarkdown,
        timeoutMs,
        options,
        multiSelect: true,
        acceptAttachments
      }) + "\n"
    );
    const replyMsg = await readBridgeReply(socket, requestId, timeoutMs);
    return replyMsg;
  } catch {
    return {
      type: "reply",
      requestId,
      text: "AI伟哥未启用或桥接未启动（请在 VSCode 侧边栏 AI伟哥 · 管理 中开启）。",
      selectedOptions: [],
      attachments: []
    };
  }
}

function createFramedReader(onMessage) {
  let buffer = Buffer.alloc(0);

  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const headerRaw = buffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(headerRaw);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) return;

      const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.slice(bodyEnd);
      try {
        const msg = JSON.parse(body);
        onMessage(msg);
      } catch {}
    }
  };
}

let clientProtocolVersion = null;
let initialized = false;

async function handleRequest(msg) {
  const id = msg.id;
  const method = msg.method;

  if (method === "initialize") {
    if (id === undefined || id === null) return;
    const requested = msg?.params?.protocolVersion;
    clientProtocolVersion = requested;
    if (requested !== PROTOCOL_VERSION) {
      writeError(id, -32602, "Unsupported protocol version", {
        supported: [PROTOCOL_VERSION],
        requested
      });
      return;
    }

    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false }
        },
        serverInfo: {
          name: "ai-viagra",
          version: "0.0.1"
        }
      }
    });
    return;
  }

  if (method === "notifications/initialized" || method === "initialized") {
    initialized = true;
    return;
  }

  if (!initialized) {
    writeError(id, -32002, "Server not initialized");
    return;
  }

  if (method === "tools/list") {
    if (id === undefined || id === null) return;
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [toolAiViagraSpec()]
      }
    });
    return;
  }

  if (method === "tools/call") {
    if (id === undefined || id === null) return;
    const toolName = msg?.params?.name;
    if (toolName !== "ai-viagra") {
      writeError(id, -32602, "Unknown tool", { name: toolName });
      return;
    }

    try {
      const reply = await callTool(msg.params);
      const resultPayload = {
        text: typeof reply?.text === "string" ? reply.text : "",
        selectedOptions: Array.isArray(reply?.selectedOptions)
          ? reply.selectedOptions.filter((x) => typeof x === "string")
          : [],
        attachments: Array.isArray(reply?.attachments) ? reply.attachments : []
      };
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(resultPayload) }]
        }
      });
    } catch (err) {
      writeError(id, -32000, "Tool call failed", { message: err?.message ?? String(err) });
    }
    return;
  }

  if (method === "ping") {
    if (id === undefined || id === null) return;
    writeMessage({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  writeError(id, -32601, "Method not found", { method });
}

function handleIncoming(msg) {
  if (!msg || msg.jsonrpc !== "2.0") return;
  if (msg.method) handleRequest(msg);
}

process.stdin.on("data", createFramedReader(handleIncoming));
process.stdin.resume();
