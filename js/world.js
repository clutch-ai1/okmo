// js/world.js
// Top-down Game Boy style: tile-based grass field, 4-direction wandering player,
// "Searching for a Pokémon..." banner with rotating Poké Ball.

const TILE = 32;

class WorldScene {
  constructor(canvas, onEncounter) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.onEncounter = onEncounter;

    this.W = canvas.width;
    this.H = canvas.height;
    this.cols = Math.floor(this.W / TILE);
    this.rows = Math.floor(this.H / TILE);
    // Top 1 row is reserved for the search banner
    this.bannerH = 48;

    this.area = GameData.AREA_BY_ID[gameState.data.currentAreaId];

    // Generate tile map
    this.tiles = this._generateMap();

    // Player at center
    this.player = {
      x: Math.floor(this.cols / 2),       // tile coords
      y: Math.floor((this.rows - 2) / 2),
      px: 0, py: 0,                       // pixel offset for smooth movement
      dir: 'down',                        // facing direction
      moving: false,
      moveT: 0,                           // 0..1 along current step
      moveDuration: 0.32,                 // seconds per tile
      walkFrame: 0,
      animTime: 0,
      idleTimer: 0.5 + Math.random() * 0.5,
    };

    // Searching banner: rotating ball
    this.banner = { ballRotation: 0, dotPhase: 0 };

    this.time = 0;
    this.lastFrame = performance.now();
    this.encounterTimer = this._randomEncounterDelay();
    this.paused = false;

