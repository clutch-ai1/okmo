// js/arena.js
// Turn-based arena with pre-battle formation editor + jump-attack animations.

const ArenaUI = (function () {
  // --- State ---
  let canvas, ctx;
  let modal, logEl, statusEl, partyEl, forfeitBtn, titleEl, resultEl;
  let formationModal, formationGrid, formationBoxList, formationConfirm, formationCancel;
  let pendingStart = null;          // { kind: 'tower' | 'pvp', targetUserId }
  let match = null;                 // current public match snapshot
  const turnQueue = [];             // queued turn events to animate
  let activeAnim = null;            // { uid, dx, dy, hitAt, doneAt, started }
  const livePos = new Map();        // uid -> {x,y}  current animated positions
  const liveHp  = new Map();        // uid -> hp (delayed for HP-bar animation)
  let rafHandle = null;
  const spriteCache = new Map();
  const dmgPopups = [];             // {x,y,text,color,until}

  function init() {
    modal           = document.getElementById('arena-modal');
    canvas          = document.getElementById('arena-canvas');
    logEl           = document.getElementById('arena-log');
    statusEl        = document.getElementById('arena-status');
    titleEl         = document.getElementById('arena-title');
    partyEl         = document.getElementById('arena-party');
    forfeitBtn      = document.getElementById('arena-forfeit');
    resultEl        = document.getElementById('arena-result');
    formationModal  = document.getElementById('formation-modal');
    formationGrid   = document.getElementById('formation-grid');
    formationBoxList = document.getElementById('formation-box-list');
    formationConfirm = document.getElementById('formation-confirm');
    formationCancel  = document.getElementById('formation-cancel');

    if (canvas) {
      ctx = canvas.getContext('2d');
      canvas.width = 800; canvas.height = 400;
    }
    if (forfeitBtn) {
      forfeitBtn.onclick = () => { if (confirm('Forfeit?')) Net.arenaForfeit(); };
    }
    const closeBtn = modal && modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.onclick = closeArena;

    if (formationCancel)  formationCancel.onclick  = () => closeFormation();
    if (formationConfirm) formationConfirm.onclick = () => confirmFormation();
    const fClose = formationModal && formationModal.querySelector('.modal-close');
    if (fClose) fClose.onclick = () => closeFormation();

    Net.on('arena_state',  onArenaState);
    Net.on('arena_turn',   onArenaTurn);
    Net.on('arena_finish', onArenaFinish);
  }

  // ============ Formation Editor ============
  let _formation = [null,null,null,null,null,null];
  let _enemyPreview = [];          // server-provided enemy team [{slot,name,level,spriteUrl,...}]
  let _dragSource = null;          // { kind: 'box'|'slot', caughtId, slotIdx }

  function openFormation(start) {
    pendingStart = start;
    const u = Net.state.user || {};
    _formation = (Array.isArray(u.formation) ? u.formation.slice(0, 6) : [null,null,null,null,null,null]);
    while (_formation.length < 6) _formation.push(null);
    _enemyPreview = [];
    // Show modal immediately with placeholder, request enemy preview
    document.getElementById('formation-enemy-header').textContent = 'Loading opponent...';
    renderFormation();
    formationModal.classList.remove('hidden');
    if (!Net._previewListenerWired) {
      Net._previewListenerWired = true;
      Net.on('battle_preview', onBattlePreview);
    }
    Net.send('request_battle_preview', {
      kind: start.kind,
      targetUserId: start.targetUserId || null,
    });
  }
  function onBattlePreview(msg) {
    if (!msg.ok) {
      UI.toast(msg.reason || 'Could not load opponent', 'error');
      closeFormation();
      return;
    }
    _enemyPreview = (msg.preview && msg.preview.enemyTeam) || [];
    const header = document.getElementById('formation-enemy-header');
    if (msg.preview && msg.preview.kind === 'tower') {
      header.textContent = '🗼 TOWER FLOOR ' + msg.preview.towerFloor;
    } else if (msg.preview && msg.preview.kind === 'pvp') {
      header.textContent = '⚔ OPPONENT';
    }
    renderFormation();
  }
  function closeFormation() {
    formationModal.classList.add('hidden');
    pendingStart = null;
    _dragSource = null;
  }
  function renderFormation() {
    if (!formationGrid) return;
    const caught = Net.state.caught || [];
    const byId = new Map(caught.map(c => [c.id, c]));
    // Player grid
    formationGrid.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const slot = document.createElement('div');
      slot.className = 'fmt-slot';
      slot.dataset.slot = i;
      const cid = _formation[i];
      const inst = cid != null ? byId.get(cid) : null;
      if (inst) {
        const p = GameData.POKEMON_BY_ID[inst.pokemonId];
        const url = inst.isShiny ? p.spriteShinyUrl : p.spriteUrl;
        slot.innerHTML =
          '<img src="' + url + '" alt="' + p.name + '" draggable="true">' +
          '<div class="fmt-slot-name">' + p.name + '</div>' +
          '<div class="fmt-slot-lvl">Lv ' + (inst.level || 5) + '</div>' +
          '<button class="fmt-slot-clear" title="Remove">×</button>';
        const img = slot.querySelector('img');
        img.addEventListener('dragstart', (e) => {
          _dragSource = { kind: 'slot', caughtId: inst.id, slotIdx: i };
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });
        slot.querySelector('.fmt-slot-clear').onclick = (e) => {
          e.stopPropagation();
          _formation[i] = null;
          renderFormation();
        };
      } else {
        slot.classList.add('empty');
        slot.innerHTML = '<div class="fmt-slot-empty">Slot ' + (i+1) + '<br><small>' + (i < 3 ? 'Top' : 'Bot') + ' row</small></div>';
      }
      // Drop target
      slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drag-over'); });
      slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drag-over');
        if (!_dragSource) return;
        const targetIdx = i;
        if (_dragSource.kind === 'box') {
          // Place from box; remove existing copy elsewhere
          for (let k = 0; k < 6; k++) if (_formation[k] === _dragSource.caughtId) _formation[k] = null;
          _formation[targetIdx] = _dragSource.caughtId;
        } else if (_dragSource.kind === 'slot') {
          // Swap between slots
          const src = _dragSource.slotIdx;
          const tmp = _formation[targetIdx];
          _formation[targetIdx] = _formation[src];
          _formation[src] = tmp;
        }
        _dragSource = null;
        renderFormation();
      });
      formationGrid.appendChild(slot);
    }

    // Enemy grid (read-only, mirrored visually)
    const enemyGrid = document.getElementById('formation-enemy-grid');
    enemyGrid.innerHTML = '';
    const enemyBySlot = new Map();
    for (const e of _enemyPreview) enemyBySlot.set(e.slot != null ? e.slot : -1, e);
    for (let i = 0; i < 6; i++) {
      const cell = document.createElement('div');
      cell.className = 'fmt-slot enemy';
      const e = enemyBySlot.get(i);
      if (e) {
        cell.innerHTML =
          '<img src="' + e.spriteUrl + '" alt="' + e.name + '">' +
          '<div class="fmt-slot-name">' + e.name + (e.isShiny ? ' ✨' : '') + '</div>' +
          '<div class="fmt-slot-lvl">Lv ' + e.level + '</div>';
      } else {
        cell.classList.add('empty');
        cell.innerHTML = '<div class="fmt-slot-empty">—</div>';
      }
      enemyGrid.appendChild(cell);
    }

    // Box list (draggable)
    formationBoxList.innerHTML = '';
    const placed = new Set(_formation.filter(x => x != null));
    if (caught.length === 0) {
      formationBoxList.innerHTML = '<div class="empty-state">No Pokemon to deploy. Catch some first!</div>';
    } else {
      caught.slice(0, 60).forEach(inst => {
        const p = GameData.POKEMON_BY_ID[inst.pokemonId];
        if (!p) return;
        const url = inst.isShiny ? p.spriteShinyUrl : p.spriteUrl;
        const isPlaced = placed.has(inst.id);
        const cell = document.createElement('div');
        cell.className = 'fmt-box-cell' + (isPlaced ? ' placed' : '');
        cell.draggable = !isPlaced;
        cell.innerHTML =
          '<img src="' + url + '" alt="' + p.name + '">' +
          '<div class="fmt-box-name">' + p.name + (inst.isShiny ? ' ✨' : '') + '</div>' +
          '<div class="fmt-box-lvl">Lv ' + (inst.level || 5) + '</div>';
        if (!isPlaced) {
          cell.addEventListener('dragstart', (e) => {
            _dragSource = { kind: 'box', caughtId: inst.id };
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          });
          // Click as fallback: auto-place in first empty slot
          cell.addEventListener('click', () => {
            const emptyIdx = _formation.findIndex(x => x == null);
            if (emptyIdx < 0) { UI.toast('All slots full — drag onto a slot to swap', 'error'); return; }
            _formation[emptyIdx] = inst.id;
            renderFormation();
          });
        }
        formationBoxList.appendChild(cell);
      });
    }
  }
  function confirmFormation() {
    const placedCount = _formation.filter(x => x != null).length;
    if (placedCount === 0) { UI.toast('Place at least one Pokemon', 'error'); return; }
    const start = pendingStart;
    closeFormation();
    if (start && start.kind === 'tower') {
      Net.send('start_tower', { formation: _formation });
    } else if (start && start.kind === 'pvp') {
      Net.send('start_pvp', { targetUserId: start.targetUserId, formation: _formation });
    }
  }

  // ============ Arena Battle ============
  function onArenaState(msg) {
    if (!msg.ok) {
      UI.toast(msg.reason || 'Arena error', 'error');
      return;
    }
    if (!msg.match) return;
    match = msg.match;
    seedLivePositions();
    openArena();
    renderHud();
  }
  function onArenaTurn(msg) {
    if (!match) match = msg.match;
    // Update server-authoritative state
    match = msg.match;
    turnQueue.push(msg.turn);
    // Sync hp values to authoritative state for non-impact-target pokemon
    for (const p of match.pokemon) {
      if (!liveHp.has(p.uid)) liveHp.set(p.uid, p.hp);
    }
  }
  function onArenaFinish(msg) {
    match = msg.match;
    // Cancel any in-flight animation and clear queue — match is over
    activeAnim = null;
    turnQueue.length = 0;
    // Snap everyone home
    for (const p of match.pokemon) {
      livePos.set(p.uid, { x: p.x, y: p.y });
      liveHp.set(p.uid, p.hp);
    }
    showResult(msg.match);
  }

  function openArena() {
    modal.classList.remove('hidden');
    if (resultEl) resultEl.classList.add('hidden');
    if (!rafHandle) loop();
  }
  function closeArena() {
    modal.classList.add('hidden');
    if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
    if (match && !match.over) Net.arenaForfeit();
    match = null; turnQueue.length = 0; activeAnim = null;
    livePos.clear(); liveHp.clear(); dmgPopups.length = 0;
  }

  function seedLivePositions() {
    livePos.clear(); liveHp.clear();
    for (const p of match.pokemon) {
      livePos.set(p.uid, { x: p.x, y: p.y });
      liveHp.set(p.uid, p.hp);
    }
  }

  function showResult(m) {
    if (!resultEl) return;
    const win = m.winner === 'player';
    resultEl.classList.remove('hidden');
    resultEl.classList.toggle('win', win);
    resultEl.classList.toggle('loss', !win);
    const r = m.reward || {};
    const rewardLine = win
      ? '+' + (r.gold || 0) + ' gold · +' + (r.xp || 0) + ' XP per Pokemon' + (r.bonus ? ' · ' + r.bonus.count + 'x ' + r.bonus.ball : '')
      : '+5 gold (consolation)';
    resultEl.innerHTML =
      '<div class="arena-result-banner">' + (win ? '🏆 VICTORY!' : '💀 DEFEAT') + '</div>' +
      '<div class="arena-result-rewards">' + rewardLine + '</div>' +
      '<button class="primary-btn" id="arena-result-close">Continue</button>';
    const btn = document.getElementById('arena-result-close');
    if (btn) btn.onclick = () => closeArena();
  }

  function getSprite(url) {
    if (!url) return null;
    let img = spriteCache.get(url);
    if (img) return img;
    img = new Image();
    img.src = url;
    spriteCache.set(url, img);
    return img;
  }

  // ============ Render Loop ============
  function loop() {
    rafHandle = requestAnimationFrame(loop);
    if (!ctx || !match) return;
    stepAnim();
    // Defensive: snap any non-animating pokemon to its home position every frame.
    // This prevents the "stuck mid-jump" bug if an animation ever fails to reset.
    const animUid = activeAnim ? activeAnim.attackerUid : null;
    for (const p of match.pokemon) {
      if (p.uid === animUid) continue;
      livePos.set(p.uid, { x: p.x, y: p.y });
    }
    drawField();
  }

  // Animate active turn; pull next from queue when idle.
  function stepAnim() {
    const now = performance.now();
    if (!activeAnim && turnQueue.length) {
      const turn = turnQueue.shift();
      const attacker = match.pokemon.find(p => p.uid === turn.attackerUid);
      const target   = match.pokemon.find(p => p.uid === turn.targetUid);
      if (attacker && target) {
        activeAnim = {
          attackerUid: turn.attackerUid,
          targetUid:   turn.targetUid,
          isSkill: turn.isSkill,
          skillColor: turn.skillColor,
          dmg: turn.dmg,
          additionalHits: turn.additionalHits || [],
          targetHpAfter: turn.targetHp,
          targetFainted: turn.targetFainted,
          startedAt: now,
          // Phases: jump-out, impact, jump-back  (each ~250ms)
          jumpOutMs: 250,
          impactMs: 200,
          jumpBackMs: 250,
          impactFired: false,
        };
      }
    }

    if (activeAnim) {
      const a = activeAnim;
      const elapsed = now - a.startedAt;
      const attacker = match.pokemon.find(p => p.uid === a.attackerUid);
      const target   = match.pokemon.find(p => p.uid === a.targetUid);
      if (!attacker || !target) { activeAnim = null; return; }

      const home = livePos.get(a.attackerUid) || { x: attacker.x, y: attacker.y };
      const tx = target.x, ty = target.y;
      // Stop short so the sprite doesn't fully overlap
      const dx = tx - attacker.x, dy = ty - attacker.y;
      const dist = Math.sqrt(dx*dx + dy*dy) || 1;
      const stopShort = 30;
      const aimX = attacker.x + (dx / dist) * (dist - stopShort);
      const aimY = attacker.y + (dy / dist) * (dist - stopShort);

      if (elapsed < a.jumpOutMs) {
        const f = elapsed / a.jumpOutMs;
        const ef = easeOutCubic(f);
        const arc = Math.sin(f * Math.PI) * 16;
        livePos.set(a.attackerUid, {
          x: attacker.x + (aimX - attacker.x) * ef,
          y: attacker.y + (aimY - attacker.y) * ef - arc,
        });
      } else if (elapsed < a.jumpOutMs + a.impactMs) {
        // Impact frame
        livePos.set(a.attackerUid, { x: aimX, y: aimY });
        if (!a.impactFired) {
          // Fire damage popup + apply to liveHp
          const popColor = a.isSkill ? (a.skillColor || '#ffd166') : '#fff';
          dmgPopups.push({ x: target.x, y: target.y - 28, text: '-' + a.dmg, color: popColor, until: now + 800 });
          liveHp.set(a.targetUid, a.targetHpAfter);
          for (const h of a.additionalHits) {
            const t2 = match.pokemon.find(p => p.uid === h.uid);
            if (t2) {
              dmgPopups.push({ x: t2.x, y: t2.y - 28, text: '-' + h.dmg, color: popColor, until: now + 800 });
              const cur = liveHp.get(h.uid) || 0;
              liveHp.set(h.uid, Math.max(0, cur - h.dmg));
            }
          }
        }
      } else if (elapsed < a.jumpOutMs + a.impactMs + a.jumpBackMs) {
        const f = (elapsed - a.jumpOutMs - a.impactMs) / a.jumpBackMs;
        const ef = easeOutCubic(f);
        livePos.set(a.attackerUid, {
          x: aimX + (attacker.x - aimX) * ef,
          y: aimY + (attacker.y - aimY) * ef,
        });
      } else {
        livePos.set(a.attackerUid, { x: attacker.x, y: attacker.y });
        activeAnim = null;
        renderHud();
      }
    }
    while (dmgPopups.length && dmgPopups[0].until < now) dmgPopups.shift();
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function drawField() {
    if (!match) return;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#3e8e41';
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W/2, H/2, 60, W/2, H/2, W/1.2);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.beginPath(); ctx.arc(W/2, H/2, 50, 0, Math.PI*2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(W/2, H/2, 50, -Math.PI/2, Math.PI/2);
    ctx.fillStyle = '#e63946'; ctx.fill();
    ctx.beginPath(); ctx.arc(W/2, H/2, 12, 0, Math.PI*2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(W/2, H/2, 50, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W/2-50, H/2); ctx.lineTo(W/2+50, H/2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W/2, H/2, 12, 0, Math.PI*2); ctx.stroke();

    const sorted = match.pokemon.slice().sort((a, b) => a.row - b.row);
    for (const p of sorted) {
      const lp = livePos.get(p.uid) || { x: p.x, y: p.y };
      drawPokemon(p, lp.x, lp.y);
    }
    const now = performance.now();
    for (const pop of dmgPopups) {
      const left = pop.until - now;
      const fade = Math.max(0, Math.min(1, left / 800));
      ctx.globalAlpha = fade;
      ctx.font = 'bold 16px Inter, sans-serif';
      ctx.fillStyle = pop.color;
      ctx.textAlign = 'center';
      ctx.fillText(pop.text, pop.x, pop.y - (1 - fade) * 30);
      ctx.globalAlpha = 1;
    }
  }

  function drawPokemon(p, x, y) {
    const hp = liveHp.has(p.uid) ? liveHp.get(p.uid) : p.hp;
    const fainted = p.fainted || hp <= 0;
    if (fainted) ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.ellipse(x, y + 22, 22, 6, 0, 0, Math.PI*2);
    ctx.fillStyle = p.side === 'player' ? 'rgba(91, 192, 255, 0.45)' : 'rgba(255, 107, 107, 0.45)';
    ctx.fill();
    const img = getSprite(p.spriteUrl);
    const SZ = 56;
    if (img && img.complete && img.naturalWidth > 0) {
      if (p.side === 'enemy') {
        ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1);
      } else {
        ctx.drawImage(img, x - SZ/2, y - SZ/2, SZ, SZ);
      }
    } else {
      ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI*2);
      ctx.fillStyle = p.side === 'player' ? '#5bc0ff' : '#ff6b6b'; ctx.fill();
    }
    if (!fainted) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x - 18, y - 38, 36, 12);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px Inter, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Lv ' + p.level, x, y - 32);
      const ratio = Math.max(0, hp / p.maxHp);
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x - 24, y - 26, 48, 5);
      ctx.fillStyle = ratio > 0.5 ? '#4ade80' : (ratio > 0.25 ? '#fbbf24' : '#ef4444');
      ctx.fillRect(x - 24, y - 26, 48 * ratio, 5);
      const total = p.skillCharges || 2;
      const filled = p.charges || 0;
      const dotW = 8, gap = 3;
      const startX = x - ((dotW * total + gap * (total - 1)) / 2);
      for (let i = 0; i < total; i++) {
        const fx = startX + i * (dotW + gap);
        ctx.fillStyle = i < filled ? (p.skillColor || '#ffd166') : 'rgba(255,255,255,0.25)';
        ctx.fillRect(fx, y + 18, dotW, 4);
      }
    } else {
      ctx.strokeStyle = '#888'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x-12, y-12); ctx.lineTo(x+12, y+12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x+12, y-12); ctx.lineTo(x-12, y+12); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function renderHud() {
    if (!match) return;
    if (titleEl) titleEl.textContent = match.isTower ? '🗼 Tower — Floor ' + match.towerFloor : (match.isPvp ? '⚔ PvP' : '⚔ Battle');
    if (statusEl) statusEl.textContent = match.over ? (match.winner === 'player' ? 'Victory!' : 'Defeat') : 'Round ' + (match.round || 1);
    if (logEl) logEl.innerHTML = match.log.slice().reverse().map(l => '<div class="arena-log-line">' + escapeHtml(l.msg) + '</div>').join('');
    if (partyEl) {
      const players = match.pokemon.filter(p => p.side === 'player');
      const enemies = match.pokemon.filter(p => p.side === 'enemy');
      partyEl.innerHTML =
        '<div class="arena-party-side"><div class="arena-party-label">Your Team</div>' + players.map(_partyRow).join('') + '</div>' +
        '<div class="arena-party-side enemy"><div class="arena-party-label">Opponent</div>' + enemies.map(_partyRow).join('') + '</div>';
    }
  }
  function _partyRow(p) {
    const hp = liveHp.has(p.uid) ? liveHp.get(p.uid) : p.hp;
    const pct = Math.max(0, Math.round(100 * hp / p.maxHp));
    const fainted = (p.fainted || hp <= 0) ? ' fainted' : '';
    return '<div class="arena-party-row' + fainted + '"><span class="arena-party-name">' + escapeHtml(p.name) + ' Lv' + p.level + '</span><div class="arena-party-hp"><div class="arena-party-hp-fill" style="width:' + pct + '%"></div></div><span class="arena-party-skill" style="color:' + (p.skillColor || '#ffd166') + '">' + escapeHtml(p.skillName) + ' (' + p.charges + '/' + p.skillCharges + ')</span></div>';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  return { init, openArena, closeArena, openFormation };
})();
window.ArenaUI = ArenaUI;
