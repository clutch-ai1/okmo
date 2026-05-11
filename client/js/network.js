// client/js/network.js
// Duenne WebSocket-Wrapper-Klasse mit Event-Handlern fuer jeden Nachrichtentyp.

class Network {
  constructor() {
    this.ws = null;
    this.handlers = {};
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}`;
    this.ws = new WebSocket(url);
    this.ws.onopen    = () => this._fire('open');
    this.ws.onclose   = () => this._fire('close');
    this.ws.onerror   = (e) => this._fire('error', e);
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this._fire(msg.type, msg);
      } catch (err) { console.error('Bad JSON:', e.data); }
    };
  }

  send(type, data = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, ...data }));
  }

  on(type, fn) {
    (this.handlers[type] = this.handlers[type] || []).push(fn);
  }

  _fire(type, payload) {
    (this.handlers[type] || []).forEach(fn => fn(payload));
  }
}

window.net = new Network();
