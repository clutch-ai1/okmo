// client/js/world.js
// Rendert die Tile-Map und Spieler-Sprites auf das Canvas.
// Tiles werden als einfache farbige Quadrate gezeichnet - du kannst hier
// spaeter Bilder/Spritesheets einsetzen.

const TILE_SIZE = 32;
const VIEW_TILES_X = 20; // 640 / 32
const VIEW_TILES_Y = 15; // 480 / 32

// Tile-Codes (mussen mit server/data/world.js uebereinstimmen)
const T = { GRASS: 0, TALL_GRASS: 1, WATER: 2, TREE: 3, PATH: 4, SAND: 5 };

const TILE_COLORS = {
  [T.GRASS]:      '#5dbb63',
  [T.TALL_GRASS]: '#3a8c3e',
  [T.WATER]:      '#3b82c4',
  [T.TREE]:       '#264d2a',
  [T.PATH]:       '#c8a878',
  [T.SAND]:       '#e8d493',
};

class WorldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.world = null;        // Map-Daten vom Server
    this.players = new Map(); // id -> public player data
    this.you = null;          // dein eigener Spieler
  }

  setWorld(world) { this.world = world; }
  setPlayers(list) {
    this.players.clear();
    for (const p of list) this.players.set(p.id, p);
  }
  setYou(you) { this.you = you; }

  // Hauptzeichenroutine. Kamera folgt dem eigenen Spieler.
  render() {
    if (!this.world || !this.you) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Kamera so platzieren, dass der Spieler in der Mitte ist
    const cx = Math.max(0, Math.min(this.world.width  - VIEW_TILES_X, this.you.x - Math.floor(VIEW_TILES_X / 2)));
    const cy = Math.max(0, Math.min(this.world.height - VIEW_TILES_Y, this.you.y - Math.floor(VIEW_TILES_Y / 2)));

    // Tiles
    for (let ty = 0; ty < VIEW_TILES_Y; ty++) {
      for (let tx = 0; tx < VIEW_TILES_X; tx++) {
        const wx = cx + tx;
        const wy = cy + ty;
        const tile = this.world.map[wy] && this.world.map[wy][wx];
        const px = tx * TILE_SIZE;
        const py = ty * TILE_SIZE;
        ctx.fillStyle = TILE_COLORS[tile] || '#000';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

        // Verzierungen
        if (tile === T.TREE) {
          ctx.fillStyle = '#3d7a44';
          ctx.beginPath();
          ctx.arc(px + TILE_SIZE/2, py + TILE_SIZE/2, TILE_SIZE/2 - 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (tile === T.TALL_GRASS) {
          ctx.fillStyle = '#2a6e2e';
          for (let i = 0; i < 4; i++) {
            ctx.fillRect(px + 4 + i * 7, py + 18, 3, 10);
          }
        }
      }
    }

    // Spieler zeichnen
    for (const p of this.players.values()) {
      const sx = (p.x - cx) * TILE_SIZE;
      const sy = (p.y - cy) * TILE_SIZE;
      if (sx < -TILE_SIZE || sy < -TILE_SIZE || sx > this.canvas.width || sy > this.canvas.height) continue;
      this._drawPlayer(sx, sy, p);
    }
  }

  _drawPlayer(x, y, p) {
    const ctx = this.ctx;
    // Schatten
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x + TILE_SIZE/2, y + TILE_SIZE - 4, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Koerper
    ctx.fillStyle = p.color || '#fff';
    ctx.fillRect(x + 8, y + 10, 16, 16);
    // Kopf
    ctx.fillStyle = '#ffe0bd';
    ctx.fillRect(x + 10, y + 4, 12, 10);
    // Blickrichtungs-Indikator (kleines Auge)
    ctx.fillStyle = '#000';
    const eye = { up:[14,4], down:[14,11], left:[10,8], right:[18,8] };
    const e = eye[p.facing] || eye.down;
    ctx.fillRect(x + e[0], y + e[1], 2, 2);
    // Name
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText(p.name, x + TILE_SIZE/2 + 1, y - 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(p.name, x + TILE_SIZE/2, y - 2);
  }
}

window.WorldRenderer = WorldRenderer;
