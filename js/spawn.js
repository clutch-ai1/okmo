// js/spawn.js
// Renders the current spawn (or "waiting" if none) into the spawn-canvas.

class SpawnView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width; this.H = canvas.height;
    this.ctx.imageSmoothingEnabled = false;

    this.state = 'idle';            // idle | active | resolved
    this.spawn = null;
    this.attempt = null;
    this.lastResult = null;
    this.bobPhase = 0;
    this.rayPhase = 0;
    this.flash = 0;
    this.shinySparkles = [];

    this.lastFrame = performance.now();
    this._loop = this._loop.bind(this);
    this._rafId = requestAnimationFrame(this._loop);
    this._idleSkip = 0;

    // Use ResizeObserver instead of getBoundingClientRect every frame
    this._pendingResize = null;
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(entries => {
        const rect = entries[0].contentRect;
        this._pendingResize = { w: Math.max(320, Math.floor(rect.width)), h: Math.max(240, Math.floor(rect.height)) };
      });
      this._ro.observe(this.canvas);
    }
  }

  setSpawn(spawn) {
    this.spawn = spawn;
    this.state = spawn ? 'active' : 'idle';
    this.lastResult = null;
    // Reset any color overrides from the previous result
    const nameEl = document.getElementById('spawn-overlay-name');
    const timerEl = document.getElementById('spawn-overlay-timer');
    if (nameEl) nameEl.style.color = '';
    if (timerEl) timerEl.style.color = '';
    this._updateOverlay();
    this._renderStars();
    this._renderIvs();
    this._renderMoves();
    if (spawn) {
      const p = spawn.pokemon || (spawn.pokemonId && GameData.POKEMON_BY_ID[spawn.pokemonId]);
      if (p) SpriteCache.preload(p.spriteUrl);
    }
  }

  _updateOverlay() {
    const overlay = document.getElementById('spawn-overlay');
    const img = document.getElementById('spawn-overlay-img');
    const nameEl = document.getElementById('spawn-overlay-name');
    const timerEl = document.getElementById('spawn-overlay-timer');
    if (!overlay) return;
    if (this.spawn) {
      const p = this.spawn.pokemon || GameData.POKEMON_BY_ID[this.spawn.pokemonId];
      overlay.classList.remove('no-spawn');
      if (img && p) { img.src = p.spriteUrl; img.alt = p.name; img.style.display = ''; }
      if (nameEl && p) nameEl.textContent = 'A wild ' + p.name + ' appeared!';
    } else {
      overlay.classList.add('no-spawn');
      if (img) { img.removeAttribute('src'); img.style.display = 'none'; }
      if (nameEl) nameEl.textContent = 'Waiting for next spawn...';
      if (timerEl) timerEl.textContent = '';
    }
  }

  _renderStars() {
    const starsEl = document.getElementById('spawn-overlay-stars');
    if (!starsEl) return;
    if (!this.spawn) { starsEl.textContent = ''; return; }
    const p = this.spawn.pokemon || GameData.POKEMON_BY_ID[this.spawn.pokemonId];
    if (!p) { starsEl.textContent = ''; return; }
    const r = Math.max(1, Math.min(5, p.rarity || 1));
    starsEl.innerHTML =
      '<span style="color:#ffd166">' + '★'.repeat(r) + '</span>' +
      '<span style="color:rgba(255,255,255,0.25)">' + '★'.repeat(5 - r) + '</span>';
  }

  _ivTier(p) {
    if (p >= 0.95) return { name: 'Perfect',   color: '#ffd166', stars: 5 };
    if (p >= 0.80) return { name: 'Excellent', color: '#ff9f43', stars: 4 };
    if (p >= 0.60) return { name: 'Great',     color: '#7bed9f', stars: 3 };
    if (p >= 0.40) return { name: 'Decent',    color: '#74b9ff', stars: 2 };
    if (p >= 0.20) return { name: 'Weak',      color: '#a4b0be', stars: 1 };
    return                 { name: 'Pathetic', color: '#636e72', stars: 0 };
  }

  _renderIvs() {
    const ivsEl = document.getElementById('spawn-overlay-ivs');
    const totalEl = document.getElementById('spawn-overlay-iv-total');
    const tierEl = document.getElementById('spawn-overlay-tier');
    if (!ivsEl || !totalEl || !tierEl) return;
    const ivs = this.attempt && this.attempt.ivs;
    if (!this.spawn || !ivs) {
      ivsEl.innerHTML = ''; totalEl.textContent = ''; tierEl.textContent = '';
      ivsEl.style.display = 'none';
      return;
    }
    ivsEl.style.display = 'grid';
    const labels = { hp:'HP', atk:'ATK', def:'DEF', spAtk:'SpA', spDef:'SpD', spd:'SPE' };
    const order = ['hp','atk','def','spAtk','spDef','spd'];
    let html = '';
    for (const k of order) {
      const v = ivs[k] || 0;
      const pct = Math.round(v / 31 * 100);
      const cls = v === 31 ? 'perfect' : (v >= 26 ? 'high' : '');
      const valCls = v === 31 ? 'perfect' : '';
      html += '<div class="iv-stat">' +
        '<span class="iv-label">' + labels[k] + '</span>' +
        '<span class="iv-bar"><span class="iv-bar-fill ' + cls + '" style="width:' + pct + '%"></span></span>' +
        '<span class="iv-value ' + valCls + '">' + v + '</span>' +
      '</div>';
    }
    ivsEl.innerHTML = html;
    const total = order.reduce((s, k) => s + (ivs[k] || 0), 0);
    const pct = total / 186;
    const tier = this._ivTier(pct);
    const power = Math.round(pct * 100);
    totalEl.innerHTML = 'IV Total: <b style="color:' + tier.color + '">' + total + '/186</b> · Power ' + power;
    tierEl.innerHTML = '<span style="color:' + tier.color + '">' + tier.name + '</span>';
  }

  setAttempt(attempt) {
    this.attempt = attempt;
    if (attempt && attempt.isShiny) this.shinySparkles = this._spawnSparkles();
    else this.shinySparkles = [];
    this._renderIvs();
    this._renderMoves();
  }

  _renderMoves() {
    const movesEl = document.getElementById('spawn-overlay-moves');
    if (!movesEl) return;
    const moves = this.attempt && this.attempt.moves;
    if (!this.spawn || !moves || !moves.length) {
      movesEl.innerHTML = '';
      movesEl.style.display = 'none';
      return;
    }
    movesEl.style.display = 'flex';
    movesEl.innerHTML = '<div class="moves-label">Moves</div>' +
      '<div class="moves-grid">' + moves.map(id => {
        const m = GameData.MOVE_BY_ID[id];
        if (!m) return '';
        const catBadge = m.cat === 'physical' ? '⚔️' : (m.cat === 'special' ? '✨' : '🛡');
        const powerStr = m.power > 0 ? ('Pow ' + m.power) : 'Status';
        return '<div class="move-chip" style="border-color:' + m.color + '">' +
          '<div class="move-name" style="color:' + m.color + '">' + m.name + '</div>' +
          '<div class="move-meta">' + catBadge + ' ' + powerStr + ' · ' + m.acc + '%</div>' +
        '</div>';
      }).join('') + '</div>';
  }
  setResult(result) {
    this.lastResult = result;
    this.state = 'resolved';
    if (result && result.caught) this.flash = 1;
    // Update overlay text to show result, hide stale "appeared" line
    const nameEl = document.getElementById('spawn-overlay-name');
    const timerEl = document.getElementById('spawn-overlay-timer');
    const p = this.spawn ? (this.spawn.pokemon || GameData.POKEMON_BY_ID[this.spawn.pokemonId]) : null;
    if (nameEl && result && p) {
      nameEl.textContent = result.caught ? (p.name + (result.isShiny ? ' ✨' : '') + ' caught!') : (p.name + ' broke free');
      nameEl.style.color = result.caught ? '#7bed9f' : '#ff6b6b';
    }
    if (timerEl && result) {
      timerEl.textContent = result.caught ? 'Caught with ' + (result.ball || '?') : 'Used: ' + (result.ball || '?');
      timerEl.style.color = '';
    }
  }
  clear() {
    this.spawn = null; this.attempt = null; this.lastResult = null; this.state = 'idle';
    this._updateOverlay();
    this._renderStars();
    this._renderIvs();
    this._renderMoves();
    const nameEl = document.getElementById('spawn-overlay-name');
    const timerEl = document.getElementById('spawn-overlay-timer');
    if (nameEl) nameEl.style.color = '';
    if (timerEl) { timerEl.style.color = ''; timerEl.textContent = ''; }
  }

  _spawnSparkles() {
    const arr = [];
    for (let i = 0; i < 14; i++) {
      arr.push({ angle: Math.random()*Math.PI*2, dist: 30 + Math.random()*70, phase: Math.random()*Math.PI*2 });
    }
    return arr;
  }

  _loop(now) {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    // When idle with no spawn, throttle to ~10fps to save CPU/GPU
    if (this.state === 'idle' && !this.spawn) {
      this._idleSkip++;
      if (this._idleSkip < 6) { this._rafId = requestAnimationFrame(this._loop); return; }
      this._idleSkip = 0;
    }

    this.bobPhase += dt * 2.4;
    this.rayPhase += dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 1.5);
    for (const s of this.shinySparkles) s.phase += dt * 3;

    // Apply pending resize from ResizeObserver (no forced reflow)
    if (this._pendingResize) {
      const { w, h } = this._pendingResize;
      this._pendingResize = null;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
        this.W = w; this.H = h;
      }
    }

    this._draw();
    this._rafId = requestAnimationFrame(this._loop);
  }

  _draw() {
    const ctx = this.ctx;
    ctx.fillStyle = '#15162e'; ctx.fillRect(0, 0, this.W, this.H);

    if (this.state === 'idle' || !this.spawn) {
      this._drawWaiting();
      return;
    }
    const p = this.spawn.pokemon || GameData.POKEMON_BY_ID[this.spawn.pokemonId];
    const a = this.spawn.area || GameData.AREA_BY_ID[this.spawn.areaId];

    // Shiny is only revealed after a successful catch
    const showShiny = this.state === 'resolved' && this.lastResult && this.lastResult.isShiny;

    // Background tinted by pokemon type — or golden for legendary
    const isLegendary = !!(this.spawn && this.spawn.isLegendary);
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    if (isLegendary) {
      // Pulsing golden gradient
      const pulse = (Math.sin(this.bobPhase * 0.7) + 1) / 2;
      g.addColorStop(0, '#5a3a08'); g.addColorStop(0.4, '#aa7a18'); g.addColorStop(0.6, '#ffcc44'); g.addColorStop(1, '#5a3a08');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
      ctx.fillStyle = 'rgba(255, 220, 100, ' + (0.05 + pulse * 0.08) + ')';
      ctx.fillRect(0, 0, this.W, this.H);
    } else if (showShiny) {
      g.addColorStop(0, '#5b3b8a'); g.addColorStop(0.5, '#a85ce0'); g.addColorStop(1, '#3a1f5a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    } else {
      g.addColorStop(0, this._darken(p.color, 60));
      g.addColorStop(0.5, this._darken(p.color, 30));
      g.addColorStop(1, '#1c1535');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    }

    // Rotating rays behind pokemon
    this._drawRays(this.W/2, this.H*0.42);

    // Stars
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < 30; i++) {
      const sx = (i * 73 + Math.floor(performance.now() / 130)) % this.W;
      const sy = (i * 47) % (this.H / 2);
      ctx.fillRect(sx, sy, 2, 2);
    }

    // (Pokemon, header & timer are rendered by the HTML overlay above
    //  to avoid the duplicate sprite that used to sit behind the floating one.)

    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + this.flash + ')';
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  _drawWaiting() {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, '#1f1838'); g.addColorStop(1, '#15162e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);

    // Stars
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < 50; i++) {
      const sx = (i * 73 + Math.floor(performance.now() / 200)) % this.W;
      const sy = (i * 41) % this.H;
      ctx.fillRect(sx, sy, 2, 2);
    }

    // Big rotating Pokeball center
    ctx.save();
    ctx.translate(this.W / 2, this.H / 2 - 20);
    ctx.rotate(this.rayPhase * 0.6);
    const r = 60;
    ctx.fillStyle = '#e85a5a';
    ctx.beginPath(); ctx.arc(0,0,r,Math.PI,0); ctx.fill();
    ctx.fillStyle = '#f5f5f5';
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillRect(-r,-7,r*2,14);
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(0,0,18,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0,0,12,0,Math.PI*2); ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = '500 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    // Countdown if we know when the next spawn is
    const nextAt = (window.Net && Net.state && Net.state.nextSpawnAt) || 0;
    if (nextAt > Date.now()) {
      const remaining = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 36px system-ui, sans-serif';
      ctx.fillText(remaining + 's', this.W/2, this.H/2 + 80);
      ctx.fillStyle = '#fff';
      ctx.font = '500 14px system-ui, sans-serif';
      ctx.fillText('Next Pokémon in...', this.W/2, this.H/2 + 110);
    } else {
      ctx.fillText('Waiting for the next spawn...', this.W/2, this.H/2 + 80);
      ctx.fillStyle = '#cbd5f0';
      ctx.font = '500 13px system-ui, sans-serif';
      ctx.fillText('A new Pokémon appears every minute for everyone online.', this.W/2, this.H/2 + 108);
    }
  }

  _drawRays(cx, cy) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rayPhase * 0.3);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.moveTo(0, 0);
      const a1 = (i / 14) * Math.PI * 2;
      const a2 = a1 + (Math.PI * 2) / 14 * 0.4;
      ctx.lineTo(Math.cos(a1) * 400, Math.sin(a1) * 400);
      ctx.lineTo(Math.cos(a2) * 400, Math.sin(a2) * 400);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  _drawPokemon(pokemon) {
    const ctx = this.ctx;
    const breath = Math.sin(this.bobPhase) * 4;
    const x = this.W/2, y = this.H * 0.42;
    const size = 160 + breath;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(x, y + 70, 60, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Glow — Shiny verwendet Mix aus Pokemon-Farbe und Gold (nur nach Catch sichtbar)
    const showShiny = this.state === 'resolved' && this.lastResult && this.lastResult.isShiny;
    const glowColor = showShiny ? this._mixWithGold(pokemon.color) : pokemon.color;
    const glow = ctx.createRadialGradient(x, y, 5, x, y, 130);
    glow.addColorStop(0, glowColor + 'd0');
    glow.addColorStop(1, glowColor + '00');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, 130, 0, Math.PI*2); ctx.fill();

    // Sparkles for shiny
    if (showShiny) {
      for (const s of this.shinySparkles) {
        const sx = x + Math.cos(s.angle + s.phase * 0.3) * s.dist;
        const sy = y + Math.sin(s.angle + s.phase * 0.3) * s.dist * 0.6;
        const al = (Math.sin(s.phase) + 1) / 2;
        ctx.fillStyle = 'rgba(255, 240, 150, ' + al + ')';
        ctx.fillRect(sx - 2, sy - 2, 4, 4);
        ctx.fillRect(sx, sy - 5, 1, 10);
        ctx.fillRect(sx - 5, sy, 10, 1);
      }
    }

    // Sprite (shiny only revealed AFTER catch)
    const reveal = this.state === 'resolved' && this.lastResult && this.lastResult.isShiny;
    const url = reveal ? pokemon.spriteShinyUrl : pokemon.spriteUrl;
    const sprite = SpriteCache.get(url);
    if (sprite.ready && !sprite.failed) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite.img, x - size/2, y - size/2, size, size);
      ctx.imageSmoothingEnabled = true;
    } else {
      ctx.font = (size * 0.6) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(pokemon.emoji, x, y);
    }
  }

  _drawHeader(pokemon, area) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, this.W, 64);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('A wild ' + pokemon.name + (this.attempt && this.attempt.isShiny ? ' ✨' : '') + '!', 16, 28);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#ffd166';
    ctx.fillText('#' + String(pokemon.dex).padStart(3,'0') + ' · ' + pokemon.type + ' · ' + '★'.repeat(pokemon.rarity), 16, 50);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#cbd5f0';
    if (area) ctx.fillText(area.emoji + ' ' + area.name, this.W - 16, 30);
    if (this.attempt) {
      ctx.fillStyle = '#cbd5f0';
      ctx.fillText('IVs: hidden until catch', this.W - 16, 50);
    }
    if (this.lastResult && this.lastResult.caught && this.lastResult.ivs) {
      const ivT = Object.values(this.lastResult.ivs).reduce((a,b)=>a+b, 0);
      const power = Math.round(ivT / 186 * 100);
      ctx.fillStyle = '#7bed9f';
      ctx.fillText('IVs revealed: ' + ivT + '/186 · Power ' + power, this.W - 16, 50);
    }
  }

  _drawStatusBar() {
    const ctx = this.ctx;
    if (!this.spawn) return;
    const remain = Math.max(0, this.spawn.resolvesAt - Date.now());
    const total = this.spawn.resolvesAt - this.spawn.spawnedAt;
    const pct = remain / total;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, this.H - 70, this.W, 70);

    const ballName = this.attempt && this.attempt.ball ?
      (GameData.BALL_BY_ID[this.attempt.ball] && GameData.BALL_BY_ID[this.attempt.ball].name) || this.attempt.ball : 'No ball';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    if (remain > 0) {
      ctx.fillText('Resolves in ' + Math.ceil(remain/1000) + 's · Loaded: ' + ballName, this.W/2, this.H - 46);
    } else {
      ctx.fillText('Rolling catch...', this.W/2, this.H - 46);
    }

    // Progress bar
    const barX = 40, barY = this.H - 28, barW = this.W - 80, barH = 12;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    this._roundRect(barX, barY, barW, barH, 6); ctx.fill();
    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, '#7bed9f'); grad.addColorStop(0.6, '#ffd166'); grad.addColorStop(1, '#ff6b6b');
    ctx.fillStyle = grad;
    this._roundRect(barX, barY, barW * pct, barH, 6); ctx.fill();
  }

  _drawResult(pokemon) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, this.H/2 - 60, this.W, 120);
    ctx.font = 'bold 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    if (this.lastResult.caught) {
      ctx.fillStyle = '#7bed9f';
      ctx.fillText(pokemon.name + (this.lastResult.isShiny ? ' ✨' : '') + ' caught!', this.W/2, this.H/2);
    } else {
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText(pokemon.name + ' broke free!', this.W/2, this.H/2);
    }
    ctx.font = '14px system-ui, sans-serif'; ctx.fillStyle = '#cbd5f0';
    if (this.lastResult.ball) {
      const b = GameData.BALL_BY_ID[this.lastResult.ball];
      ctx.fillText('Used: ' + (b ? b.name : this.lastResult.ball), this.W/2, this.H/2 + 30);
    }
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _mixWithGold(hex) {
    // Mix mit Gold #ffd166 zur 50%
    const num = parseInt(hex.slice(1), 16);
    let r = (((num >> 16) & 0xff) + 0xff) / 2 | 0;
    let g = (((num >> 8) & 0xff) + 0xd1) / 2 | 0;
    let b = ((num & 0xff) + 0x66) / 2 | 0;
    return '#' + ((r<<16)|(g<<8)|b).toString(16).padStart(6, '0');
  }
  _darken(hex, amt) {
    const num = parseInt(hex.slice(1), 16);
    let r = Math.max(0, ((num >> 16) - amt));
    let g = Math.max(0, (((num >> 8) & 0xff) - amt));    let b = Math.max(0, ((num & 0xff) - amt));
    return '#' + ((r<<16)|(g<<8)|b).toString(16).padStart(6, '0');
  }
}
window.SpawnView = SpawnView;
