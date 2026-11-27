export class DeathmatchClient {
  constructor({ relayUrl, code, token, name, onMessage, onStatus }) {
    this.relayUrl = relayUrl;
    this.code = code;
    this.token = token;
    this.name = name;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.socket = null;
    this.closedByUser = false;
    this.retry = 0;
    this.connect();
  }

  connect() {
    if (this.closedByUser) return;
    const url = new URL(`/room/${encodeURIComponent(this.code)}`, this.relayUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', this.token);
    url.searchParams.set('name', this.name || 'Agent');
    this.onStatus('Connecting to match…');
    const socket = this.socket = new WebSocket(url);
    socket.addEventListener('open', () => { this.retry = 0; this.onStatus('Connected'); });
    socket.addEventListener('message', event => {
      try { this.onMessage(JSON.parse(event.data)); } catch { /* ignore malformed packets */ }
    });
    socket.addEventListener('close', () => {
      if (this.closedByUser) return;
      this.onStatus('Connection lost. Reconnecting…');
      const delay = Math.min(5000, 500 * (2 ** this.retry++));
      setTimeout(() => this.connect(), delay);
    });
    socket.addEventListener('error', () => this.onStatus('Relay connection failed. Retrying…'));
  }

  send(type, data = {}) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type, ...data }));
  }

  close() { this.closedByUser = true; this.socket?.close(); }
}
