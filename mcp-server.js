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

function toolAskSpec() {
  return {
    name: "vscode_ui.ask",
    description: "Show a message in VSCode and wait for the user's input (with optional multi-select options and attachments).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", description: "Title shown in the UI (optional)." },
        text: { type: "string", description: "Message content shown to the user." },
        timeoutMs: { type: "number", description: "How long to wait for the user (ms). Default: 10 minutes." },
        options: {
          type: "array",
          description: "Options shown to the user (multi-select).",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: { type: "string" },
                  value: { type: "string" }
                },
                required: ["label"]
              }
            ]
          }
        },
        acceptAttachments: { type: "boolean", description: "Whether to allow file/image attachments. Default: true." }
      },
      required: ["text"]
    }
  };
}

function toolNotifySpec() {
  return {
    name: "vscode_ui.notify",
    description: "Show a message in VSCode UI (no input).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", description: "Title shown in the UI (optional)." },
        text: { type: "string", description: "Message content shown to the user." }
      },
      required: ["text"]
    }
  };
}

async function callTool(params) {
  const args = params?.arguments ?? {};
  const title = typeof args.title === "string" ? args.title : "AI";
  const text = typeof args.text === "string" ? args.text : "";
  const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 10 * 60 * 1000;
  const options = Array.isArray(args.options)
    ? args.options
        .map((x) => {
          if (typeof x === "string") return x;
          if (x && typeof x === "object" && typeof x.label === "string") {
            const value = typeof x.value === "string" ? x.value : x.label;
            return { label: x.label, value };
          }
          return null;
        })
        .filter(Boolean)
    : undefined;
  const acceptAttachments = typeof args.acceptAttachments === "boolean" ? args.acceptAttachments : true;

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const { host, port } = getBridgeConfig();

  const socket = await connectBridge({ host, port, timeoutMs: 1200 });
  socket.setNoDelay(true);
  socket.write(JSON.stringify({ type: "show", requestId, title, text, timeoutMs, options, multiSelect: true, acceptAttachments }) + "\n");
  const replyMsg = await readBridgeReply(socket, requestId, timeoutMs);
  return replyMsg;
}

async function notifyTool(params) {
  const args = params?.arguments ?? {};
  const title = typeof args.title === "string" ? args.title : "AI";
  const text = typeof args.text === "string" ? args.text : "";
  const { host, port } = getBridgeConfig();
  const socket = await connectBridge({ host, port, timeoutMs: 1200 });
  socket.setNoDelay(true);
  socket.write(JSON.stringify({ type: "notify", title, text }) + "\n");
  try {
    socket.end();
  } catch {}
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
          name: "ai-weige",
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
        tools: [toolAskSpec(), toolNotifySpec()]
      }
    });
    return;
  }

  if (method === "tools/call") {
    if (id === undefined || id === null) return;
    const toolName = msg?.params?.name;
    if (toolName !== "vscode_ui.ask" && toolName !== "vscode_ui.notify") {
      writeError(id, -32602, "Unknown tool", { name: toolName });
      return;
    }

    try {
      if (toolName === "vscode_ui.notify") {
        await notifyTool(msg.params);
        writeMessage({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: "" }]
          }
        });
        return;
      }

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
