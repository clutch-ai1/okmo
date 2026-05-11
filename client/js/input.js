// client/js/input.js
// Tastatur-Input. Bewegungen werden mit Throttle gesendet, damit der
// Spieler nicht 60x pro Sekunde durch die Map fliegt.

class InputManager {
  constructor() {
    this.lastMoveTime = 0;
    this.moveCooldown = 140; // ms zwischen Schritten
    this.held = new Set();
    this.disabled = false;
    this.onMove = null;
    this.onChatToggle = null;

    window.addEventListener('keydown', (e) => this._down(e));
    window.addEventListener('keyup',   (e) => this._up(e));
  }

  setDisabled(b) { this.disabled = b; this.held.clear(); }

  _down(e) {
    if (this.disabled) return;
    // Wenn Chat-Input fokussiert ist, ignorieren
    if (document.activeElement && document.activeElement.id === 'chat-input') {
      if (e.key === 'Enter' || e.key === 'Escape') {
        if (this.onChatToggle) this.onChatToggle(e.key);
      }
      return;
    }
    if (e.key === 'Enter') { if (this.onChatToggle) this.onChatToggle('Enter'); return; }
    const dir = this._dirFor(e.key);
    if (dir) {
      this.held.add(dir);
      this._tryMove();
    }
  }

  _up(e) {
    const dir = this._dirFor(e.key);
    if (dir) this.held.delete(dir);
  }

  _dirFor(key) {
    switch (key) {
      case 'ArrowUp':    case 'w': case 'W': return 'up';
      case 'ArrowDown':  case 's': case 'S': return 'down';
      case 'ArrowLeft':  case 'a': case 'A': return 'left';
      case 'ArrowRight': case 'd': case 'D': return 'right';
    }
    return null;
  }

  // Wird vom Game-Loop und beim KeyDown aufgerufen
  tick() {
    if (this.disabled || this.held.size === 0) return;
    this._tryMove();
  }

  _tryMove() {
    const now = performance.now();
    if (now - this.lastMoveTime < this.moveCooldown) return;
    const dir = this.held.values().next().value;
    if (!dir) return;
    this.lastMoveTime = now;
    if (this.onMove) this.onMove(dir);
  }
}

window.InputManager = InputManager;
