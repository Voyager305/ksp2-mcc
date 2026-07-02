/** WebSocket connection with auto-reconnect; raw server messages go to the handler. */
export class MccSocket {
  private ws: WebSocket | null = null;
  private closed = false;

  constructor(
    private onMessage: (msg: Record<string, unknown>) => void,
    private onStatus: (connected: boolean) => void,
  ) {}

  connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => this.onStatus(true);
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      this.onStatus(false);
      if (!this.closed) setTimeout(() => this.connect(), 2000);
    };
    ws.onerror = () => ws.close();
  }

  send(msg: Record<string, unknown>): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
