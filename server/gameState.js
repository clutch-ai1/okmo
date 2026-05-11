// server/gameState.js
// Haelt den Live-Zustand der Welt: alle verbundenen Spieler und ihre Battles.
// In einer echten MMORPG-Architektur wuerde dies in eine Datenbank persistiert.

const { spawnMonster } = require('./data/monsters');
const { SPAWN_POINT, isWalkable, isEncounterTile } = require('./data/world');

class Player {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.x = SPAWN_POINT.x;
    this.y = SPAWN_POINT.y;
    this.facing = 'down'; // up | down | left | right
    this.color = randomColor(); // visuelle Unterscheidung im Client
    // Starter-Monster zufaellig ausgewaehlt
    const starters = ['flamepup', 'aquafin', 'leaflet'];
    const pick = starters[Math.floor(Math.random() * starters.length)];
    this.party = [spawnMonster(pick, 5)];
    this.activeBattle = null;
  }

  // Reduzierter Datensatz, der zu allen Clients gebroadcastet wird
  publicData() {
    return { id: this.id, name: this.name, x: this.x, y: this.y, facing: this.facing, color: this.color };
  }

  // Ausfuehrlicher Datensatz nur fuer den Spieler selbst
  privateData() {
    return { ...this.publicData(), party: this.party, inBattle: !!this.activeBattle };
  }
}

function randomColor() {
  const colors = ['#ff5252','#ffb142','#fffa65','#7bed9f','#70a1ff','#a29bfe','#fd79a8','#e17055'];
  return colors[Math.floor(Math.random() * colors.length)];
}

class GameState {
  constructor() {
    this.players = new Map(); // id -> Player
  }

  addPlayer(id, name) {
    const player = new Player(id, name);
    this.players.set(id, player);
    return player;
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  getPlayer(id) {
    return this.players.get(id);
  }

  // Versucht den Spieler eine Tile-Distanz in eine Richtung zu bewegen.
  // Liefert { moved, encounter } zurueck.
  tryMove(id, direction) {
    const p = this.getPlayer(id);
    if (!p || p.activeBattle) return { moved: false };
    const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
    const dy = direction === 'up'   ? -1 : direction === 'down'  ? 1 : 0;
    p.facing = direction;
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (!isWalkable(nx, ny)) return { moved: false };
    // Kollision mit anderen Spielern
    for (const other of this.players.values()) {
      if (other.id !== id && other.x === nx && other.y === ny) return { moved: false };
    }
    p.x = nx;
    p.y = ny;
    // Random encounter? 12% pro Schritt im hohen Gras
    let encounter = false;
    if (isEncounterTile(nx, ny) && Math.random() < 0.12) encounter = true;
    return { moved: true, encounter };
  }

  // Liste aller oeffentlichen Spielerdaten (fuer Broadcast).
  allPlayersPublic() {
    return Array.from(this.players.values()).map(p => p.publicData());
  }
}

module.exports = { GameState, Player };
