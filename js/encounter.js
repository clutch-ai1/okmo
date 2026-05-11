// js/encounter.js
// Timing-Bar Encounter mit IV-basierter Schwierigkeit + Polish.

const PHASE = {
  ENTRY:     'entry',       // Pokemon springt rein
  AIMING:    'aiming',
  THROWING:  'throwing',
  SHAKING:   'shaking',
  RESULT:    'result',
  IDLE:      'idle',
};

class EncounterScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width;
    this.H = canvas.height;

    this.phase = PHASE.IDLE;
    this.spawn = null;
    this.pokemon = null;
    this.ballId = 'pokeball';
    this.onComplete = null;

    this.bar = {
      x: 0, y: 0, w: 0, h: 28,
      markerPos: 0,
      markerDir: 1,
      speed: 1.0,
      sweetWidth: 0.18,
      goodWidth: 0.42,
      stopped: false,
      stopAt: null,
      hitZone: null,
    };

    this.target = { x: this.W / 2, y: this.H * 0.36, breathPhase: 0, hop: 0, scale: 0 };
    this.ball = { x: this.W / 2, y: this.H - 80, scale: 1, rotation: 0 };
    this.ballAnim = null;

    this.shake = { phase: 0, count: 0, target: 0, success: false };
    this.flash = 0;
    this.resultText = '';
    this.resultColor = '#fff';
    this.resultBonus = null;
    this.shinySparkles = [];
    this.entryT = 0;
    this.rayPhase = 0;
    this.starParticles = [];

    this._bindEvents();

    this.lastFrame = performance.now();
    this.active = false;
  }

  open(spawn, ballId) {
    this.spawn = spawn;
    this.pokemon = GameData.POKEMON_BY_ID[spawn.pokemonId];
    this.ballId = ballId;

    const rarityFactor = 0.55 + this.pokemon.rarity * 0.28;
    const ivFactor = IVUtils.ivDifficulty(spawn.ivs);
    const speed = rarityFactor * ivFactor;
    const baseSweet = 0.22 - this.pokemon.rarity * 0.025;
    const sweet = Math.max(0.05, baseSweet / ivFactor);
    const good = Math.max(0.18, sweet * 2.6);

    this.bar.x = 70;
    this.bar.y = this.H - 110;
    this.bar.w = this.W - 140;
    this.bar.markerPos = Math.random();
    this.bar.markerDir = Math.random() < 0.5 ? 1 : -1;
    this.bar.speed = speed;
    this.bar.sweetWidth = sweet;
    this.bar.goodWidth = good;
    this.bar.stopped = false;
    this.bar.stopAt = null;
    this.bar.hitZone = null;

    this.ball.x = this.W / 2;
    this.ball.y = this.H - 80;
    this.ball.scale = 1;
    this.ball.rotation = 0;
    this.ballAnim = null;

    this.shake = { phase: 0, count: 0, target: 0, success: false };
    this.flash = 0;
    this.resultText = '';
    this.resultBonus = null;
    this.target.hop = 0;
    this.target.scale = 0;
    this.entryT = 0;
    this.shinySparkles = spawn.isShiny ? this._spawnSparkles() : [];
    this.spriteUrl = spawn.isShiny ? this.pokemon.spriteShinyUrl : this.pokemon.spriteUrl;
    SpriteCache.preload(this.spriteUrl);

    this.phase = PHASE.ENTRY;
    this.active = true;
    this.lastFrame = performance.now();
    this._loop();
  }

  close() { this.active = false; }

  _bindEvents() {
    const stopAction = (e) => {
      if (this.phase !== PHASE.AIMING || this.bar.stopped) return;
      this._stopBar();
      if (e && e.preventDefault) e.preventDefault();
    };
    this.canvas.addEventListener('mousedown', stopAction);
    this.canvas.addEventListener('touchstart', stopAction, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (this.phase === PHASE.AIMING && !this.bar.stopped &&
          (e.code === 'Space' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        this._stopBar();
      }
    });
  }

  _spawnSparkles() {
    const arr = [];
    for (let i = 0; i < 14; i++) {
      arr.push({
        angle: Math.random() * Math.PI * 2,
        dist: 30 + Math.random() * 70,
        speed: 0.5 + Math.random() * 1.0,
        phase: Math.random() * Math.PI * 2,
      });
    }
    return arr;
  }

  _spawnStars(n) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      arr.push({
        x: this.target.x + (Math.random() - 0.5) * 60,
        y: this.target.y + (Math.random() - 0.5) * 60,
        vx: (Math.random() - 0.5) * 200,
        vy: -50 - Math.random() * 100,
        life: 0.8, maxLife: 0.8,
        size: 2 + Math.random() * 3,
        color: ['#ffd166', '#fff', '#7bed9f'][Math.floor(Math.random() * 3)],
      });
    }
    return arr;
  }

  _stopBar() {
    this.bar.stopped = true;
    this.bar.stopAt = this.bar.markerPos;
    const dist = Math.abs(this.bar.markerPos - 0.5);
    if (dist <= this.bar.sweetWidth / 2)      this.bar.hitZone = 'perfect';
    else if (dist <= this.bar.goodWidth / 2)  this.bar.hitZone = 'good';
    else                                      this.bar.hitZone = 'ok';
    if (this.bar.hitZone === 'perfect') {
      gameState.recordPerfectStop();
      this.starParticles = this._spawnStars(20);
    }
    setTimeout(() => this._beginThrow(), 350);
  }

  _beginThrow() {
    this.phase = PHASE.THROWING;
    this.ballAnim = {
      t: 0,
      duration: 0.7,
      sx: this.W / 2, sy: this.H - 80,
      ex: this.target.x, ey: this.target.y,
    };
  }

  _doCatchRoll() {
    const ball = GameData.BALL_BY_ID[this.ballId];
    let zoneMult = 1.0;
    if (this.bar.hitZone === 'perfect') zoneMult = 1.8;
    else if (this.bar.hitZone === 'good') zoneMult = 1.25;
    else if (this.bar.hitZone === 'ok')   zoneMult = 0.6;

    const ivMod = 1 / IVUtils.ivDifficulty(this.spawn.ivs);
    const baseRate = this.pokemon.catchRate * ball.catchMult * zoneMult * ivMod;
    const finalRate = Math.min(0.97, baseRate);

    let shakes = 0;
    let success = false;
    for (let i = 0; i < 4; i++) {
      if (Math.random() < finalRate) shakes++;
      else break;
    }
    if (shakes >= 4 || ball.catchMult >= 99) success = true;
    this.phase = PHASE.SHAKING;
    this.shake = { phase: 0, count: 0, target: success ? 4 : Math.max(1, shakes), success };
  }

  _loop() {
    if (!this.active) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this._update(dt);
    this._draw();
    requestAnimationFrame(() => this._loop());
  }

  _update(dt) {
    this.target.breathPhase += dt * 2.4;
    this.target.hop = Math.max(0, this.target.hop - dt * 4);
    this.rayPhase += dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);

    for (const s of this.shinySparkles) s.phase += dt * 3;

    // Star-Partikel
    for (const sp of this.starParticles) {
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.vy += 200 * dt;
      sp.life -= dt;
    }
    this.starParticles = this.starParticles.filter(s => s.life > 0);

    if (this.phase === PHASE.ENTRY) {
      this.entryT += dt * 2.2;
      // Ease-Out-Bounce-aehnlich
      const t = Math.min(1, this.entryT);
      const eased = 1 - Math.pow(1 - t, 3);
      this.target.scale = eased + Math.sin(t * Math.PI * 2) * 0.08;
      if (this.entryT >= 1.0) { this.target.scale = 1; this.phase = PHASE.AIMING; }
    }

    if (this.phase === PHASE.AIMING && !this.bar.stopped) {
      this.bar.markerPos += this.bar.markerDir * this.bar.speed * dt;
      if (this.bar.markerPos >= 1) { this.bar.markerPos = 1; this.bar.markerDir = -1; }
      if (this.bar.markerPos <= 0) { this.bar.markerPos = 0; this.bar.markerDir = 1; }
    }

    if (this.phase === PHASE.THROWING && this.ballAnim) {
      this.ballAnim.t += dt / this.ballAnim.duration;
      const t = Math.min(1, this.ballAnim.t);
      const a = this.ballAnim;
      this.ball.x = a.sx + (a.ex - a.sx) * t;
      const arcHeight = 120;
      const baseY = a.sy + (a.ey - a.sy) * t;
      this.ball.y = baseY - Math.sin(t * Math.PI) * arcHeight;
      this.ball.rotation = t * Math.PI * 4;
      this.ball.scale = 1 - t * 0.25;
      if (t >= 1) {
        this.ball.x = a.ex;
        this.ball.y = a.ey;
        this._doCatchRoll();
      }
    }

    if (this.phase === PHASE.SHAKING) {
      this.shake.phase += dt * 8;
      if (this.shake.phase >= this.shake.count * 1.6 + 1.6) {
        this.shake.count += 1;
        if (this.shake.count >= this.shake.target) {
          if (this.shake.success) this._catchSuccess();
          else this._catchFail();
        }
      }
    }
  }

  _catchSuccess() {
    this.phase = PHASE.RESULT;
    this.flash = 1;
    this.resultText = this.pokemon.name + (this.spawn.isShiny ? ' ✨' : '') + ' caught!';
    this.resultColor = this.spawn.isShiny ? '#ffd166' : '#7bed9f';
    this.starParticles = this._spawnStars(40);
    gameState.recordCatch(this.spawn, this.ballId);
    this.resultBonus = gameState.awardCatchBonus();
    setTimeout(() => this._finish('catch'), 1600);
  }

  _catchFail() {
    this.phase = PHASE.RESULT;
    this.resultText = 'Broke free!';
    this.resultColor = '#ff6b6b';
    this.target.hop = 1.0;
    setTimeout(() => this._finish('break'), 1100);
  }

  _finish(result) {
    if (this.onComplete) this.onComplete({ result, spawn: this.spawn, pokemon: this.pokemon, ball: this.ballId, bonus: this.resultBonus });
  }

  _draw() {
    const ctx = this.ctx;

    // Hintergrund-Verlauf, faerbt sich bei Shiny gold
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    if (this.spawn && this.spawn.isShiny) {
      g.addColorStop(0, '#5b3b8a'); g.addColorStop(0.5, '#a85ce0'); g.addColorStop(1, '#3a1f5a');
    } else {
      // Pokemon-typabhaengig
      const pCol = this.pokemon ? this.pokemon.color : '#7c5cff';
      g.addColorStop(0, this._darken(pCol, 60));
      g.addColorStop(0.5, this._darken(pCol, 30));
      g.addColorStop(1, '#1c1535');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);

    // Strahlen-Effekt hinter dem Pokemon
    this._drawRays();

    // Sterne im Hintergrund
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i < 36; i++) {
      const sx = (i * 73 + Math.floor(performance.now() / 130)) % this.W;
      const sy = (i * 47) % (this.H / 2);
      ctx.fillRect(sx, sy, 2, 2);
    }

    // Plattform unter Pokemon
    const platGrad = ctx.createRadialGradient(this.target.x, this.target.y + 60, 5, this.target.x, this.target.y + 60, 130);
    platGrad.addColorStop(0, 'rgba(255,255,255,0.22)');
    platGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = platGrad;
    ctx.beginPath();
    ctx.ellipse(this.target.x, this.target.y + 60, 100, 20, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pokemon
    if ((this.phase === PHASE.ENTRY || this.phase === PHASE.AIMING || this.phase === PHASE.THROWING) ||
        (this.phase === PHASE.RESULT && !this.shake.success)) {
      this._drawPokemon();
    }

    // Ball
    if (this.phase === PHASE.THROWING || this.phase === PHASE.SHAKING ||
        (this.phase === PHASE.RESULT && this.shake.success)) {
      this._drawBall();
    }

    // Star-Partikel
    for (const sp of this.starParticles) {
      const a = sp.life / sp.maxLife;
      ctx.fillStyle = sp.color;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Header
    this._drawHeader();

    // Bar
    if (this.phase === PHASE.AIMING) {
      this._drawTimingBar();
      this._drawHint();
    }

    // Result
    if (this.phase === PHASE.RESULT) this._drawResult();

    // Flash
    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + this.flash + ')';
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  _drawRays() {
    const ctx = this.ctx;
    const cx = this.target.x, cy = this.target.y;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rayPhase * 0.3);
    const rayCount = 14;
    for (let i = 0; i < rayCount; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const a1 = (i / rayCount) * Math.PI * 2;
      const a2 = a1 + (Math.PI * 2) / rayCount * 0.4;
      ctx.lineTo(Math.cos(a1) * 400, Math.sin(a1) * 400);
      ctx.lineTo(Math.cos(a2) * 400, Math.sin(a2) * 400);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  _drawHeader() {
    const ctx = this.ctx;
    // Halbtransparenter Top-Streifen
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, this.W, 64);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(this.pokemon.emoji + '  ' + this.pokemon.name + (this.spawn && this.spawn.isShiny ? ' ✨' : ''), 14, 28);
    const power = IVUtils.ivPowerLevel(this.spawn.ivs);
    const tier = IVUtils.ivTier(this.spawn.ivs);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = tier.color;
    ctx.fillText('Power ' + power + '  ·  ' + tier.name + '  ·  ' + '★'.repeat(this.pokemon.rarity), 14, 50);

    const ball = GameData.BALL_BY_ID[this.ballId];
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(ball.name + '  ×' + (gameState.data.balls[this.ballId] || 0), this.W - 14, 28);
    ctx.font = '11px system-ui';
    ctx.fillStyle = '#ddd';
    ctx.fillText(this.pokemon.type, this.W - 14, 50);
  }

  _drawPokemon() {
    const ctx = this.ctx;
    const breath = Math.sin(this.target.breathPhase) * 4;
    const hop = Math.sin(this.target.hop * 6) * (this.target.hop * 18);
    const x = this.target.x;
    const y = this.target.y - hop;
    const scale = this.target.scale;
    const size = (90 + breath) * scale;

    // Schatten skaliert
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(x, this.target.y + 60, 45 * scale, 9 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Glow
    const glowColor = (this.spawn && this.spawn.isShiny) ? '#ffd166' : this.pokemon.color;
    const glow = ctx.createRadialGradient(x, y, 5, x, y, 110);
    glow.addColorStop(0, glowColor + 'd0');
    glow.addColorStop(1, glowColor + '00');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 110, 0, Math.PI * 2);
    ctx.fill();

    // Shiny-Sparkles
    if (this.spawn && this.spawn.isShiny) {
      for (const s of this.shinySparkles) {
        const sx = x + Math.cos(s.angle + s.phase * 0.3) * s.dist;
        const sy = y + Math.sin(s.angle + s.phase * 0.3) * s.dist * 0.6;
        const a = (Math.sin(s.phase) + 1) / 2;
        ctx.fillStyle = 'rgba(255, 209, 102, ' + a + ')';
        ctx.fillRect(sx - 2, sy - 2, 4, 4);
        ctx.fillRect(sx, sy - 5, 1, 10);
        ctx.fillRect(sx - 5, sy, 10, 1);
      }
    }

    // Sprite oder Emoji-Fallback
    const sprite = SpriteCache.get(this.spriteUrl);
    if (sprite.ready && !sprite.failed) {
      const sw = size * 1.3;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite.img, x - sw/2, y - sw/2, sw, sw);
      ctx.imageSmoothingEnabled = true;
    } else {
      ctx.font = size + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.pokemon.emoji, x, y);
    }
  }

  _drawBall() {
    const ctx = this.ctx;
    let x = this.ball.x, y = this.ball.y, rot = this.ball.rotation;
    const s = this.ball.scale;
    if (this.phase === PHASE.SHAKING) {
      const wob = Math.sin(this.shake.phase * 4) * 8 * (this.shake.count < this.shake.target ? 1 : 0);
      x = this.target.x + wob;
      y = this.target.y;
      rot = wob * 0.05;
    }
    if (this.phase === PHASE.RESULT && this.shake.success) {
      x = this.target.x;
      y = this.target.y;
      rot = 0;
    }
    const ball = GameData.BALL_BY_ID[this.ballId];
    const r = 26 * s;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);

    // Schatten
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, r + 6, r * 0.8, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    // Obere Haelfte (Farbe)
    ctx.fillStyle = ball.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0);
    ctx.fill();
    // Highlight oben
    ctx.fillStyle = this._lighten(ball.color, 30);
    ctx.beginPath();
    ctx.arc(-r * 0.4, -r * 0.4, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    // Untere Haelfte
    ctx.fillStyle = '#f5f5f5';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI);
    ctx.fill();
    // Mittelband
    ctx.fillStyle = '#222';
    ctx.fillRect(-r, -2 * s, r * 2, 4 * s);
    // Knopf-Ring
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(0, 0, 8 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, 5 * s, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _drawTimingBar() {
    const ctx = this.ctx;
    const x = this.bar.x, y = this.bar.y, w = this.bar.w, h = this.bar.h;
    const sweetWidth = this.bar.sweetWidth, goodWidth = this.bar.goodWidth, markerPos = this.bar.markerPos;
    const cx = x + w / 2;

    // Aussen-Frame mit Glow
    ctx.shadowColor = 'rgba(255, 209, 102, 0.5)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    this._roundRect(ctx, x - 8, y - 8, w + 16, h + 16, 8); ctx.fill();
    ctx.shadowBlur = 0;

    // Bar-Hintergrund
    ctx.fillStyle = '#15152a';
    this._roundRect(ctx, x, y, w, h, 4); ctx.fill();

    // OK-Bereich (komplett, mit Verlauf)
    const okGrad = ctx.createLinearGradient(x, y, x + w, y);
    okGrad.addColorStop(0, '#e94c4c');
    okGrad.addColorStop(0.5, '#3a78b8');
    okGrad.addColorStop(1, '#e94c4c');
    ctx.fillStyle = okGrad;
    this._roundRect(ctx, x, y, w, h, 4); ctx.fill();

    // Good-Zone
    const goodX = cx - (goodWidth * w) / 2;
    const goodW = goodWidth * w;
    ctx.fillStyle = 'rgba(123, 237, 159, 0.65)';
    ctx.fillRect(goodX, y, goodW, h);

    // Sweet-Zone mit Glow
    const sweetX = cx - (sweetWidth * w) / 2;
    const sweetW = sweetWidth * w;
    ctx.shadowColor = 'rgba(255, 209, 102, 0.9)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(255, 209, 102, 1)';
    ctx.fillRect(sweetX, y, sweetW, h);
    ctx.shadowBlur = 0;
    // Sweet-Glow-Streifen oben
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillRect(sweetX, y, sweetW, 3);

    // Marker
    const mx = x + markerPos * w;
    ctx.fillStyle = '#000';
    ctx.fillRect(mx - 4, y - 8, 8, h + 16);
    ctx.fillStyle = '#fff';
    ctx.fillRect(mx - 2, y - 8, 4, h + 16);

    // Marker-Spitze
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(mx - 6, y - 10);
    ctx.lineTo(mx + 6, y - 10);
    ctx.lineTo(mx, y - 4);
    ctx.closePath();
    ctx.fill();

    // Labels unter dem Balken
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd166';
    ctx.fillText('PERFECT', cx, y + h + 14);
    ctx.fillStyle = '#7bed9f';
    ctx.fillText('GOOD', cx - goodW / 2 + 14, y + h + 14);
    ctx.fillText('GOOD', cx + goodW / 2 - 14, y + h + 14);
  }

  _drawHint() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Click / Spacebar = Throw', this.W / 2, this.H - 24);
  }

  _drawResult() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, this.H/2 - 40, this.W, 80);
    ctx.fillStyle = this.resultColor;
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.resultText, this.W/2, this.H/2 + 6);
    if (this.bar.hitZone) {
      const zoneText = { perfect: 'PERFECT HIT!', good: 'Good hit', ok: 'Just missed' }[this.bar.hitZone];
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillStyle = this.bar.hitZone === 'perfect' ? '#ffd166' : '#cbd5f0';
      ctx.fillText(zoneText, this.W/2, this.H/2 + 32);
    }
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

  _lighten(hex, amt) { return this._shade(hex, amt); }
  _darken(hex, amt)  { return this._shade(hex, -amt); }
  _shade(hex, amt) {
    const num = parseInt(hex.slice(1), 16);
    let r = (num >> 16) + amt;
    let g = ((num >> 8) & 0xff) + amt;
    let b = (num & 0xff) + amt;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return '#' + ((r<<16)|(g<<8)|b).toString(16).padStart(6, '0');
  }
}

window.EncounterScene = EncounterScene;
window.PHASE = PHASE;
