import axios from "axios";

interface McpClientOptions {
  onRequestFeedback: (payload: {
    requestId: string;
    aiOutput: string;
  }) => Promise<string>;
  onStatusChange?: (status: string) => void;
}

export class McpClient {
  private readonly options: McpClientOptions;
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;
  private readonly baseUrl = "http://127.0.0.1:17890";

  constructor(options: McpClientOptions) {
    this.options = options;
  }

  async connect() {
    this.options.onStatusChange?.("连接中");

    const maxAttempts = 20;
    const delayMs = 500;

    for (let attempt = 0; attempt < maxAttempts && !this.disposed; attempt += 1) {
      try {
        await axios.get(`${this.baseUrl}/health`);
        this.options.onStatusChange?.("已连接");
        this.startPolling();
        return;
      } catch {
        if (attempt === maxAttempts - 1) {
          this.options.onStatusChange?.("连接失败");
          return;
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  private startPolling() {
    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = setInterval(async () => {
      if (this.disposed) {
        return;
      }
      try {
        const res = await axios.get(`${this.baseUrl}/pending-request`);
        if (res.status === 200 && res.data && res.data.requestId) {
          const payload = {
            requestId: String(res.data.requestId),
            aiOutput: String(res.data.aiOutput ?? "")
          };

          this.options.onStatusChange?.("收到 AI 请求");

          const feedback = await this.options.onRequestFeedback(payload);

          await axios.post(`${this.baseUrl}/feedback`, {
            requestId: payload.requestId,
            feedback
          });

          this.options.onStatusChange?.("空闲");
        }
      } catch (err) {
        console.error("轮询 MCP 请求失败: ", err);
        this.options.onStatusChange?.("连接异常");
      }
    }, 1000);
  }

  dispose() {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
