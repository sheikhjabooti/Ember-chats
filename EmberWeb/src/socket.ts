import type { ServerFrame } from "./types";

export type SocketStatus = "connecting" | "open" | "closed";

function defaultWsUrl(): string {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws`;
}

/**
 * One WebSocket per signed-in session. It reconnects with backoff, and
 * remembers which breakouts the UI has open so it can re-subscribe after
 * a reconnect (the server then sends a fresh snapshot).
 */
export class EmberSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<(frame: ServerFrame) => void>();
  private statusListeners = new Set<(status: SocketStatus) => void>();
  private breakoutSubscriptions = new Map<string, number>();
  private retryDelayMs = 500;
  private retryTimer: number | undefined;
  private pingTimer: number | undefined;
  private stopped = false;
  status: SocketStatus = "connecting";

  constructor(
    private readonly token: string,
    private readonly url = defaultWsUrl()
  ) {}

  connect() {
    this.stopped = false;
    this.open();
  }

  close() {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  on(listener: (frame: ServerFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (status: SocketStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Reference counted so two components can watch the same breakout. */
  subscribeBreakout(chatId: string) {
    const count = this.breakoutSubscriptions.get(chatId) ?? 0;
    this.breakoutSubscriptions.set(chatId, count + 1);
    if (count === 0) this.send({ type: "breakout:subscribe", chatId });
  }

  unsubscribeBreakout(chatId: string) {
    const count = this.breakoutSubscriptions.get(chatId) ?? 0;
    if (count <= 1) {
      this.breakoutSubscriptions.delete(chatId);
      this.send({ type: "breakout:unsubscribe", chatId });
    } else {
      this.breakoutSubscriptions.set(chatId, count - 1);
    }
  }

  sendBreakoutMessage(chatId: string, text: string): boolean {
    return this.send({ type: "breakout:send", chatId, text });
  }

  private send(payload: unknown): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  private setStatus(status: SocketStatus) {
    this.status = status;
    for (const l of this.statusListeners) l(status);
  }

  private open() {
    this.setStatus("connecting");
    const ws = new WebSocket(`${this.url}?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.retryDelayMs = 500;
      this.setStatus("open");
      for (const chatId of this.breakoutSubscriptions.keys()) {
        ws.send(JSON.stringify({ type: "breakout:subscribe", chatId }));
      }
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ type: "ping" }), 25_000);
    };

    ws.onmessage = (event) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      for (const l of this.listeners) l(frame);
    };

    ws.onclose = (event) => {
      window.clearInterval(this.pingTimer);
      if (this.ws === ws) this.ws = null;
      this.setStatus("closed");
      // 4401 means the token was rejected. Retrying won't help.
      if (this.stopped || event.code === 4401) return;
      this.retryTimer = window.setTimeout(() => this.open(), this.retryDelayMs);
      this.retryDelayMs = Math.min(this.retryDelayMs * 2, 10_000);
    };
  }
}