    gameState.on(() => {
      const newArea = GameData.AREA_BY_ID[gameState.data.currentAreaId];
      if (newArea !== this.area) {
        this.area = newArea;
        this.tiles = this._generateMap();
        this.encounterTimer = this._randomEncounterDelay();
      }
    });
  }

  // 0 = ground, 1 = tall grass, 2 = tree, 3 = water, 4 = rock, 5 = flower
  _generateMap() {
    const map = [];
    const seed = Math.random;
    for (let y = 0; y < this.rows; y++) {
      const row = [];
      for (let x = 0; x < this.cols; x++) {
        let t = 0;
        // Frame trees on the border
        if (x === 0 || y === 0 || x === this.cols - 1 || y === this.rows - 1) t = 2;
        // Random tall grass patches
        else if (Math.random() < 0.32) t = 1;
        // Some flower decorations
        else if (Math.random() < 0.05) t = 5;
        // Occasional rocks
        else if (Math.random() < 0.03) t = 4;
        row.push(t);
      }
      map.push(row);
    }
    // Clear an area around player spawn so it doesnt start on a tree
    const cx = Math.floor(this.cols / 2);
    const cy = Math.floor((this.rows - 2) / 2);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (cx + dx > 0 && cy + dy > 0 && cx + dx < this.cols - 1 && cy + dy < this.rows - 1)
          map[cy + dy][cx + dx] = (dx === 0 && dy === 0) ? 0 : (Math.random() < 0.6 ? 1 : 0);
    return map;
  }

  _randomEncounterDelay() {
    const [min, max] = this.area.encounterDelay;
    return min + Math.random() * (max - min);
  }

  _isWalkable(x, y) {
    if (x < 1 || y < 1 || x >= this.cols - 1 || y >= this.rows - 1) return false;
    const t = this.tiles[y][x];
    return t === 0 || t === 1 || t === 5;   // ground, tall grass, flower
  }

  pause()  { this.paused = true; }
  resume() {
    this.paused = false;
    this.encounterTimer = this._randomEncounterDelay();
    this.lastFrame = performance.now();
  }

  step() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused) {
      this.time += dt;
      this._update(dt);
    }
    this._draw();
    requestAnimationFrame(() => this.step());
  }

  _update(dt) {
    const p = this.player;
    p.animTime += dt;
    this.banner.ballRotation += dt * 1.6;
    this.banner.dotPhase += dt * 2.5;

    if (p.moving) {
      p.moveT += dt / p.moveDuration;
      p.walkFrame = Math.floor(p.moveT * 4) % 4;
      if (p.moveT >= 1) {
        // Finalize step
        const dx = p.dir === 'right' ? 1 : p.dir === 'left' ? -1 : 0;
        const dy = p.dir === 'down'  ? 1 : p.dir === 'up'   ? -1 : 0;
        p.x += dx; p.y += dy;
        p.moveT = 0; p.moving = false;
        p.idleTimer = 0.15 + Math.random() * 0.5;
      }
    } else {
      p.idleTimer -= dt;
      if (p.idleTimer <= 0) {
        // Pick a direction, prefer continuing forward but with chance to turn
        const dirs = ['up', 'down', 'left', 'right'];
        let candidates = dirs;
        if (Math.random() < 0.55) candidates = [p.dir];   // continue
        // Try up to 8 times to pick a walkable direction
        let picked = null;
        for (let i = 0; i < 8; i++) {
          const d = candidates[Math.floor(Math.random() * candidates.length)];
          const dx = d === 'right' ? 1 : d === 'left' ? -1 : 0;
          const dy = d === 'down'  ? 1 : d === 'up'   ? -1 : 0;
          if (this._isWalkable(p.x + dx, p.y + dy)) { picked = d; break; }
          candidates = dirs;
        }
        if (picked) {
          p.dir = picked;
          p.moving = true;
          p.moveT = 0;
        } else {
          p.idleTimer = 0.4 + Math.random() * 0.5;
        }
      }
    }

    this.encounterTimer -= dt * 1000;
    if (this.encounterTimer <= 0) {
      const pokemon = gameState.pickRandomEncounter();
      const spawn = spawnInstance(pokemon);
      gameState.recordEncounter(pokemon.id);
      this.pause();
      this.onEncounter(spawn, pokemon);
    }
  }

  _draw() {
    const ctx = this.ctx;

    // Sky/background fill (visible only above the tile area if any)
    ctx.fillStyle = '#88c870';
    ctx.fillRect(0, 0, this.W, this.H);

    // Tiles
    this._drawTiles();

    // Player
    this._drawPlayer();

    // Top banner (overlay): "Searching for a Pokémon..."
    this._drawBanner();
  }

  _drawTiles() {
    const ctx = this.ctx;
    const a = this.area;
    const grass1 = '#88c560';
    const grass2 = '#7cb854';
    const tall1  = '#4f9c44';
    const tall2  = '#3f8a38';
    const water1 = '#5fa3df';
    const water2 = '#4f93cf';

    const offsetY = this.bannerH;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const t = this.tiles[y][x];
        const px = x * TILE;
        const py = y * TILE + offsetY - this.bannerH;     // tiles fill full canvas
        // Base ground checker
        ctx.fillStyle = (x + y) % 2 === 0 ? grass1 : grass2;
        ctx.fillRect(px, py, TILE, TILE);
        // Tile-specific overlay
        if (t === 1) this._drawTallGrass(px, py);
        if (t === 2) this._drawTree(px, py);
        if (t === 3) {
          ctx.fillStyle = (x + y) % 2 === 0 ? water1 : water2;
          ctx.fillRect(px, py, TILE, TILE);
        }
        if (t === 4) this._drawRock(px, py);
        if (t === 5) this._drawFlower(px, py);
      }
    }
  }

  _drawTallGrass(px, py) {
    const ctx = this.ctx;
    // Darker base patch
    ctx.fillStyle = '#3f8a38';
    ctx.fillRect(px + 2, py + 12, TILE - 4, TILE - 14);
    // Grass blades
    ctx.fillStyle = '#5fb05f';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(px + 4 + i * 7, py + 8 + (i % 2) * 2, 3, 18);
      ctx.fillRect(px + 4 + i * 7, py + 6 + (i % 2) * 2, 1, 4);
    }
    // Highlight
    ctx.fillStyle = '#7fd07f';
    ctx.fillRect(px + 5, py + 7, 1, 2);
    ctx.fillRect(px + 19, py + 9, 1, 2);
  }

  _drawTree(px, py) {
    const ctx = this.ctx;
    // Trunk
    ctx.fillStyle = '#5a3a1a';
    ctx.fillRect(px + 12, py + 18, 8, 14);
    ctx.fillStyle = '#3a2a10';
    ctx.fillRect(px + 12, py + 18, 3, 14);
    // Crown
    ctx.fillStyle = '#1f5a25';
    ctx.fillRect(px + 4, py + 4, 24, 20);
    ctx.fillStyle = '#2c7430';
    ctx.fillRect(px + 6, py + 2, 20, 14);
    ctx.fillStyle = '#3d8c44';
    ctx.fillRect(px + 8, py + 4, 4, 4);
    ctx.fillRect(px + 18, py + 6, 4, 4);
    ctx.fillRect(px + 14, py + 2, 6, 4);
    // Highlights
    ctx.fillStyle = '#5fb55f';
    ctx.fillRect(px + 10, py + 4, 2, 2);
    ctx.fillRect(px + 16, py + 8, 2, 2);
  }

  _drawRock(px, py) {
    const ctx = this.ctx;
    ctx.fillStyle = '#807060';
    ctx.fillRect(px + 6, py + 14, 20, 14);
    ctx.fillStyle = '#a09080';
    ctx.fillRect(px + 8, py + 12, 16, 4);
    ctx.fillStyle = '#605040';
    ctx.fillRect(px + 6, py + 24, 20, 4);
  }

  _drawFlower(px, py) {
    const ctx = this.ctx;
    const cx = px + TILE / 2;
    const cy = py + TILE / 2 + 2;
    // 4 petals
    ctx.fillStyle = '#ff7a9c';
    ctx.fillRect(cx - 5, cy - 2, 4, 4);
    ctx.fillRect(cx + 1, cy - 2, 4, 4);
    ctx.fillRect(cx - 2, cy - 5, 4, 4);
    ctx.fillRect(cx - 2, cy + 1, 4, 4);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
    // Stem
    ctx.fillStyle = '#3f8a38';
    ctx.fillRect(cx - 1, cy + 4, 2, 4);
  }

  _drawPlayer() {
    const ctx = this.ctx;
    const p = this.player;
    const dx = p.dir === 'right' ? 1 : p.dir === 'left' ? -1 : 0;
    const dy = p.dir === 'down'  ? 1 : p.dir === 'up'   ? -1 : 0;
    const ix = p.x + (p.moving ? dx * p.moveT : 0);
    const iy = p.y + (p.moving ? dy * p.moveT : 0);
    const px = Math.round(ix * TILE + TILE / 2);
    const py = Math.round(iy * TILE + TILE / 2);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(px, py + 12, 9, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    const step = p.moving ? (p.walkFrame % 2) : 0;
    const x = px - 8;
    const y = py - 16;

    // Shoes / legs depending on direction
    ctx.fillStyle = '#1a1310';
    if (p.dir === 'left' || p.dir === 'right') {
      ctx.fillRect(x + 4, y + 14 - step, 3, 4);
      ctx.fillRect(x + 9, y + 13 + step, 3, 4);
    } else {
      ctx.fillRect(x + 4, y + 14 - step, 3, 4);
      ctx.fillRect(x + 9, y + 14 + step, 3, 4);
    }

    // Body (red shirt)
    ctx.fillStyle = '#e85a5a';
    ctx.fillRect(x + 3, y + 7, 10, 8);
    // White stripe
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 3, y + 12, 10, 2);
    // Backpack hint (only for back/side views)
    if (p.dir === 'up') {
      ctx.fillStyle = '#5a8eb8';
      ctx.fillRect(x + 5, y + 8, 6, 6);
    }

    // Arms
    ctx.fillStyle = '#e85a5a';
    if (p.dir === 'left' || p.dir === 'right') {
      ctx.fillRect(p.dir === 'right' ? x + 13 : x + 0, y + 9, 3, 5);
    } else {
      ctx.fillRect(x + 1, y + 8, 2, 5);
      ctx.fillRect(x + 13, y + 8, 2, 5);
    }

    // Head
    ctx.fillStyle = '#ffe0bd';
    ctx.fillRect(x + 4, y + 0, 8, 7);

    // Cap (red with white front)
    ctx.fillStyle = '#e85a5a';
    ctx.fillRect(x + 3, y - 1, 10, 3);
    ctx.fillRect(x + 4, y - 3, 8, 2);
    // Cap brim
    ctx.fillStyle = '#c04848';
    if (p.dir === 'right')      ctx.fillRect(x + 11, y + 1, 4, 1);
    else if (p.dir === 'left')  ctx.fillRect(x + 1,  y + 1, 4, 1);
    else if (p.dir === 'down')  ctx.fillRect(x + 4,  y + 2, 8, 1);
    // Logo dot on cap
    ctx.fillStyle = '#fff';
    if (p.dir !== 'up') {
      ctx.fillRect(x + 7, y - 2, 2, 1);
    }

    // Face details (only for down/left/right)
    if (p.dir !== 'up') {
      ctx.fillStyle = '#000';
      if (p.dir === 'down') {
        ctx.fillRect(x + 5, y + 3, 1, 2);
        ctx.fillRect(x + 10, y + 3, 1, 2);
      } else if (p.dir === 'right') {
        ctx.fillRect(x + 9, y + 3, 1, 2);
        ctx.fillRect(x + 11, y + 3, 1, 2);
      } else if (p.dir === 'left') {
        ctx.fillRect(x + 4, y + 3, 1, 2);
        ctx.fillRect(x + 6, y + 3, 1, 2);
      }
      // Cheeks
      ctx.fillStyle = 'rgba(255,150,150,0.6)';
      if (p.dir === 'down') {
        ctx.fillRect(x + 4, y + 5, 2, 1);
        ctx.fillRect(x + 10, y + 5, 2, 1);
      }
    }
  }

  _drawBanner() {
    const ctx = this.ctx;
    // Banner background
    ctx.fillStyle = 'rgba(20, 16, 50, 0.92)';
    ctx.fillRect(0, 0, this.W, this.bannerH);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(0, this.bannerH - 1, this.W, 1);

    // Rotating Poké Ball (drawn directly)
    const ballX = 30, ballY = this.bannerH / 2;
    this._drawSpinningBall(ballX, ballY, 12, this.banner.ballRotation);

    // Text with animated dots
    const dotCount = (Math.floor(this.banner.dotPhase) % 3) + 1;
    const dots = '.'.repeat(dotCount).padEnd(3, ' ');
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Searching for a Pokémon' + dots, 56, ballY);

    // Right side: encounter timer bar
    const remaining = Math.max(0, this.encounterTimer / 1000);
    const emax = this.area.encounterDelay[1];
    const pct = 1 - Math.min(1, remaining / (emax / 1000));
    const barX = this.W - 130;
    const barY = ballY - 6;
    const barW = 110;
    const barH = 10;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    this._roundRect(ctx, barX, barY, barW, barH, 5); ctx.fill();
    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, '#7bed9f');
    grad.addColorStop(0.6, '#ffd166');
    grad.addColorStop(1, '#ff6b6b');
    ctx.fillStyle = grad;
    this._roundRect(ctx, barX, barY, barW * pct, barH, 5); ctx.fill();
    // Area label
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#cbd5f0';
    ctx.textAlign = 'right';
    ctx.fillText(this.area.emoji + ' ' + this.area.name, this.W - 14, this.bannerH - 6);
  }

  _drawSpinningBall(cx, cy, r, rot) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    // Top half red
    ctx.fillStyle = '#e85a5a';
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0);
    ctx.fill();
    // Bottom half white
    ctx.fillStyle = '#f5f5f5';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI);
    ctx.fill();
    // Mid band
    ctx.fillStyle = '#222';
    ctx.fillRect(-r, -2, r * 2, 4);
    // Center button
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }
}

window.WorldScene = WorldScene;
