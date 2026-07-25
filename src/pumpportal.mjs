// PumpPortal real-time data websocket.
// One connection, many subscriptions (per their docs: never open a socket per token).
import WebSocket from 'ws';
import { config } from './config.mjs';

const WS_URL = config.wsApiKey
  ? `wss://pumpportal.fun/api/data?api-key=${config.wsApiKey}`
  : 'wss://pumpportal.fun/api/data';

export class PumpPortalFeed {
  constructor() {
    this.ws = null;
    this.handlers = { newToken: [], tokenTrade: [] };
    this.watchedMints = new Set();
  }

  onNewToken(fn) { this.handlers.newToken.push(fn); }
  onTokenTrade(fn) { this.handlers.tokenTrade.push(fn); }

  connect() {
    this.ws = new WebSocket(WS_URL);

    this.ws.on('open', () => {
      console.log('📡 PumpPortal websocket connected');
      this.send({ method: 'subscribeNewToken' });
      // Re-subscribe to trades for any mints we were watching before a reconnect.
      if (this.watchedMints.size) {
        this.send({ method: 'subscribeTokenTrade', keys: [...this.watchedMints] });
      }
    });

    this.ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      this.route(msg);
    });

    this.ws.on('close', () => {
      console.warn('📡 websocket closed — reconnecting in 3s');
      setTimeout(() => this.connect(), 3000);
    });

    this.ws.on('error', (e) => console.error('📡 websocket error:', e.message));
  }

  route(msg) {
    // New-token events carry txType "create"; trade events carry "buy"/"sell".
    if (msg.txType === 'create' || (msg.mint && msg.name && msg.symbol && !msg.txType)) {
      this.handlers.newToken.forEach((fn) => fn(msg));
    } else if (msg.txType === 'buy' || msg.txType === 'sell') {
      this.handlers.tokenTrade.forEach((fn) => fn(msg));
    }
  }

  /** Start receiving trade events for a mint we now hold. */
  watchMint(mint) {
    if (this.watchedMints.has(mint)) return;
    this.watchedMints.add(mint);
    this.send({ method: 'subscribeTokenTrade', keys: [mint] });
  }

  unwatchMint(mint) {
    if (!this.watchedMints.has(mint)) return;
    this.watchedMints.delete(mint);
    this.send({ method: 'unsubscribeTokenTrade', keys: [mint] });
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }
}
