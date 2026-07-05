/**
 * NetClient — thin WebSocket wrapper for the multiplayer protocol
 * (src/net/protocol.ts). Owns the socket lifecycle and message decode;
 * game-state mutation lives in NetworkSystem. Same-origin `/ws` in every
 * environment (vite proxies it in dev; production serves bundle + WS from
 * one Node process).
 */

import {
  decode,
  encode,
  type ClientMsg,
  type ServerMsg,
} from './protocol';

export type NetStatus = 'disconnected' | 'connecting' | 'connected';

export class NetClient {
  private ws: WebSocket | null = null;
  private _status: NetStatus = 'disconnected';

  /** Server-assigned player id (set on welcome). */
  myId = '';

  onMessage: ((msg: ServerMsg) => void) | null = null;
  onStatus: ((status: NetStatus) => void) | null = null;

  get status(): NetStatus {
    return this._status;
  }

  private setStatus(s: NetStatus): void {
    this._status = s;
    this.onStatus?.(s);
  }

  connect(opts: { name?: string; token?: string }): void {
    if (this.ws) this.disconnect();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;
    this.setStatus('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      ws.send(encode({ t: 'join', name: opts.name, token: opts.token }));
    };
    ws.onmessage = (ev) => {
      const msg = decode<ServerMsg>(String(ev.data));
      if (!msg) return;
      if (msg.t === 'welcome') {
        this.myId = msg.id;
        this.setStatus('connected');
      }
      this.onMessage?.(msg);
    };
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.setStatus('disconnected');
      }
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  disconnect(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.myId = '';
    this.setStatus('disconnected');
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encode(msg));
    }
  }
}
