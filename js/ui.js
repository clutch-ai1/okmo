// js/ui.js
// Modal management: Box, Pokedex, Leaderboards, Settings, Detail, Offline, Ball-picker.

const UI = (function () {
  let boxSort = 'date';

  function init() {
    document.getElementById('box-btn').onclick = openBox;
    document.getElementById('pokedex-btn').onclick = openPokedex;
    document.getElementById('leaderboard-btn').onclick = openLeaderboards;
    document.getElementById('settings-btn').onclick = openSettings;
    const qb = document.getElementById('quests-btn'); if (qb) qb.onclick = openQuests;
    const ab = document.getElementById('achievements-btn'); if (ab) ab.onclick = openAchievements;
    const sb = document.getElementById('shop-btn'); if (sb) sb.onclick = openShop;
    const tb = document.getElementById('tower-btn'); if (tb) tb.onclick = openTower;
    const pb = document.getElementById('players-btn'); if (pb) pb.onclick = openPlayers;
    const mb = document.getElementById('market-btn'); if (mb) mb.onclick = openMarket;
    const crystalChip = document.getElementById('hud-crystal-chip'); if (crystalChip) crystalChip.onclick = openCrystalShop;
    const avatar = document.getElementById('hud-avatar'); if (avatar) {
      avatar.style.cursor = 'pointer';
      avatar.onclick = () => { const u = Net.state.user; if (u) openProfile(u.id); };
    }
    const eb = document.getElementById('eggs-btn'); if (eb) eb.onclick = openEggs;
    const goldChip = document.getElementById('hud-gold-chip'); if (goldChip) goldChip.onclick = openShop;
    const lvlBadge = document.getElementById('hud-level'); if (lvlBadge) lvlBadge.onclick = openLevels;
    const xpBar = document.querySelector('.hud-xp-bar'); if (xpBar) xpBar.onclick = openLevels;
    // Admin button — only visible if username === 'admin'
    const adminBtn = document.getElementById('admin-btn');
    if (adminBtn) {
      adminBtn.onclick = openAdmin;
      const refreshAdminVisibility = () => {
        const u = Net.state.user;
        if (u && u.username === 'admin') adminBtn.classList.remove('hidden');
        else adminBtn.classList.add('hidden');
      };
      refreshAdminVisibility();
      Net.on('user_update', refreshAdminVisibility);
      Net.on('init', refreshAdminVisibility);
      Net.on('init', () => {
        const btns = document.getElementById('bottomLeftBtns');
        if (btns) btns.style.display = 'flex';
      });
    }
    initAdminPanel();
    setTimeout(() => {
      const btn = document.getElementById('info-btn-open');
      if (btn) btn.onclick = () => { close('settings-modal'); openInfo(); };
    }, 100);

    document.querySelectorAll('.modal').forEach(m => {
      m.addEventListener('click', (e) => { if (e.target === m) close(m.id); });
    });
    document.querySelectorAll('.modal-close').forEach(b => {
      b.onclick = () => {
        const modalId = b.closest('.modal').id;
        // If closing the battle modal mid-fight, forfeit on the server
        if (modalId === 'battle-modal') {
          const bs = Net.state.battle;
          if (bs && !bs.over) {
            Net.battleForfeit();
          }
          _currentBattleId = null;
          _lastBattleLogLen = 0;
        }
        close(modalId);
      };
    });

    document.getElementById('logout-btn').onclick = () => Net.logout();
  }

  function open(id)  { document.getElementById(id).classList.remove('hidden'); }
  function close(id) { document.getElementById(id).classList.add('hidden'); }

  // ---------- HUD ----------
  function refreshHud() {
    const u = Net.state.user;
    if (!u) return;
    const pdxCount = Object.keys(Net.state.pokedex).length;
    document.getElementById('hud-name').textContent = u.username;
    const titleEl = document.getElementById('hud-title');
    if (titleEl) titleEl.textContent = u.title ? '« ' + u.title + ' »' : '';
    document.getElementById('hud-meta').textContent = 'Pokedex ' + pdxCount + '/' + GameData.POKEDEX.length + ' · ' + u.totalCatches + ' catches';
    // Avatar: equipped premium avatar OR trainer image based on gender
    const avatarImg = document.getElementById('hud-avatar-img');
    if (avatarImg) {
      const gender = u.gender === 'female' ? 'female' : 'male';
      avatarImg.src = u.avatarSprite || ('assets/trainers/' + gender + '.png');
      avatarImg.alt = u.username;
      // For Pokemon-sprite avatars, don't apply face zoom — they're already centered
      avatarImg.classList.toggle('avatar-pokemon', !!u.avatarSprite);
    }

    // Level + XP bar
    const lvlEl = document.getElementById('hud-level');
    const xpFillEl = document.getElementById('hud-xp-fill');
    const xpTextEl = document.getElementById('hud-xp-text');
    if (lvlEl) lvlEl.textContent = 'Lv ' + (u.level || 1);
    if (u.level >= 50) {
      if (xpFillEl) xpFillEl.style.width = '100%';
      if (xpTextEl) xpTextEl.textContent = 'MAX';
    } else if (xpFillEl && xpTextEl) {
      const xp = u.xp || 0;
      const next = u.xpToNext || 100;
      xpFillEl.style.width = Math.min(100, (xp / next * 100)) + '%';
      xpTextEl.textContent = xp + ' / ' + next + ' XP';
    }

    // Streak — only show chip when active
    const streak = u.streak || 0;
    const streakEl = document.getElementById('hud-streak');
    const streakCountEl = document.getElementById('hud-streak-count');
    if (streakEl && streakCountEl) {
      streakCountEl.textContent = streak;
      streakEl.classList.toggle('hidden', streak === 0);
      streakEl.classList.toggle('hot', streak >= 3);
      streakEl.classList.toggle('blazing', streak >= 5);
      streakEl.classList.toggle('inferno', streak >= 10);
    }

    // Gold
    const goldEl = document.getElementById('hud-gold');
    if (goldEl) goldEl.textContent = (u.gold || 0);
    // Crystals
    const crystalEl = document.getElementById('hud-crystal');
    if (crystalEl) crystalEl.textContent = (u.crystals || 0);

    const balls = u.balls;
    const ballKey = [balls.afkball, balls.pokeball, balls.superball, balls.hyperball, balls.masterball].join(',');
    if (ballKey !== refreshHud._lastBallKey) {
      refreshHud._lastBallKey = ballKey;
      const html = ['afkball','pokeball','superball','hyperball','masterball'].map(id => {
        const b = GameData.BALL_BY_ID[id];
        const count = id === 'afkball' ? '∞' : (balls[id] || 0);
        return '<img src="' + b.spriteUrl + '" alt="' + b.name + '" class="ball-icon-img" title="' + b.name + '" onerror="this.outerHTML=\'<span class=ball-icon-fallback>'+'⚫'+'</span>\'">' + count;
      }).join('');
      document.getElementById('hud-balls').innerHTML = html;
    }

    // Quests badge — count incomplete quests
    const qBadge = document.getElementById('quests-badge');
    if (qBadge) {
      const remaining = (Net.state.dailyQuests || []).filter(q => !q.completed).length;
      qBadge.textContent = remaining;
      qBadge.classList.toggle('hidden', remaining === 0);
    }
  }

  // ---------- Quests ----------
  function openQuests() {
    Net.fetchDailyQuests();
    renderQuests();
    open('quests-modal');
  }
  function renderQuests() {
    const list = document.getElementById('quests-list');
    if (!list) return;
    const quests = Net.state.dailyQuests || [];
    if (!quests.length) { list.innerHTML = '<div class="empty-state">Loading quests...</div>'; return; }
    list.innerHTML = quests.map(q => {
      const pct = Math.min(100, (q.progress / q.target) * 100);
      const ball = q.reward ? GameData.BALL_BY_ID[q.reward.ball] : null;
      const rewardHtml = ball ? '<img src="' + ball.spriteUrl + '" class="quest-reward-icon"> ×' + q.reward.count + ' ' + ball.name : '';
      return '<div class="quest-card ' + (q.completed ? 'completed' : '') + '">' +
        '<div class="quest-row1"><div class="quest-label">' + q.label + '</div>' +
        '<div class="quest-reward">' + rewardHtml + '</div></div>' +
        '<div class="quest-progress"><div class="quest-progress-fill" style="width:' + pct + '%"></div>' +
        '<span class="quest-progress-text">' + q.progress + ' / ' + q.target + (q.completed ? ' ✓ Done' : '') + '</span></div>' +
      '</div>';
    }).join('');
  }

  // ---------- NPC trainer battles removed (Tower-only) ----------
  let _lastBattleLogLen = 0;
  let _battleAnimating = false;
  let _lastAttacker = null;
  let _currentBattleId = null;   // npcId + start log[0] hash to detect new fights
  function openBattle() {
    _lastBattleLogLen = 0;
    _battleAnimating = false;
    _lastAttacker = null;
    open('battle-modal');
    renderBattle();
  }
  function renderBattle() {
    const b = Net.state.battle;
    if (!b) return;
    // Detect new battle (different NPC or fresh log starting from beginning)
    const battleId = b.npcId + '|' + (b.log[0] || '');
    if (battleId !== _currentBattleId) {
      _currentBattleId = battleId;
      _lastBattleLogLen = 0;
      _battleAnimating = false;
      _lastAttacker = null;
    }
    // If new log lines arrived, animate them; otherwise just sync state.
    if (b.log.length > _lastBattleLogLen && !_battleAnimating) {
      const startIdx = _lastBattleLogLen;
      _lastBattleLogLen = b.log.length;
      _renderArenaShell(b);
      _playBattleSequence(b, startIdx);
    } else {
      _renderStaticBattle(b);
    }
  }
  function _renderArenaShell(b) {
    const player = b.playerTeam[b.playerActive];
    const npc = b.npcTeam[b.npcActive];
    document.getElementById('battle-title').textContent = '⚔️ vs ' + b.npcName;
    document.getElementById('battle-npc-emoji').textContent = b.npcEmoji || '👤';
    document.getElementById('battle-npc-name').textContent = b.npcName;
    document.getElementById('battle-player-name').textContent = (Net.state.user && Net.state.user.username) || 'You';
    const dots = (team) => team.map(p => '<span class="team-dot ' + (p.fainted ? 'fainted' : 'alive') + '"></span>').join('');
    document.getElementById('battle-npc-dots').innerHTML = dots(b.npcTeam);
    document.getElementById('battle-player-dots').innerHTML = dots(b.playerTeam);
    if (npc) {
      const npcStatusBadge = npc.status ? ' <span class="status-badge status-' + npc.status + '">' + _statusLabel(npc.status) + '</span>' : '';
      document.getElementById('battle-npc-mon-name').innerHTML = npc.name + ' <span class="battle-lvl">Lv ' + npc.level + '</span>' + npcStatusBadge;
      const npcSprite = document.getElementById('battle-npc-sprite');
      if (npcSprite.src !== npc.spriteUrl) npcSprite.src = npc.spriteUrl;
      npcSprite.style.opacity = npc.fainted ? 0.3 : 1;
    }
    if (player) {
      const pStatusBadge = player.status ? ' <span class="status-badge status-' + player.status + '">' + _statusLabel(player.status) + '</span>' : '';
      document.getElementById('battle-player-mon-name').innerHTML = player.name + ' <span class="battle-lvl">Lv ' + player.level + '</span>' + pStatusBadge;
      const pSprite = document.getElementById('battle-player-sprite');
      const url = player.isShiny ? (GameData.POKEMON_BY_ID[player.speciesId].spriteShinyUrl) : player.spriteUrl;
      if (pSprite.src !== url) pSprite.src = url;
      pSprite.style.opacity = player.fainted ? 0.3 : 1;
    }
  }
  function _renderStaticBattle(b) {
    _renderArenaShell(b);
    const player = b.playerTeam[b.playerActive];
    const npc = b.npcTeam[b.npcActive];
    if (npc) _setHp('npc', npc.hp, npc.maxHp);
    if (player) _setHp('player', player.hp, player.maxHp);
    const logEl = document.getElementById('battle-log');
    logEl.innerHTML = b.log.map(line => '<div class="bl-line">' + escapeHtml(line) + '</div>').join('');
    logEl.scrollTop = logEl.scrollHeight;
    _renderMoveButtons(b);
  }
  function _setHp(side, hp, maxHp) {
    const pct = Math.max(0, hp / maxHp * 100);
    const fill = document.getElementById('battle-' + side + '-hp');
    fill.style.width = pct + '%';
    fill.style.background = hpColor(pct);
    document.getElementById('battle-' + side + '-hp-text').textContent = hp + ' / ' + maxHp;
  }
  function _renderMoveButtons(b) {
    const movesEl = document.getElementById('battle-moves');
    const player = b.playerTeam[b.playerActive];
    const endRow = document.getElementById('battle-end-row');
    if (b.over) {
      movesEl.innerHTML = '';
      endRow.classList.remove('hidden');
      const endBtn = document.getElementById('battle-end-btn');
      endBtn.textContent = b.winner === 'player' ? '🏆 Victory! Close' : '💔 Defeated. Close';
      endBtn.onclick = () => {
        close('battle-modal');
        _lastBattleLogLen = 0;
        _currentBattleId = null;
        _battleAnimating = false;
        Net.state.battle = null;  // clear so re-open isn't blocked
      };
      _showVictoryBanner(b.winner === 'player');
    } else if (player && !player.fainted) {
      endRow.classList.add('hidden');
      movesEl.innerHTML = player.moves.map(id => {
        const m = GameData.MOVE_BY_ID[id]; if (!m) return '';
        const cat = m.cat === 'physical' ? '⚔️' : (m.cat === 'special' ? '✨' : '🛡');
        const pow = m.power > 0 ? 'Pow ' + m.power : 'Status';
        return '<button class="bm-btn" data-id="' + id + '" style="border-color:' + m.color + '; --type-color:' + m.color + '">' +
          '<div class="bm-name" style="color:' + m.color + '">' + m.name + '</div>' +
          '<div class="bm-meta">' + cat + ' ' + pow + ' · ' + m.acc + '%</div></button>';
      }).join('');
      movesEl.querySelectorAll('.bm-btn').forEach(btn => {
        btn.onclick = () => {
          movesEl.querySelectorAll('.bm-btn').forEach(x => x.disabled = true);
          Net.battleMove(btn.dataset.id);
        };
      });
    }
  }
  function _appendLogLine(line) {
    const logEl = document.getElementById('battle-log');
    const div = document.createElement('div');
    div.className = 'bl-line';
    div.textContent = line;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function _floatText(side, text, kind) {
    const card = document.getElementById('battle-' + side + '-card');
    if (!card) return;
    const float = document.createElement('div');
    float.className = 'battle-float ' + (kind || '');
    float.textContent = text;
    card.appendChild(float);
    setTimeout(() => float.remove(), 1100);
  }
  function _bannerText(text, kind) {
    const arena = document.getElementById('battle-arena');
    const banner = document.createElement('div');
    banner.className = 'battle-banner ' + (kind || '');
    banner.textContent = text;
    arena.appendChild(banner);
    setTimeout(() => banner.remove(), 1300);
  }
  function _animLunge(side) {
    const sprite = document.getElementById('battle-' + side + '-sprite');
    sprite.classList.remove('attack-lunge');
    void sprite.offsetWidth; // force reflow
    sprite.classList.add('attack-lunge');
    setTimeout(() => sprite.classList.remove('attack-lunge'), 500);
  }
  function _animHit(side) {
    const card = document.getElementById('battle-' + side + '-card');
    const sprite = document.getElementById('battle-' + side + '-sprite');
    card.classList.remove('hit-shake'); void card.offsetWidth; card.classList.add('hit-shake');
    sprite.classList.remove('hit-flash'); void sprite.offsetWidth; sprite.classList.add('hit-flash');
    setTimeout(() => { card.classList.remove('hit-shake'); sprite.classList.remove('hit-flash'); }, 500);
  }
  function _animFaint(side) {
    const sprite = document.getElementById('battle-' + side + '-sprite');
    sprite.classList.add('faint-fade');
    setTimeout(() => sprite.classList.remove('faint-fade'), 800);
  }
  function _typeFlash(type) {
    const arena = document.getElementById('battle-arena');
    const move = GameData.MOVES.find(m => m.type === type);
    const color = move ? move.color : '#fff';
    const flash = document.createElement('div');
    flash.className = 'type-flash';
    flash.style.background = 'radial-gradient(circle, ' + color + '88 0%, transparent 70%)';
    arena.appendChild(flash);
    setTimeout(() => flash.remove(), 500);
  }
  function _showVictoryBanner(won) {
    if (document.querySelector('.battle-end-banner')) return;
    const arena = document.getElementById('battle-arena');
    const banner = document.createElement('div');
    banner.className = 'battle-end-banner ' + (won ? 'victory' : 'defeat');
    banner.innerHTML = won ? '🏆<br>VICTORY!' : '💔<br>DEFEATED';
    arena.appendChild(banner);
    setTimeout(() => banner.remove(), 2500);
  }
  function _playBattleSequence(b, startIdx) {
    _battleAnimating = true;
    const lines = b.log.slice(startIdx);
    const player = b.playerTeam[b.playerActive];
    const npc = b.npcTeam[b.npcActive];
    let i = 0;
    const next = () => {
      if (i >= lines.length) {
        _battleAnimating = false;
        _renderStaticBattle(b);  // final sync
        return;
      }
      const line = lines[i++];
      _appendLogLine(line);
      const delay = _animateLine(line, b);
      setTimeout(next, delay);
    };
    next();
  }
  function _animateLine(line, b) {
    let delay = 700;
    // X used Y!
    const usedMatch = line.match(/^(.+) used (.+)!$/);
    if (usedMatch) {
      const name = usedMatch[1];
      const moveName = usedMatch[2];
      const move = Object.values(GameData.MOVE_BY_ID).find(m => m.name === moveName);
      // Robust attacker side detection: check if name matches any player team member
      const isPlayer = b.playerTeam.some(p => p && p.name === name);
      _lastAttacker = isPlayer ? 'player' : 'npc';
      _animLunge(_lastAttacker);
      if (move) _typeFlash(move.type);
      return 600;
    }
    const dmgMatch = line.match(/Dealt (\d+) damage/);
    if (dmgMatch) {
      const dmg = parseInt(dmgMatch[1], 10);
      const isCrit = line.includes('CRIT');
      const target = _lastAttacker === 'player' ? 'npc' : 'player';
      const team = target === 'player' ? b.playerTeam[b.playerActive] : b.npcTeam[b.npcActive];
      _animHit(target);
      _floatText(target, '-' + dmg, isCrit ? 'crit' : 'damage');
      if (isCrit) _bannerText('CRITICAL!', 'crit');
      // Update HP bar live
      const newHp = Math.max(0, (team.hp));
      _setHp(target, newHp, team.maxHp);
      return 700;
    }
    if (line.includes('super effective')) { _bannerText('SUPER EFFECTIVE!', 'super'); return 800; }
    if (line.includes('not very effective')) { _bannerText('Not very effective…', 'weak'); return 600; }
    if (line.includes('had no effect')) { _bannerText('NO EFFECT', 'noeff'); return 600; }
    if (line.includes('missed')) {
      const target = _lastAttacker === 'player' ? 'npc' : 'player';
      _floatText(target, 'MISS', 'miss');
      return 600;
    }
    if (line.includes('fainted')) {
      // Server format: "<playerPokemon> fainted!" OR "<npcTrainer>'s <pokemon> fainted!"
      // Player line starts with one of player team names; npc line starts with the trainer's name
      const isPlayer = b.playerTeam.some(p => p && line.startsWith(p.name + ' fainted'));
      _animFaint(isPlayer ? 'player' : 'npc');
      return 1000;
    }
    if (line.startsWith('Go, ')) { return 600; }
    if (line.includes('sent out')) { return 600; }
    if (line.includes('Earned ') || line.includes('XP') || line.includes('defeated')) return 400;
    return 500;
  }
  function _statusLabel(s) {
    if (s === 'paralysis') return '⚡PAR';
    if (s === 'poisoned') return '☠PSN';
    if (s === 'badly_poisoned') return '☠TOX';
    if (s === 'burn') return '🔥BRN';
    if (s === 'sleep') return '💤SLP';
    if (s === 'freeze') return '❄FRZ';
    return '';
  }
  function hpColor(pct) {
    if (pct > 50) return 'linear-gradient(90deg, #7bed9f, #5fa55f)';
    if (pct > 20) return 'linear-gradient(90deg, #ffd166, #f0a040)';
    return 'linear-gradient(90deg, #ff6b6b, #c04040)';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------- Market / Trade House ----------
  let _marketTab = 'browse';
  let _sellingCaughtId = null;
  let _sellingCurrency = 'gold';
  function openMarket() {
    _marketTab = 'browse';
    open('market-modal');
    Net.fetchMarket();
    renderMarket();
    document.querySelectorAll('.market-tab').forEach(b => {
      b.onclick = () => {
        _marketTab = b.dataset.tab;
        document.querySelectorAll('.market-tab').forEach(x => x.classList.toggle('active', x === b));
        renderMarket();
      };
    });
  }
  function renderMarket() {
    const browseEl = document.getElementById('market-browse');
    const myEl = document.getElementById('market-my');
    const sellEl = document.getElementById('market-sell');
    if (!browseEl) return;
    browseEl.classList.toggle('hidden', _marketTab !== 'browse');
    myEl.classList.toggle('hidden', _marketTab !== 'my');
    sellEl.classList.toggle('hidden', _marketTab !== 'sell');
    const listings = Net.state.marketListings || [];
    const myId = Net.state.user && Net.state.user.id;

    if (_marketTab === 'browse') {
      const others = listings.filter(l => l.sellerId !== myId);
      browseEl.innerHTML = others.length ? others.map(l => _renderListingCard(l, false)).join('')
        : '<div class="empty-state">No listings from others yet. Be the first to sell!</div>';
      browseEl.querySelectorAll('.listing-buy-btn').forEach(btn => {
        btn.onclick = () => Net.buyListing(parseInt(btn.dataset.id, 10));
      });
    } else if (_marketTab === 'my') {
      const mine = listings.filter(l => l.sellerId === myId);
      myEl.innerHTML = mine.length ? mine.map(l => _renderListingCard(l, true)).join('')
        : '<div class="empty-state">You have no active listings. Switch to "Sell" tab to list a Pokemon.</div>';
      myEl.querySelectorAll('.listing-cancel-btn').forEach(btn => {
        btn.onclick = () => Net.cancelListing(parseInt(btn.dataset.id, 10));
      });
    } else {
      // Sell tab
      const caught = (Net.state.caught || []);
      const party = new Set((Net.state.user && Net.state.user.party) || []);
      const listed = new Set(listings.filter(l => l.sellerId === myId).map(l => l.pokemon ? l.pokemon.id : null));
      const sellable = caught.filter(c => !party.has(c.id) && !listed.has(c.id));
      if (!sellable.length) {
        sellEl.innerHTML = '<div class="empty-state">No sellable Pokemon. Remove from party first or catch more.</div>';
      } else {
        sellEl.innerHTML = '<p class="settings-desc">Click a Pokemon to list it for sale.</p>' +
          '<div class="sell-grid">' + sellable.map(inst => {
            const p = GameData.POKEMON_BY_ID[inst.pokemonId]; if (!p) return '';
            const power = Math.round(inst.ivTotal / 186 * 100);
            return '<div class="sell-cell ' + (inst.isShiny ? 'shiny' : '') + '" data-id="' + inst.id + '" style="border-color:' + p.color + '">' +
              '<img src="' + (inst.isShiny ? p.spriteShinyUrl : p.spriteUrl) + '" alt="">' +
              '<div class="sell-name">' + p.name + (inst.isShiny ? ' ✨' : '') + '</div>' +
              '<div class="sell-meta">Lv ' + (inst.level || 5) + ' · Pwr ' + power + '</div>' +
            '</div>';
          }).join('') + '</div>';
        sellEl.querySelectorAll('.sell-cell').forEach(cell => {
          cell.onclick = () => openSellForm(parseInt(cell.dataset.id, 10));
        });
      }
    }
  }
  function _renderListingCard(l, isMine) {
    const p = GameData.POKEMON_BY_ID[l.pokemon.pokemonId];
    if (!p) return '';
    const power = Math.round(l.pokemon.ivTotal / 186 * 100);
    const curIcon = l.currency === 'gold' ? '🪙' : '💎';
    return '<div class="listing-card ' + (l.pokemon.isShiny ? 'shiny' : '') + '" style="border-color:' + p.color + '">' +
      '<img class="listing-sprite" src="' + (l.pokemon.isShiny ? p.spriteShinyUrl : p.spriteUrl) + '" alt="">' +
      '<div class="listing-info">' +
        '<div class="listing-name">' + p.name + (l.pokemon.isShiny ? ' ✨' : '') + '</div>' +
        '<div class="listing-meta">Lv ' + l.pokemon.level + ' · IV ' + l.pokemon.ivTotal + '/186 · Pwr ' + power + '</div>' +
        '<div class="listing-seller">Seller: ' + escapeHtml(l.sellerName) + '</div>' +
      '</div>' +
      '<div class="listing-price">' + curIcon + ' ' + l.price + '</div>' +
      (isMine ? '<button class="listing-cancel-btn" data-id="' + l.id + '">Cancel</button>'
              : '<button class="listing-buy-btn" data-id="' + l.id + '">Buy</button>') +
    '</div>';
  }
  function openSellForm(caughtId) {
    _sellingCaughtId = caughtId;
    _sellingCurrency = 'gold';
    const inst = (Net.state.caught || []).find(c => c.id === caughtId);
    if (!inst) return;
    const p = GameData.POKEMON_BY_ID[inst.pokemonId];
    document.getElementById('sell-pokemon-info').innerHTML =
      '<div class="sell-preview" style="border-color:' + p.color + '">' +
        '<img src="' + (inst.isShiny ? p.spriteShinyUrl : p.spriteUrl) + '">' +
        '<div><div class="sell-preview-name">' + p.name + (inst.isShiny ? ' ✨' : '') + '</div>' +
        '<div class="sell-preview-meta">Lv ' + (inst.level || 5) + ' · IV ' + inst.ivTotal + '/186</div></div>' +
      '</div>';
    document.getElementById('sell-cur-gold').classList.add('active');
    document.getElementById('sell-cur-crystal').classList.remove('active');
    document.querySelectorAll('.sell-cur-btn').forEach(b => {
      b.onclick = () => {
        _sellingCurrency = b.dataset.cur;
        document.querySelectorAll('.sell-cur-btn').forEach(x => x.classList.toggle('active', x === b));
      };
    });
    document.getElementById('sell-confirm-btn').onclick = () => {
      const price = parseInt(document.getElementById('sell-price-input').value, 10);
      if (!price || price < 1) { toast('Invalid price', 'error'); return; }
      Net.listPokemon(_sellingCaughtId, _sellingCurrency, price);
      close('sell-pokemon-modal');
    };
    open('sell-pokemon-modal');
  }

  // ---------- Crystal Shop ----------
  let _paypalLoaded = false;
  let _paypalConfig = null;
  async function _ensurePaypal() {
    if (_paypalConfig) return _paypalConfig;
    try {
      const res = await fetch('/paypal/config', { credentials: 'include' });
      _paypalConfig = await res.json();
    } catch (e) { _paypalConfig = { configured: false }; }
    if (_paypalConfig.configured && !_paypalLoaded) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(_paypalConfig.clientId) + '&currency=USD&intent=capture&locale=en_US';
        s.onload = () => { _paypalLoaded = true; resolve(); };
        s.onerror = () => reject(new Error('PayPal SDK load failed'));
        document.head.appendChild(s);
      }).catch(() => {});
    }
    return _paypalConfig;
  }
  function openCrystalShop() {
    Net.fetchCrystalPackages();
    open('crystal-shop-modal');
    setTimeout(() => renderCrystalPackages(), 100);
  }
  async function renderCrystalPackages() {
    const list = document.getElementById('crystal-packages-list');
    const pkgs = Net.state.crystalPackages || [
      { id:'small', crystals:200, priceUsd:4.99, label:'Small' },
      { id:'medium', crystals:500, priceUsd:9.99, label:'Medium' },
      { id:'large', crystals:1500, priceUsd:24.99, label:'Large' },
      { id:'whale', crystals:5000, priceUsd:79.99, label:'Trainer Vault' },
    ];
    list.innerHTML = pkgs.map(p => {
      return '<div class="crystal-pkg" data-id="' + p.id + '">' +
        '<div class="pkg-icon">💎</div>' +
        '<div class="pkg-info">' +
          '<div class="pkg-name">' + p.label + '</div>' +
          '<div class="pkg-amount">' + p.crystals + ' Crystals</div>' +
          '<div class="pkg-price">$' + p.priceUsd + '</div>' +
        '</div>' +
        '<div class="paypal-btn-slot" id="paypal-btn-' + p.id + '"></div>' +
      '</div>';
    }).join('');

    const cfg = await _ensurePaypal();
    if (!cfg.configured || !window.paypal) {
      // Fallback message + admin demo button
      list.querySelectorAll('.paypal-btn-slot').forEach(slot => {
        const pid = slot.id.replace('paypal-btn-', '');
        slot.innerHTML = '<div class="paypal-not-ready">PayPal not configured on server</div>' +
          (Net.state.user && Net.state.user.username === 'admin'
            ? '<button class="pkg-buy-btn" data-id="' + pid + '">Admin: grant (demo)</button>' : '');
        const btn = slot.querySelector('.pkg-buy-btn');
        if (btn) btn.onclick = () => Net.buyCrystalsDemo(pid);
      });
      return;
    }
    // Render PayPal Smart Buttons per package
    pkgs.forEach(p => {
      const slot = document.getElementById('paypal-btn-' + p.id);
      if (!slot) return;
      window.paypal.Buttons({
        style: { layout: 'horizontal', color: 'gold', shape: 'rect', label: 'pay', height: 40, tagline: false },
        createOrder: async () => {
          const r = await fetch('/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ packageId: p.id }),
          });
          const data = await r.json();
          if (!data.ok) { toast(data.error || 'Order failed', 'error'); throw new Error(data.error); }
          return data.orderID;
        },
        onApprove: async (data) => {
          const r = await fetch('/paypal/capture-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ orderID: data.orderID }),
          });
          const result = await r.json();
          if (result.ok) {
            toast('💎 +' + result.crystalsAdded + ' Crystals!', 'success');
            refreshHud();
          } else {
            toast(result.error || 'Capture failed', 'error');
          }
        },
        onError: (err) => {
          toast('PayPal error: ' + (err && err.message || 'unknown'), 'error');
        },
      }).render(slot);
    });
  }

  // ---------- Profile / Players ----------
  let _profileTimeout = null;
  function openProfile(userId, username) {
    const c = document.getElementById('profile-content');
    if (c) c.innerHTML = '<div class="empty-state">Loading profile...</div>';
    open('profile-modal');
    // Immediately render a local fallback for OWN profile so the user always sees something
    const myUser = Net.state.user;
    if (myUser && (userId === myUser.id || username === myUser.username || (userId === undefined && username === undefined))) {
      try {
        const localProfile = {
          id: myUser.id, username: myUser.username,
          gender: myUser.gender || 'male',
          title: myUser.title || '',
          bio: myUser.bio || '',
          level: myUser.level || 1,
          totalCatches: myUser.totalCatches || (Net.state.caught ? Net.state.caught.length : 0),
          bestStreak: myUser.bestStreak || 0,
          legendaryCaught: myUser.legendaryCaught || 0,
          achievements: (myUser.achievements || []).length || 0,
          towerBestFloor: myUser.towerBestFloor || 0,
          pokedexCount: Object.keys(Net.state.pokedex || {}).length,
          party: (myUser.party || []).map(id => {
            const ci = (Net.state.caught || []).find(c => c.id === id);
            if (!ci) return null;
            return { id: ci.id, pokemonId: ci.pokemonId, level: ci.level || 5, ivTotal: ci.ivTotal || 0, isShiny: !!ci.isShiny };
          }).filter(Boolean),
          pvpWins: myUser.pvpWins || 0, pvpLosses: myUser.pvpLosses || 0,
          avatar: myUser.avatar || 'default',
          avatarSprite: myUser.avatarSprite || null,
        };
        renderProfile(localProfile);
      } catch (e) { console.warn('[profile] local fallback failed', e && e.message); }
    }
    // Still ask the server for fresh data (may overwrite the local fallback above)
    Net.requestProfile(userId, username);
    // Safety timeout — if no response in 6s and we still show Loading, fall back to error
    if (_profileTimeout) clearTimeout(_profileTimeout);
    _profileTimeout = setTimeout(() => {
      const cc = document.getElementById('profile-content');
      if (cc && cc.innerHTML.indexOf('Loading') !== -1) {
        cc.innerHTML = '<div class="empty-state">Profile request timed out. Try closing and reopening.</div>';
      }
    }, 6000);
  }
  function renderProfile(p) {
    if (_profileTimeout) { clearTimeout(_profileTimeout); _profileTimeout = null; }
    const c = document.getElementById('profile-content');
    if (!c) return;
    if (!p) { c.innerHTML = '<div class="empty-state">Player not found</div>'; return; }
    const partyHtml = p.party.length ? p.party.map(m => {
      const sp = GameData.POKEMON_BY_ID[m.pokemonId];
      if (!sp) return '';
      const power = Math.round(m.ivTotal / 186 * 100);
      return '<div class="profile-mon ' + (m.isShiny ? 'shiny' : '') + '" style="border-color:' + sp.color + '">' +
        '<img src="' + (m.isShiny ? sp.spriteShinyUrl : sp.spriteUrl) + '" alt="' + sp.name + '">' +
        '<div class="profile-mon-name">' + sp.name + '</div>' +
        '<div class="profile-mon-meta">Lv ' + m.level + ' · Pwr ' + power + (m.isShiny ? ' ✨' : '') + '</div>' +
      '</div>';
    }).join('') : '<div class="empty-state-tiny">No active party</div>';
    const avatarUrl = p.avatarSprite || ('assets/trainers/' + (p.gender || 'male') + '.png');
    const isPokemonAvatar = !!p.avatarSprite;
    c.innerHTML =
      '<div class="profile-header">' +
        '<div class="profile-avatar' + (isPokemonAvatar ? ' pokemon' : '') + '"><img src="' + avatarUrl + '" alt=""></div>' +
        '<div class="profile-id">' +
          '<div class="profile-name">' + escapeHtml(p.username) + (p.title ? ' <span class="profile-title">« ' + escapeHtml(p.title) + ' »</span>' : '') + '</div>' +
          '<div class="profile-meta-row">Lv ' + p.level + ' · ' + p.totalCatches + ' catches · ' + p.pokedexCount + '/151 dex</div>' +
          '<div class="profile-bio">' + (p.bio ? escapeHtml(p.bio) : '<i>no bio</i>') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="profile-stats">' +
        '<div class="ps"><div class="ps-l">Trainer Lv</div><div class="ps-v">' + p.level + '</div></div>' +
        '<div class="ps"><div class="ps-l">Catches</div><div class="ps-v">' + p.totalCatches + '</div></div>' +
        '<div class="ps"><div class="ps-l">Pokedex</div><div class="ps-v">' + p.pokedexCount + '/151</div></div>' +
        '<div class="ps"><div class="ps-l">Best Streak</div><div class="ps-v">' + p.bestStreak + '🔥</div></div>' +
        '<div class="ps"><div class="ps-l">Legendaries</div><div class="ps-v">' + p.legendaryCaught + '</div></div>' +
        '<div class="ps"><div class="ps-l">Tower Best</div><div class="ps-v">' + p.towerBestFloor + '</div></div>' +
        '<div class="ps"><div class="ps-l">Achievements</div><div class="ps-v">' + p.achievements + '/17</div></div>' +
        '<div class="ps"><div class="ps-l">PvP W/L</div><div class="ps-v">' + (p.pvpWins||0) + '/' + (p.pvpLosses||0) + '</div></div>' +
      '</div>' +
      // PvP challenge button (not for own profile)
      (Net.state.user && Net.state.user.id !== p.id ?
        '<button id="profile-challenge-btn" class="primary-btn" style="width:100%;margin-bottom:10px;background:linear-gradient(135deg,#e85a5a,#c04040);color:#fff;">⚔️ Challenge ' + escapeHtml(p.username) + ' to PvP</button>' : '') +
      '<h3 class="profile-section-title">⭐ Active Party</h3>' +
      '<div class="profile-party">' + partyHtml + '</div>' +
      (Net.state.user && Net.state.user.id === p.id ? '<button id="profile-edit-bio" class="secondary-btn" style="margin-top:14px;width:100%;">Edit Bio</button>' : '');
    if (Net.state.user && Net.state.user.id === p.id) {
      const btn = document.getElementById('profile-edit-bio');
      if (btn) btn.onclick = () => {
        const cur = p.bio || '';
        const next = prompt('Set your bio (max 200 chars):', cur);
        if (next !== null) {
          Net.setBio(next);
          setTimeout(() => Net.requestProfile(p.id), 200);
        }
      };
      // Make the profile avatar clickable to switch avatars (own profile only)
      const av = c.querySelector('.profile-avatar');
      if (av) {
        av.style.cursor = 'pointer';
        av.title = 'Click to switch avatar';
        av.onclick = () => openAvatarSwitcher();
      }
    } else {
      const challengeBtn = document.getElementById('profile-challenge-btn');
      if (challengeBtn) {
        // Battle system disabled — coming soon
        challengeBtn.style.display = 'none';
      }
    }
  }
  function openAvatarSwitcher() {
    open('avatar-switcher-modal');
    if (window.AvatarUI && AvatarUI.fetchCatalog) AvatarUI.fetchCatalog();
    renderAvatarSwitcher();
    const shopBtn = document.getElementById('avatar-switcher-shop-btn');
    if (shopBtn) shopBtn.onclick = () => {
      close('avatar-switcher-modal');
      openShop();
      // Auto-switch to crystal tab
      setTimeout(() => {
        const crystalTab = document.querySelector('#shop-modal .cs-tab[data-shop-tab="crystals"]');
        if (crystalTab) crystalTab.click();
      }, 50);
    };
  }
  function renderAvatarSwitcher() {
    const grid = document.getElementById('avatar-switcher-grid');
    if (!grid) return;
    const u = Net.state.user || {};
    const owned = ['default', ...(u.ownedAvatars || [])];
    const equipped = u.avatar || 'default';
    const catalog = (window.AvatarUI && AvatarUI._catalog) ? AvatarUI._catalog : [];
    // Always include "default" even if catalog is empty
    const userGenderSprite = (u.gender === 'female') ? 'assets/trainers/female.png' : 'assets/trainers/male.png';
    const ownedAvatars = owned.map(id => {
      const av = catalog.find(a => a.id === id);
      if (av) return av;
      if (id === 'default') return { id: 'default', name: 'Default Trainer', sprite: null, rarity: 'free' };
      return null;
    }).filter(Boolean);
    if (!ownedAvatars.length) {
      grid.innerHTML = '<div class="empty-state">Loading…</div>';
      return;
    }
    grid.innerHTML = ownedAvatars.map(av => {
      const isEquipped = av.id === equipped;
      const sprite = av.sprite || userGenderSprite;
      return '<div class="avatar-card switcher' + (isEquipped ? ' equipped' : '') + '" data-id="' + av.id + '">' +
        '<div class="av-image"><img src="' + sprite + '" alt="' + av.name + '" loading="lazy"></div>' +
        '<div class="av-name">' + av.name + '</div>' +
        (isEquipped ? '<button class="av-btn equipped" disabled>✓ Equipped</button>'
                    : '<button class="av-btn equip" data-id="' + av.id + '">Equip</button>') +
      '</div>';
    }).join('');
    grid.querySelectorAll('.av-btn.equip').forEach(btn => {
      btn.onclick = () => {
        Net.send('equip_avatar', { avatarId: btn.dataset.id });
      };
    });
  }
  function openPlayers() {
    document.getElementById('players-list').innerHTML = '<div class="empty-state">Loading players...</div>';
    Net.listPlayers();
    open('players-modal');
  }
  function renderPlayers(players) {
    const list = document.getElementById('players-list');
    if (!list) return;
    if (!players || !players.length) { list.innerHTML = '<div class="empty-state">No players yet</div>'; return; }
    list.innerHTML = players.map(p => {
      return '<div class="player-row" data-id="' + p.id + '">' +
        '<img class="player-avatar" src="assets/trainers/' + (p.gender || 'male') + '.png" alt="">' +
        '<div class="player-text">' +
          '<div class="player-name">' + escapeHtml(p.username) + (p.title ? ' <span class="player-title">« ' + escapeHtml(p.title) + ' »</span>' : '') + '</div>' +
          '<div class="player-meta">Lv ' + (p.level || 1) + ' · ' + (p.totalCatches || 0) + ' catches · Tower: ' + (p.towerBestFloor || 0) + '</div>' +
        '</div>' +
        '<button class="player-view-btn">View</button>' +
      '</div>';
    }).join('');
    list.querySelectorAll('.player-row').forEach(row => {
      row.onclick = () => {
        const id = parseInt(row.dataset.id, 10);
        close('players-modal');
        openProfile(id);
      };
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------- Battle Tower (DISABLED — coming soon) ----------
  function openTower() {
    open('tower-modal');
  }
  function renderTower() {
    /* no-op — Coming Soon placeholder is rendered statically in index.html */
  }

  // ---------- Eggs / Incubators ----------
  let _eggsTimer = null;
  let _selectedEggId = null;
  function openEggs() {
    Net.fetchEggData();
    renderEggs();
    open('eggs-modal');
    if (_eggsTimer) clearInterval(_eggsTimer);
    _eggsTimer = setInterval(() => {
      const m = document.getElementById('eggs-modal');
      if (!m || m.classList.contains('hidden')) { clearInterval(_eggsTimer); _eggsTimer = null; return; }
      // Just update progress bars without full re-render
      _updateEggProgress();
    }, 1000);
  }
  function _formatHatchTime(ms) {
    if (ms <= 0) return 'Ready!';
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m > 0) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    return s + 's';
  }
  function renderEggs() {
    const u = Net.state.user || {};
    const eggTiers = Net.state.eggTiers || _DEFAULT_EGG_TIERS;
    const incubatorTiers = Net.state.incubatorTiers || _DEFAULT_INCUBATOR_TIERS;
    const ownedIncs = u.incubators || [];

    // Incubators
    const incList = document.getElementById('incubators-list');
    if (incList) {
      incList.innerHTML = incubatorTiers.map(it => {
        const owned = ownedIncs.find(o => o.tier === it.tier);
        if (!owned) return '';
        return '<div class="incubator-card stars-' + it.stars + '">' +
          '<div class="incubator-header">' +
            '<span class="inc-emoji">' + it.emoji + '</span>' +
            '<span class="inc-name">' + it.name + '</span>' +
            '<span class="inc-stars">' + '⭐'.repeat(it.stars) + '</span>' +
            '<span class="inc-meta">' + it.slots + ' slots · ' + it.speedMult + '× speed</span>' +
          '</div>' +
          '<div class="inc-slots">' + owned.slots.map((slot, idx) => _renderIncSlot(slot, it.tier, idx, eggTiers)).join('') + '</div>' +
        '</div>';
      }).join('');
      _wireIncubatorSlots();
    }

    // Egg inventory
    const eggInv = document.getElementById('egg-inventory');
    const eggCount = document.getElementById('egg-inv-count');
    if (eggInv) {
      const eggs = u.eggs || [];
      if (eggCount) eggCount.textContent = eggs.length;
      if (!eggs.length) {
        eggInv.innerHTML = '<div class="empty-state-tiny">No eggs yet. Catch Pokemon, win battles, or buy them in the shop below.</div>';
      } else {
        eggInv.innerHTML = eggs.map(e => {
          const t = eggTiers[e.tier];
          if (!t) return '';
          const isSelected = _selectedEggId === e.id;
          return '<div class="egg-card stars-' + t.stars + ' ' + (isSelected ? 'selected' : '') + '" data-id="' + e.id + '" data-tier="' + e.tier + '" style="--egg-color:' + t.color + '">' +
            '<div class="egg-shape" style="background: linear-gradient(135deg, ' + t.color + ', #2a2a4a); box-shadow: 0 0 12px ' + t.color + '88;"></div>' +
            '<div class="egg-name">' + t.name + '</div>' +
            '<div class="egg-stars">' + '⭐'.repeat(t.stars) + '</div>' +
            '<div class="egg-time">' + _formatHatchTime(t.hatchMs) + '</div>' +
          '</div>';
        }).join('');
        eggInv.querySelectorAll('.egg-card').forEach(card => {
          card.onclick = () => {
            _selectedEggId = parseInt(card.dataset.id, 10);
            renderEggs();
            toast('Egg selected. Click an empty incubator slot.', 'info');
          };
        });
      }
    }

    // Shop
    const shopEl = document.getElementById('egg-shop');
    if (shopEl) {
      const eggsHtml = Object.values(eggTiers).map(t => {
        const canAfford = (u.gold || 0) >= t.shopPrice;
        return '<button class="egg-shop-btn ' + (canAfford ? '' : 'disabled') + '" data-buy-egg="' + t.id + '" ' + (canAfford ? '' : 'disabled') + ' style="--egg-color:' + t.color + '">' +
          '<div class="egg-shape-mini" style="background: linear-gradient(135deg, ' + t.color + ', #2a2a4a)"></div>' +
          '<div><div class="esh-name">' + t.name + '</div>' +
          '<div class="esh-meta">' + '⭐'.repeat(t.stars) + ' · ' + _formatHatchTime(t.hatchMs) + '</div></div>' +
          '<div class="esh-price">🪙' + t.shopPrice + '</div></button>';
      }).join('');
      const incsHtml = incubatorTiers.filter(it => it.tier > 1 && !ownedIncs.find(o => o.tier === it.tier)).map(it => {
        const canAfford = (u.gold || 0) >= it.gold;
        return '<button class="egg-shop-btn inc-buy ' + (canAfford ? '' : 'disabled') + '" data-buy-inc="' + it.tier + '" ' + (canAfford ? '' : 'disabled') + '>' +
          '<div class="esh-emoji">' + it.emoji + '</div>' +
          '<div><div class="esh-name">' + it.name + '</div>' +
          '<div class="esh-meta">' + '⭐'.repeat(it.stars) + ' · ' + it.slots + ' slots · ' + it.speedMult + '× speed</div></div>' +
          '<div class="esh-price">🪙' + it.gold + '</div></button>';
      }).join('');
      shopEl.innerHTML = '<div class="egg-shop-row">' + eggsHtml + '</div>' + (incsHtml ? '<div class="egg-shop-row" style="margin-top:6px">' + incsHtml + '</div>' : '');
      shopEl.querySelectorAll('[data-buy-egg]').forEach(btn => {
        btn.onclick = () => { if (!btn.disabled) Net.buyEgg(btn.dataset.buyEgg); };
      });
      shopEl.querySelectorAll('[data-buy-inc]').forEach(btn => {
        btn.onclick = () => { if (!btn.disabled) Net.buyIncubator(parseInt(btn.dataset.buyInc, 10)); };
      });
    }
    _updateEggsBadge();
  }
  function _renderIncSlot(slot, tier, idx, eggTiers) {
    if (!slot) {
      return '<div class="inc-slot empty" data-tier="' + tier + '" data-slot="' + idx + '">+</div>';
    }
    const t = eggTiers[slot.eggTier] || {};
    const elapsed = Date.now() - slot.startedAt;
    const remain = Math.max(0, slot.totalMs - elapsed);
    const pct = Math.min(100, elapsed / slot.totalMs * 100);
    const ready = remain <= 0;
    return '<div class="inc-slot filled ' + (ready ? 'ready' : '') + '" data-tier="' + tier + '" data-slot="' + idx + '" data-started="' + slot.startedAt + '" data-total="' + slot.totalMs + '" style="--egg-color:' + (t.color || '#cbd5f0') + '">' +
      '<div class="inc-slot-egg" style="background: linear-gradient(135deg, ' + (t.color || '#cbd5f0') + ', #2a2a4a)"></div>' +
      '<div class="inc-slot-name">' + (t.name || 'Egg') + '</div>' +
      '<div class="inc-slot-time">' + _formatHatchTime(remain) + '</div>' +
      '<div class="inc-progress"><div class="inc-progress-fill" style="width:' + pct + '%"></div></div>' +
      (ready ? '<button class="inc-hatch-btn" data-tier="' + tier + '" data-slot="' + idx + '">HATCH!</button>' : '') +
    '</div>';
  }
  function _updateEggProgress() {
    document.querySelectorAll('.inc-slot.filled').forEach(slot => {
      const started = parseInt(slot.dataset.started, 10);
      const total = parseInt(slot.dataset.total, 10);
      const elapsed = Date.now() - started;
      const remain = Math.max(0, total - elapsed);
      const pct = Math.min(100, elapsed / total * 100);
      const timeEl = slot.querySelector('.inc-slot-time');
      const fillEl = slot.querySelector('.inc-progress-fill');
      if (timeEl) timeEl.textContent = _formatHatchTime(remain);
      if (fillEl) fillEl.style.width = pct + '%';
      if (remain <= 0 && !slot.classList.contains('ready')) {
        // Egg just became ready — re-render to show HATCH button
        renderEggs();
      }
    });
    _updateEggsBadge();
  }
  function _wireIncubatorSlots() {
    document.querySelectorAll('.inc-slot.empty').forEach(slot => {
      slot.onclick = () => {
        if (!_selectedEggId) { toast('Select an egg from inventory first', 'info'); return; }
        const tier = parseInt(slot.dataset.tier, 10);
        const idx = parseInt(slot.dataset.slot, 10);
        Net.placeEgg(_selectedEggId, tier, idx);
        _selectedEggId = null;
      };
    });
    document.querySelectorAll('.inc-hatch-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const tier = parseInt(btn.dataset.tier, 10);
        const idx = parseInt(btn.dataset.slot, 10);
        Net.hatchEgg(tier, idx);
      };
    });
  }
  function _updateEggsBadge() {
    const u = Net.state.user || {};
    const eggsCount = (u.eggs || []).length;
    let readyCount = 0;
    for (const inc of (u.incubators || [])) {
      for (const slot of (inc.slots || [])) {
        if (slot && (Date.now() - slot.startedAt) >= slot.totalMs) readyCount++;
      }
    }
    const badge = document.getElementById('eggs-badge');
    if (badge) {
      const total = eggsCount + readyCount;
      badge.textContent = total;
      badge.classList.toggle('hidden', total === 0);
      if (readyCount > 0) badge.style.background = '#ffd166'; else badge.style.background = '#e94e4e';
    }
  }

  // Hatch animation
  function playHatchAnimation(hatch) {
    open('hatch-modal');
    const titleEl = document.getElementById('hatch-title');
    const textEl = document.getElementById('hatch-text');
    const eggEl = document.getElementById('hatch-egg');
    const sprite = document.getElementById('hatch-sprite');
    const btn = document.getElementById('hatch-continue');
    btn.classList.add('hidden');
    sprite.classList.add('hidden');
    sprite.classList.remove('reveal');
    eggEl.classList.remove('hidden');
    eggEl.classList.remove('crack', 'shake');
    void eggEl.offsetWidth;
    titleEl.textContent = 'An egg is hatching!';
    textEl.textContent = '';
    const tierColor = (Net.state.eggTiers && Net.state.eggTiers[hatch.eggTier]) ? Net.state.eggTiers[hatch.eggTier].color : '#cbd5f0';
    eggEl.style.background = 'linear-gradient(135deg, ' + tierColor + ', #fff)';
    eggEl.style.boxShadow = '0 0 30px ' + tierColor;
    setTimeout(() => eggEl.classList.add('shake'), 200);
    setTimeout(() => { eggEl.classList.add('crack'); }, 1500);
    setTimeout(() => {
      eggEl.classList.add('hidden');
      sprite.src = hatch.isShiny ? hatch.spriteShinyUrl : hatch.spriteUrl;
      sprite.classList.remove('hidden');
      sprite.classList.add('reveal');
      titleEl.textContent = 'Congratulations!';
      const shinyTxt = hatch.isShiny ? ' ✨' : '';
      const power = Math.round(hatch.ivTotal / 186 * 100);
      textEl.innerHTML = 'A <b style="color:#ffd166">' + hatch.name + shinyTxt + '</b> hatched from your egg!<br>IV ' + hatch.ivTotal + '/186 · Power ' + power;
    }, 2500);
    setTimeout(() => {
      btn.classList.remove('hidden');
      btn.onclick = () => {
        close('hatch-modal');
        renderEggs();
      };
    }, 3000);
  }

  const _DEFAULT_EGG_TIERS = {
    common:    { id:'common',    name:'Common Egg',    color:'#cbd5f0', stars:1, hatchMs:5*60*1000,    shopPrice:200 },
    rare:      { id:'rare',      name:'Rare Egg',      color:'#74b9ff', stars:2, hatchMs:15*60*1000,   shopPrice:800 },
    epic:      { id:'epic',      name:'Epic Egg',      color:'#a040d8', stars:3, hatchMs:30*60*1000,   shopPrice:3000 },
    legendary: { id:'legendary', name:'Legendary Egg', color:'#ffd166', stars:5, hatchMs:60*60*1000,   shopPrice:15000 },
  };
  const _DEFAULT_INCUBATOR_TIERS = [
    { tier: 1, name: 'Wood Incubator',    stars: 1, slots: 1, speedMult: 1.0, gold: 0,     emoji: '📦' },
    { tier: 2, name: 'Stone Incubator',   stars: 2, slots: 2, speedMult: 1.2, gold: 500,   emoji: '🪨' },
    { tier: 3, name: 'Iron Incubator',    stars: 3, slots: 3, speedMult: 1.5, gold: 2500,  emoji: '⚙' },
    { tier: 4, name: 'Crystal Incubator', stars: 4, slots: 4, speedMult: 2.0, gold: 7500,  emoji: '💎' },
    { tier: 5, name: 'Master Incubator',  stars: 5, slots: 6, speedMult: 3.0, gold: 25000, emoji: '👑' },
  ];

  // ---------- Pokemon Evolution Animation ----------
  let _evolutionQueue = [];
  let _evolutionPlaying = false;
  function queueEvolution(evo) {
    _evolutionQueue.push(evo);
    if (!_evolutionPlaying) playNextEvolution();
  }
  function playNextEvolution() {
    if (_evolutionQueue.length === 0) {
      _evolutionPlaying = false;
      return;
    }
    _evolutionPlaying = true;
    const evo = _evolutionQueue.shift();
    open('evolution-modal');
    const sprite = document.getElementById('evolution-sprite');
    const titleEl = document.getElementById('evolution-title');
    const textEl = document.getElementById('evolution-text');
    const btn = document.getElementById('evolution-continue');
    btn.classList.add('hidden');
    titleEl.textContent = 'What? Your ' + evo.fromName + ' is evolving!';
    textEl.textContent = '';
    sprite.src = evo.fromSprite;
    sprite.classList.remove('evolving', 'flash', 'reveal');
    void sprite.offsetWidth;
    // Phase 1: pulse with growing white silhouette
    setTimeout(() => sprite.classList.add('evolving'), 100);
    // Phase 2: bright flash + swap sprite
    setTimeout(() => {
      sprite.classList.add('flash');
      setTimeout(() => { sprite.src = evo.toSprite; }, 150);
    }, 2200);
    // Phase 3: reveal new form
    setTimeout(() => {
      sprite.classList.remove('evolving', 'flash');
      sprite.classList.add('reveal');
      titleEl.textContent = 'Congratulations!';
      textEl.innerHTML = 'Your <b>' + evo.fromName + '</b> evolved into <b style="color:#ffd166">' + evo.toName + '</b>!';
    }, 3000);
    // Show continue button
    setTimeout(() => {
      btn.classList.remove('hidden');
      btn.onclick = () => {
        close('evolution-modal');
        playNextEvolution();  // play next in queue if any
      };
    }, 3500);
  }

  // ---------- Level rewards ----------
  function levelUpReward(level) {
    if (level === 3)  return { ball: 'pokeball',   count: 5  };
    if (level === 5)  return { ball: 'superball',  count: 3  };
    if (level === 8)  return { ball: 'superball',  count: 5  };
    if (level === 10) return { ball: 'hyperball',  count: 3  };
    if (level === 15) return { ball: 'hyperball',  count: 5  };
    if (level === 20) return { ball: 'masterball', count: 1  };
    if (level === 25) return { ball: 'hyperball',  count: 10 };
    if (level === 30) return { ball: 'masterball', count: 1  };
    if (level === 40) return { ball: 'masterball', count: 2  };
    if (level === 50) return { ball: 'masterball', count: 5  };
    if (level % 2 === 0) return { ball: 'pokeball', count: 3 };
    return { ball: 'superball', count: 1 };
  }
  function openLevels() {
    const list = document.getElementById('levels-list');
    if (!list) return;
    const u = Net.state.user || {};
    const myLvl = u.level || 1;
    const milestones = new Set([3, 5, 8, 10, 15, 20, 25, 30, 40, 50]);
    let html = '';
    for (let lvl = 2; lvl <= 50; lvl++) {
      const r = levelUpReward(lvl);
      const ball = GameData.BALL_BY_ID[r.ball];
      const isMile = milestones.has(lvl);
      const reached = lvl <= myLvl;
      const xpNeeded = (lvl - 1) * 100; // XP needed to LEAVE prev level
      html += '<div class="level-row ' + (isMile ? 'milestone ' : '') + (reached ? 'reached' : '') + '">' +
        '<span class="level-num">Lv ' + lvl + (isMile ? ' ⭐' : '') + '</span>' +
        '<span class="level-xp">' + xpNeeded + ' XP</span>' +
        '<span class="level-reward">' + (ball ? '<img src="'+ball.spriteUrl+'" class="level-ball-icon">' : '') +
          '×' + r.count + ' ' + (ball ? ball.name : r.ball) + '</span>' +
        (reached ? '<span class="level-check">✓</span>' : '') +
      '</div>';
    }
    list.innerHTML = html;
    open('levels-modal');
  }

  // ---------- Shop ----------
  function openShop() {
    Net.fetchShop();
    renderShop();
    renderCrystalShop();
    open('shop-modal');
    // Wire tab switching (idempotent)
    document.querySelectorAll('#shop-modal .cs-tab').forEach(tab => {
      tab.onclick = () => {
        const target = tab.dataset.shopTab;
        document.querySelectorAll('#shop-modal .cs-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('#shop-modal .cs-panel').forEach(p => {
          p.classList.toggle('hidden', p.dataset.shopPanel !== target);
        });
        if (target === 'crystals') {
          renderCrystalShop();
          if (window.AvatarUI) AvatarUI.open();
        }
      };
    });
    // Pre-load avatar catalog so the crystal tab is instant
    if (window.AvatarUI) AvatarUI.fetchCatalog();
    // Wire "Get Crystals" link
    const link = document.getElementById('shop-buy-crystals-link');
    if (link) link.onclick = (e) => { e.preventDefault(); close('shop-modal'); openCrystalShop(); };
  }
  function renderShop() {
    const list = document.getElementById('shop-list');
    const goldEl = document.getElementById('shop-gold');
    const u = Net.state.user || {};
    const myGold = u.gold || 0;
    if (goldEl) goldEl.textContent = myGold;
    if (!list) return;
    const items = (Net.state.shopItems && Net.state.shopItems.length) ? Net.state.shopItems : [
      // Local fallback (mirrors server SHOP_ITEMS so the modal isn't empty before fetch)
      { id:'pokeball',   ball:'pokeball',   count:1, price:10,  name:'Poké Ball' },
      { id:'pokeball_5', ball:'pokeball',   count:5, price:45,  name:'Poké Ball ×5' },
      { id:'superball',  ball:'superball',  count:1, price:30,  name:'Great Ball' },
      { id:'superball_5',ball:'superball',  count:5, price:135, name:'Great Ball ×5' },
      { id:'hyperball',  ball:'hyperball',  count:1, price:75,  name:'Ultra Ball' },
      { id:'hyperball_5',ball:'hyperball',  count:5, price:340, name:'Ultra Ball ×5' },
      { id:'masterball', ball:'masterball', count:1, price:500, name:'Master Ball' },
    ];
    list.innerHTML = items.map(it => {
      const ball = GameData.BALL_BY_ID[it.ball];
      const canAfford = myGold >= it.price;
      const sprite = ball ? '<img src="' + ball.spriteUrl + '" alt="" class="shop-item-sprite">' : '';
      return '<div class="shop-card ' + (canAfford ? '' : 'disabled') + '" data-id="' + it.id + '">' +
        sprite +
        '<div class="shop-item-text"><div class="shop-item-name">' + it.name + '</div>' +
        '<div class="shop-item-desc">×' + it.count + (ball ? ' · Catch ' + (ball.catchMult >= 99 ? 'guaranteed' : '×' + ball.catchMult.toFixed(1)) : '') + '</div></div>' +
        '<button class="shop-buy-btn" data-id="' + it.id + '" ' + (canAfford ? '' : 'disabled') + '>' +
        '🪙 ' + it.price + (canAfford ? '' : ' (low)') + '</button>' +
      '</div>';
    }).join('');
    // Wire buy buttons
    list.querySelectorAll('.shop-buy-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        Net.buyItem(id);
      };
    });
  }
  function renderCrystalShop() {
    const list = document.getElementById('crystal-shop-list');
    const crystalsEl = document.getElementById('shop-crystals');
    const u = Net.state.user || {};
    const myCrystals = u.crystals || 0;
    if (crystalsEl) crystalsEl.textContent = myCrystals;
    if (!list) return;
    // Crystal-priced premium items (server-side equivalents in crystal_shop_items)
    const items = (Net.state.crystalShopItems && Net.state.crystalShopItems.length) ? Net.state.crystalShopItems : [
      { id:'c_pokeball_20',  ball:'pokeball',  count:20, price:25, name:'Poke Ball ×20',  desc:'A small premium pack.' },
      { id:'c_superball_10', ball:'superball', count:10, price:30, name:'Great Ball ×10', desc:'1.5× catch rate.' },
      { id:'c_hyperball_10', ball:'hyperball', count:10, price:50, name:'Ultra Ball ×10', desc:'2× catch rate.' },
    ];
    list.innerHTML = items.map(it => {
      const ball = GameData.BALL_BY_ID[it.ball];
      const canAfford = myCrystals >= it.price;
      const sprite = ball ? '<img src="' + ball.spriteUrl + '" alt="" class="shop-item-sprite">' : '';
      return '<div class="shop-card ' + (canAfford ? '' : 'disabled') + '" data-id="' + it.id + '">' +
        sprite +
        '<div class="shop-item-text"><div class="shop-item-name">' + it.name + '</div>' +
        '<div class="shop-item-desc">' + (it.desc || ('×' + it.count)) + '</div></div>' +
        '<button class="shop-buy-crystal-btn" data-id="' + it.id + '" ' + (canAfford ? '' : 'disabled') + '>' +
        '💎 ' + it.price + (canAfford ? '' : ' (low)') + '</button>' +
      '</div>';
    }).join('');
    list.querySelectorAll('.shop-buy-crystal-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        if (confirm('Spend ' + (items.find(i => i.id === id) || {}).price + ' crystals on this item?')) {
          Net.buyItem(id);
        }
      };
    });
  }

  // ---------- Achievements ----------
  function openAchievements() {
    renderAchievements();
    open('achievements-modal');
  }
  function renderAchievements() {
    const list = document.getElementById('achievements-list');
    if (!list) return;
    const u = Net.state.user || {};
    const unlocked = new Set(u.achievements || []);
    const ALL = [
      { id:'first_catch',   name:'First Catch',          title:'Newbie' },
      { id:'catches_10',    name:'10 Catches',           title:'Trainee' },
      { id:'catches_50',    name:'50 Catches',           title:'Hunter' },
      { id:'catches_100',   name:'100 Catches',          title:'Veteran' },
      { id:'catches_500',   name:'500 Catches',          title:'Pokemon Master' },
      { id:'first_shiny',   name:'First Shiny ✨',       title:'Sparkle' },
      { id:'first_legendary',name:'Legend Caught',       title:'Legendary Hunter' },
      { id:'streak_5',      name:'Streak 5×',            title:'On Fire' },
      { id:'streak_10',     name:'Streak 10×',           title:'Inferno' },
      { id:'streak_20',     name:'Streak 20×',           title:'Unstoppable' },
      { id:'iv_perfect',    name:'180+ IV Pokemon',      title:'Geneticist' },
      { id:'level_10',      name:'Reached Level 10',     title:'Rising Star' },
      { id:'level_25',      name:'Reached Level 25',     title:'Champion' },
      { id:'level_50',      name:'Reached Level 50',     title:'Grand Master' },
      { id:'pokedex_25',    name:'Pokedex 25/151',       title:'Collector' },
      { id:'pokedex_75',    name:'Pokedex 75/151',       title:'Cataloguer' },
      { id:'pokedex_151',   name:'Pokedex Complete',     title:'Pokedex Master' },
    ];
    list.innerHTML = ALL.map(a => {
      const got = unlocked.has(a.id);
      return '<div class="ach-card ' + (got ? 'unlocked' : 'locked') + '">' +
        '<div class="ach-icon">' + (got ? '🏅' : '🔒') + '</div>' +
        '<div class="ach-text"><div class="ach-name">' + a.name + '</div>' +
        '<div class="ach-title">Title: « ' + a.title + ' »</div></div>' +
      '</div>';
    }).join('');
  }

  // ---------- Ball Picker ----------
  function openBallPicker() {
    if (!Net.state.spawn) return;
    const p = GameData.POKEMON_BY_ID[Net.state.spawn.pokemonId];
    const ivs = Net.state.myAttempt && Net.state.myAttempt.ivs;
    const ivT = ivs ? Object.values(ivs).reduce((a,b)=>a+b,0) : 0;
    const tier = ivTier(ivs ? (ivT / 186) : 0);
    const power = ivs ? Math.round(ivT / 186 * 100) : '?';
    let ivBars = '';
    if (ivs) {
      const labels = { hp:'HP', atk:'ATK', def:'DEF', spAtk:'SpA', spDef:'SpD', spd:'SPE' };
      const order = ['hp','atk','def','spAtk','spDef','spd'];
      ivBars = '<div class="picker-ivs">' + order.map(k => {
        const v = ivs[k] || 0;
        const pct = Math.round(v/31*100);
        const cls = v === 31 ? 'perfect' : (v >= 26 ? 'high' : '');
        return '<div class="picker-iv"><span class="picker-iv-lbl">'+labels[k]+'</span>' +
          '<span class="picker-iv-bar"><span class="picker-iv-fill '+cls+'" style="width:'+pct+'%"></span></span>' +
          '<span class="picker-iv-val '+(v===31?'perfect':'')+'">'+v+'</span></div>';
      }).join('') + '</div>' +
      '<div class="picker-iv-total">IV Total: <b style="color:'+tier.color+'">'+ivT+'/186</b> · Power '+power+'</div>';
    }
    // Moves preview
    const moves = Net.state.myAttempt && Net.state.myAttempt.moves;
    let movesHtml = '';
    if (moves && moves.length) {
      movesHtml = '<div class="picker-moves-label">Moves</div><div class="picker-moves">' + moves.map(id => {
        const m = GameData.MOVE_BY_ID[id]; if (!m) return '';
        const cat = m.cat === 'physical' ? '⚔️' : (m.cat === 'special' ? '✨' : '🛡');
        return '<div class="picker-move" style="border-color:' + m.color + '">' +
          '<span class="picker-move-name" style="color:' + m.color + '">' + m.name + '</span>' +
          '<span class="picker-move-meta">' + cat + ' ' + (m.power || 'Sta') + '</span></div>';
      }).join('') + '</div>';
    }
    document.getElementById('ball-modal-title').innerHTML =
      '<div class="encounter-preview" style="background: linear-gradient(135deg, ' + p.color + '88, ' + tier.color + '88)">' +
        '<div class="prev-emoji"><img src="' + p.spriteUrl + '" alt="" onerror="this.outerHTML=\'' + p.emoji + '\'"></div>' +
        '<div><div class="prev-name">Wild ' + p.name + '</div>' +
        '<div class="prev-meta" style="color:' + tier.color + '">' + tier.name + (ivs ? '' : ' (waiting for IVs…)') + '</div></div>' +
      '</div>' + ivBars + movesHtml;
    const list = document.getElementById('ball-choice-list');
    list.innerHTML = '';
    const balls = Net.state.user.balls;
    for (const b of GameData.BALLS) {
      const isAfk = b.id === 'afkball';
      const count = balls[b.id] || 0;
      const usable = isAfk || count > 0;
      const displayCount = isAfk ? '∞' : ('×' + count);
      const cell = document.createElement('button');
      cell.className = 'ball-choice' + (usable ? '' : ' empty');
      cell.disabled = !usable;
      cell.innerHTML =
        '<img src="' + b.spriteUrl + '" alt="" class="ball-choice-sprite" onerror="this.outerHTML=\'<div class=ball-emoji-icon style=background:' + b.color + '></div>\'">' +
        '<div class="ball-info"><div class="ball-name">' + b.name + '</div>' +
        '<div class="ball-meta">' + displayCount + ' · ' + (b.catchMult >= 99 ? 'guaranteed' : 'Catch ×' + b.catchMult.toFixed(1)) + '</div></div>';
      cell.onclick = () => {
        if (!usable) return;
        Net.chooseBall(b.id);
        close('ball-modal');
      };
      list.appendChild(cell);
    }
    open('ball-modal');
  }

  // ---------- Box ----------
  function openBox() {
    renderBox();
    open('box-modal');
  }
  function renderParty() {
    const u = Net.state.user || {};
    const partyIds = u.party || [];
    const row = document.getElementById('party-row');
    const cnt = document.getElementById('party-count');
    if (cnt) cnt.textContent = partyIds.length + '/6';
    if (!row) return;
    let html = '';
    for (let i = 0; i < 6; i++) {
      const id = partyIds[i];
      if (id) {
        const inst = Net.state.caught.find(c => c.id === id);
        if (!inst) { html += '<div class="party-slot empty">+</div>'; continue; }
        const p = GameData.POKEMON_BY_ID[inst.pokemonId];
        const lvl = inst.level || 1;
        const xpNeed = lvl * 20;
        const pct = lvl >= 100 ? 100 : Math.min(100, (inst.xp || 0) / xpNeed * 100);
        html += '<div class="party-slot filled" data-id="' + inst.id + '" title="' + p.name + ' Lv ' + lvl + '">' +
          '<img src="' + (inst.isShiny ? p.spriteShinyUrl : p.spriteUrl) + '" alt="">' +
          '<div class="party-lvl">Lv ' + lvl + '</div>' +
          '<div class="party-xp"><div class="party-xp-fill" style="width:' + pct + '%"></div></div>' +
          (inst.isShiny ? '<div class="party-shiny">✨</div>' : '') +
        '</div>';
      } else {
        html += '<div class="party-slot empty">+</div>';
      }
    }
    row.innerHTML = html;
    // Click party slots to show details
    row.querySelectorAll('.party-slot.filled').forEach(slot => {
      slot.onclick = () => {
        const id = parseInt(slot.dataset.id, 10);
        const inst = Net.state.caught.find(c => c.id === id);
        if (inst) showDetail(inst);
      };
    });
  }

  function renderBox() {
    renderParty();
    const list = [...Net.state.caught];
    if (boxSort === 'date')  list.sort((a,b)=>b.caughtAt - a.caughtAt);
    if (boxSort === 'iv')    list.sort((a,b)=>b.ivTotal - a.ivTotal);
    if (boxSort === 'name')  list.sort((a,b)=>GameData.POKEMON_BY_ID[a.pokemonId].name.localeCompare(GameData.POKEMON_BY_ID[b.pokemonId].name));
    if (boxSort === 'shiny') list.sort((a,b)=>(b.isShiny?1:0)-(a.isShiny?1:0));
    if (boxSort === 'level') list.sort((a,b)=>(b.level||0) - (a.level||0));
    document.getElementById('box-count').textContent =
      list.length + ' caught · ' + list.filter(c=>c.isShiny).length + ' shinies';
    const grid = document.getElementById('box-grid');
    grid.innerHTML = '';
    if (list.length === 0) {
      grid.innerHTML = '<div class="empty-state">No Pokemon caught yet. Wait for the next spawn!</div>';
    } else {
      const u = Net.state.user || {};
      const partySet = new Set(u.party || []);
      const frag = document.createDocumentFragment();
      const instMap = {};
      for (const inst of list) {
        const p = GameData.POKEMON_BY_ID[inst.pokemonId];
        const tier = ivTier(inst.ivTotal / 186);
        const power = Math.round(inst.ivTotal / 186 * 100);
        const lvl = inst.level || 1;
        const inParty = partySet.has(inst.id);
        const cell = document.createElement('div');
        cell.className = 'box-cell' + (inst.isShiny ? ' shiny' : '') + (inParty ? ' in-party' : '');
        cell.dataset.instId = inst.id;
        cell.style.setProperty('--accent', tier.color);
        cell.innerHTML =
          '<div class="box-emoji"><img src="' + (inst.isShiny ? p.spriteShinyUrl : p.spriteUrl) + '" alt="" loading="lazy" onerror="this.outerHTML=\'' + p.emoji + '\'">' + (inst.isShiny ? '<span class="shiny-mark">✨</span>' : '') + '</div>' +
          '<div class="box-lvl">Lv ' + lvl + '</div>' +
          '<div class="box-name">' + p.name + '</div>' +
          '<div class="box-power" style="color:' + tier.color + '">' + '★'.repeat(tier.stars) + '☆'.repeat(5 - tier.stars) + ' ' + power + '</div>' +
          '<div class="box-tier">' + tier.name + '</div>' +
          (inst.upgrades ? '<div class="box-upgrade-badge">+' + inst.upgrades + '</div>' : '') +
          (inParty ? '<div class="box-party-mark">★ Party</div>' : '');
        frag.appendChild(cell);
        instMap[inst.id] = inst;
      }
      grid.appendChild(frag);
      // Event delegation instead of per-cell onclick
      grid.onclick = (e) => {
        const cell = e.target.closest('.box-cell');
        if (cell && cell.dataset.instId) {
          const inst = instMap[cell.dataset.instId];
          if (inst) showDetail(inst);
        }
      };
    }
    document.querySelectorAll('.box-sort-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sort === boxSort);
      b.onclick = () => { boxSort = b.dataset.sort; renderBox(); };
    });
  }

  function showDetail(inst) {
    const p = GameData.POKEMON_BY_ID[inst.pokemonId];
    const tier = ivTier(inst.ivTotal / 186);
    const power = Math.round(inst.ivTotal / 186 * 100);
    const ball = GameData.BALL_BY_ID[inst.ball];
    const labels = { hp:'HP', atk:'ATK', def:'DEF', spAtk:'SpA', spDef:'SpD', spd:'SPE' };
    const maxIv = 31 + (inst.upgrades || 0) * 2;
    let bars = '';
    for (const k of Object.keys(labels)) {
      const v = inst.ivs[k]; const pct = Math.min(100, v/maxIv*100);
      const c = v>=28?'#ffd166':v>=20?'#7bed9f':v>=12?'#74b9ff':'#a4b0be';
      bars += '<div class="stat-row"><span class="stat-label">' + labels[k] + '</span>' +
              '<div class="stat-bar"><div class="stat-fill" style="width:' + pct + '%;background:' + c + '"></div></div>' +
              '<span class="stat-val">' + v + '</span></div>';
    }
    document.getElementById('detail-content').innerHTML =
      '<div class="detail-header" style="background: linear-gradient(135deg, ' + p.color + '55, ' + tier.color + '55)">' +
        '<div class="detail-emoji"><img src="' + (inst.isShiny ? p.spriteShinyUrl : p.spriteUrl) + '" alt="" onerror="this.outerHTML=\'' + p.emoji + '\'"></div>' +
        '<div><div class="detail-name">' + p.name + (inst.isShiny ? ' (Shiny)' : '') + '</div>' +
        '<div class="detail-meta">' + '★'.repeat(p.rarity) + ' · ' + p.type + '</div>' +
        '<div class="detail-tier" style="color:' + tier.color + '">' + tier.name + ' · Power ' + power + '</div></div></div>' +
      // Level + XP bar
      (function(){
        const lvl = inst.level || 1;
        const max = 100;
        const xpNeed = lvl * 5;
        const xp = inst.xp || 0;
        const pct = lvl >= max ? 100 : Math.min(100, xp/xpNeed*100);
        const u = Net.state.user || {};
        const inParty = (u.party || []).includes(inst.id);
        const partyFull = (u.party || []).length >= 6 && !inParty;
        return '<div class="detail-section">' +
          '<h3>Level <span style="color:#7bed9f">' + lvl + '</span> / ' + max + '</h3>' +
          '<div class="poke-xp-bar"><div class="poke-xp-fill" style="width:' + pct + '%"></div>' +
          '<span class="poke-xp-text">' + (lvl >= max ? 'MAX' : xp + ' / ' + xpNeed + ' XP') + '</span></div>' +
          '<p class="poke-xp-hint">' + (inParty ? 'In your party — gains +1 XP per catch attempt.' : 'Add to your party to earn XP from every catch.') + '</p>' +
          '<div class="detail-action-row">' +
            '<button class="party-btn ' + (inParty ? 'in-party' : '') + '" data-id="' + inst.id + '" ' + (partyFull ? 'disabled' : '') + '>' +
              (inParty ? '✓ In Party (click to remove)' : (partyFull ? 'Party Full (6/6)' : '+ Add to Party')) +
            '</button>' +
          '</div>' +
        '</div>';
      })() +
      // Upgrade section
      (function(){
        const UPGRADE_COSTS = [500, 1500, 3000, 6000, 12000];
        const upgrades = inst.upgrades || 0;
        const maxUpgrade = 5;
        const filledStars = '★'.repeat(upgrades);
        const emptyStars = '☆'.repeat(maxUpgrade - upgrades);
        const u = Net.state.user || {};
        // Count eligible duplicates: same species, not shiny, not in party, not the target itself
        const partySet = new Set(u.party || []);
        const dupes = Net.state.caught.filter(c =>
          c.pokemonId === inst.pokemonId && c.id !== inst.id && !c.isShiny && !partySet.has(c.id)
        );
        const cost = upgrades < maxUpgrade ? UPGRADE_COSTS[upgrades] : 0;
        const canAfford = (u.gold || 0) >= cost;
        const hasMaterial = dupes.length > 0;
        if (upgrades >= maxUpgrade) {
          return '<div class="detail-section upgrade-section">' +
            '<h3>Upgrade Level</h3>' +
            '<div class="upgrade-stars max">' + filledStars + ' MAX</div>' +
            '<div class="upgrade-status">This Pokemon is fully upgraded!</div>' +
          '</div>';
        }
        return '<div class="detail-section upgrade-section">' +
          '<h3>Upgrade Level</h3>' +
          '<div class="upgrade-stars">+' + upgrades + ' ' + filledStars + emptyStars + '</div>' +
          '<div class="upgrade-info">' +
            '<div class="info-row"><span>Next upgrade cost</span><b style="color:#ffd166">' + cost + ' Gold</b></div>' +
            '<div class="info-row"><span>Eligible duplicates</span><b style="color:' + (hasMaterial ? '#7bed9f' : '#ff6b6b') + '">' + dupes.length + ' available</b></div>' +
          '</div>' +
          '<button class="upgrade-btn" id="detail-upgrade-btn" ' + (!canAfford || !hasMaterial ? 'disabled' : '') + '>' +
            (!hasMaterial ? 'No duplicate available' : !canAfford ? 'Not enough Gold (' + cost + ' needed)' : 'Upgrade +' + (upgrades + 1) + ' for ' + cost + ' Gold') +
          '</button>' +
        '</div>';
      })() +
      '<div class="detail-section"><h3>IVs (' + inst.ivTotal + '/' + (186 + (inst.upgrades || 0) * 12) + ')</h3>' + bars + '</div>' +
      (inst.moves && inst.moves.length ?
        '<div class="detail-section"><h3>Moves</h3><div class="detail-moves">' + inst.moves.map(id => {
          const m = GameData.MOVE_BY_ID[id]; if (!m) return '';
          const cat = m.cat === 'physical' ? '⚔️ Physical' : (m.cat === 'special' ? '✨ Special' : '🛡 Status');
          const pow = m.power > 0 ? ('Power ' + m.power) : '—';
          return '<div class="detail-move" style="border-color:' + m.color + '">' +
            '<div class="detail-move-row1"><b style="color:' + m.color + '">' + m.name + '</b><span class="detail-move-type" style="background:' + m.color + '">' + m.type + '</span></div>' +
            '<div class="detail-move-row2">' + cat + ' · ' + pow + ' · Acc ' + m.acc + '%</div>' +
          '</div>';
        }).join('') + '</div></div>' : '') +
      '<div class="detail-section"><h3>Catch Info</h3>' +
      '<div class="info-row"><span>Ball</span><b>' + (ball ? ball.name : '?') + '</b></div>' +
      '<div class="info-row"><span>Date</span><b>' + new Date(inst.caughtAt).toLocaleString() + '</b></div></div>' +
      '<button class="secondary-btn" id="detail-sell-btn" data-id="' + inst.id + '" style="width:100%;margin-top:8px;background:linear-gradient(135deg,#a050d8,#6a2090);color:#fff;">🏪 List on Trade House</button>' +
      (function(){
        var pokemon = GameData.POKEMON_BY_ID[inst.pokemonId];
        var rarity = pokemon ? pokemon.rarity : 1;
        var SELL_BASE = { 1: 5, 2: 15, 3: 30, 4: 75, 5: 150 };
        var base = SELL_BASE[rarity] || 5;
        var lvlBonus = inst.level || 1;
        var sellPrice = Math.floor((base + lvlBonus) * (inst.isShiny ? 2 : 1));
        return '<button class="secondary-btn" id="detail-sell-gold-btn" data-id="' + inst.id + '" style="width:100%;margin-top:6px;background:linear-gradient(135deg,#d4a017,#8b6914);color:#fff;">💰 Sell for ' + sellPrice + ' Gold</button>';
      })();
    document.getElementById('detail-share-btn').onclick = () => {
      Net.chat('/show ' + inst.id);
      close('detail-modal');
    };
    const sellBtn = document.getElementById('detail-sell-btn');
    if (sellBtn) sellBtn.onclick = () => {
      const u = Net.state.user || {};
      if ((u.party || []).includes(inst.id)) {
        toast('Remove from party first', 'error');
        return;
      }
      close('detail-modal');
      openSellForm(inst.id);
    };
    // Sell for gold button
    const sellGoldBtn = document.getElementById('detail-sell-gold-btn');
    if (sellGoldBtn) sellGoldBtn.onclick = () => {
      const u = Net.state.user || {};
      if ((u.party || []).includes(inst.id)) {
        toast('Remove from party first', 'error');
        return;
      }
      const pokemon = GameData.POKEMON_BY_ID[inst.pokemonId];
      const name = pokemon ? pokemon.name : 'this Pokemon';
      if (!confirm('Sell ' + name + (inst.isShiny ? ' (Shiny)' : '') + ' for gold? This cannot be undone!')) return;
      sellGoldBtn.disabled = true;
      sellGoldBtn.textContent = 'Selling...';
      Net.sellPokemon(inst.id);
    };
    // Party button only (no gold-training — XP comes from catches and battles)
    const partyBtn = document.querySelector('.party-btn');
    if (partyBtn) partyBtn.onclick = () => {
      const u = Net.state.user || {};
      let party = [...(u.party || [])];
      if (party.includes(inst.id)) {
        party = party.filter(id => id !== inst.id);
        toast(GameData.POKEMON_BY_ID[inst.pokemonId].name + ' removed from party', 'info');
      } else if (party.length < 6) {
        party.push(inst.id);
        toast(GameData.POKEMON_BY_ID[inst.pokemonId].name + ' added to party', 'success');
      } else {
        toast('Party is full (6/6)', 'error');
        return;
      }
      Net.setParty(party);
    };
    // Upgrade button
    const upgradeBtn = document.getElementById('detail-upgrade-btn');
    if (upgradeBtn) upgradeBtn.onclick = () => {
      const u = Net.state.user || {};
      const partySet = new Set(u.party || []);
      const dupes = Net.state.caught.filter(c =>
        c.pokemonId === inst.pokemonId && c.id !== inst.id && !c.isShiny && !partySet.has(c.id)
      );
      if (dupes.length === 0) { toast('No eligible duplicate available', 'error'); return; }
      // Pick the lowest IV duplicate as material
      const material = dupes.sort((a, b) => a.ivTotal - b.ivTotal)[0];
      upgradeBtn.disabled = true;
      upgradeBtn.textContent = 'Upgrading...';
      Net.upgradePokemon(inst.id, material.id);
    };
    open('detail-modal');
  }

  // ---------- Pokedex ----------
  function openPokedex() {
    const grid = document.getElementById('pokedex-grid');
    grid.innerHTML = '';
    let discovered = 0;
    for (const p of GameData.POKEDEX) {
      const cnt = Net.state.pokedex[p.id] || 0;
      const caught = cnt > 0;
      if (caught) discovered++;
      const cell = document.createElement('div');
      cell.className = 'pokedex-cell' + (caught ? ' caught' : ' unknown');
      cell.style.setProperty('--accent', p.color);
      const img = caught
        ? '<img src="' + p.spriteUrl + '" alt="" loading="lazy" onerror="this.outerHTML=\'' + p.emoji + '\'">'
        : '<img src="' + p.spriteUrl + '" alt="" loading="lazy" class="silhouette" onerror="this.outerHTML=\'?\'">';
      cell.innerHTML = '<div class="pokedex-emoji">' + img + '</div>' +
        '<div class="pokedex-name">#' + String(p.dex).padStart(3,'0') + ' ' + (caught ? p.name : '???') + '</div>' +
        '<div class="pokedex-meta">' + (caught ? '★'.repeat(p.rarity) + ' · ×' + cnt : '★'.repeat(p.rarity)) + '</div>';
      grid.appendChild(cell);
    }
    document.getElementById('pokedex-progress').textContent = discovered + ' / ' + GameData.POKEDEX.length + ' discovered';
    open('pokedex-modal');
  }

  // ---------- Leaderboards ----------
  let lbTab = 'catches';
  let lbBoards = null;
  function openLeaderboards() {
    Net.fetchLeaderboards();
    open('leaderboard-modal');
  }
  function setLeaderboards(boards) {
    lbBoards = boards;
    renderLeaderboard();
  }
  function renderLeaderboard() {
    if (!lbBoards) return;
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';
    const data = lbBoards[lbTab] || [];
    if (data.length === 0) {
      list.innerHTML = '<div class="empty-state">No entries yet. Be the first!</div>';
    } else {
      for (const e of data) {
        const cell = document.createElement('div');
        cell.className = 'lb-row' + (e.rank <= 3 ? ' top' : '');
        const valLabel = lbTab === 'catches' ? (e.value + ' catches')
                       : lbTab === 'ivBest' ? ('IV ' + e.value + ' (' + (e.pokemonName || '?') + ')')
                       : (e.value + ' species');
        cell.innerHTML = '<span class="lb-rank">#' + e.rank + '</span><span class="lb-name">' + e.username + '</span><span class="lb-val">' + valLabel + '</span>';
        list.appendChild(cell);
      }
    }
    document.querySelectorAll('.lb-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.lb === lbTab);
      t.onclick = () => { lbTab = t.dataset.lb; renderLeaderboard(); };
    });
  }

  // ---------- Settings ----------
  function openInfo() {
    const balls = GameData.BALLS.map(b => {
      const mult = b.catchMult >= 99 ? 'guaranteed' : 'x' + b.catchMult.toFixed(1);
      const note = b.id === 'afkball' ? ' (unlimited, low chance)' : '';
      return '<tr><td><b style="color:' + b.color + '">' + b.name + '</b>' + note + '</td><td>' + mult + '</td></tr>';
    }).join('');
    const examples = [
      ['Caterpie (★)', 0.55],
      ['Pikachu (★★★)', 0.32],
      ['Charmander (★★★★)', 0.20],
      ['Mewtwo (★★★★★)', 0.04],
    ];
    const exampleRows = examples.map(([name, base]) => {
      // Approx: average IVs (50%) → ivMod ~ 0.93. Per-roll cap 0.99.
      const ivMod = 1 / 1.075;
      const fmt = (mult) => {
        const per = Math.min(0.99, base * mult * ivMod);
        return Math.round(Math.pow(per, 2) * 100) + '%';
      };
      return '<tr><td><b>' + name + '</b></td><td>' + fmt(0.9) + '</td><td>' + fmt(1.5) + '</td><td>' + fmt(2.5) + '</td><td>' + fmt(4.0) + '</td></tr>';
    }).join('');
    document.getElementById('info-content').innerHTML =
      '<div class="detail-section">' +
        '<h3>Catch formula</h3>' +
        '<p style="font-family:monospace;background:#1a1a2e;padding:10px;border-radius:6px;color:#ffd166;">' +
          'final = pokemon.catchRate × ball.catchMult × ivMod' +
        '</p>' +
        '<p style="color:#cbd5f0;font-size:13px;">' +
          'Then <b>2 random rolls</b> are made. If <b>both</b> succeed (each with chance = final), the Pokémon is caught.<br>' +
          '<b>ivMod</b> = 1 / (1 + ivPercent × 0.15) → ranges from 1.0 (all 0 IVs) down to ~0.87 (all 31 IVs).<br>' +
          'Higher IVs = stronger Pokémon = slightly harder to catch (but mostly worth it!).<br>' +
          'final is capped at 0.99.' +
        '</p>' +
      '</div>' +
      '<div class="detail-section">' +
        '<h3>Ball multipliers</h3>' +
        '<table style="width:100%;font-size:13px;color:#fff;"><thead><tr style="color:#ffd166;"><th align="left">Ball</th><th align="left">Multiplier</th></tr></thead><tbody>' + balls + '</tbody></table>' +
      '</div>' +
      '<div class="detail-section">' +
        '<h3>Per-roll chance examples (avg IVs)</h3>' +
        '<table style="width:100%;font-size:12px;color:#fff;"><thead><tr style="color:#ffd166;"><th align="left">Pokémon</th><th>AFK</th><th>Poké</th><th>Great</th><th>Ultra</th></tr></thead><tbody>' + exampleRows + '</tbody></table>' +
        '<p style="color:#aab;font-size:11px;margin-top:8px;">Final catch chance ≈ shown × shown × shown × shown (4 rolls). E.g. Pidgey AFK = 27%⁴ ≈ 0.5% per spawn. With Master Ball: always 100%.</p>' +
      '</div>';
    open('info-modal');
  }

  function openSettings() {
    open('settings-modal');
  }

  // ---------- Offline summary ----------
  function showOfflineResults(results) {
    const el = document.getElementById('offline-summary');
    const caught = results.filter(r => r.caught);
    let html = '<p class="offline-intro">' + caught.length + ' / ' + results.length + ' AFK throws were successful.</p>';
    html += '<div class="offline-grid">';
    for (const r of results) {
      const p = GameData.POKEMON_BY_ID[r.pokemonId];
      const ivT = r.ivs.hp+r.ivs.atk+r.ivs.def+r.ivs.spAtk+r.ivs.spDef+r.ivs.spd;
      html += '<div class="offline-cell ' + (r.caught ? 'caught' : 'failed') + '">' +
        '<img src="' + (r.isShiny ? p.spriteShinyUrl : p.spriteUrl) + '" alt="" onerror="this.outerHTML=\'' + p.emoji + '\'">' +
        '<div><b>' + p.name + '</b><br>' + (r.caught ? '✓ caught' : '✗ broke free') + ' · IV ' + ivT + '</div></div>';
    }
    html += '</div>';
    el.innerHTML = html;
    open('offline-modal');
  }

  // ---------- Toasts ----------
  function toast(text, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.textContent = text;
    document.getElementById('toast-stack').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3500);
  }

  function ivTier(p) {
    if (p >= 0.95) return { name: 'Perfect',   color: '#ffd166', stars: 5 };
    if (p >= 0.80) return { name: 'Excellent', color: '#ff9f43', stars: 4 };
    if (p >= 0.60) return { name: 'Great',     color: '#7bed9f', stars: 3 };
    if (p >= 0.40) return { name: 'Decent',    color: '#74b9ff', stars: 2 };
    if (p >= 0.20) return { name: 'Weak',      color: '#a4b0be', stars: 1 };
    return                 { name: 'Pathetic', color: '#636e72', stars: 0 };
  }

  // ============ Admin Panel ============
  let _adminLogs = [];
  let _adminPlayers = [];
  let _adminLogTimer = null;

  function isAdmin() { return Net.state.user && Net.state.user.username === 'admin'; }

  function initAdminPanel() {
    // Tab switching
    document.querySelectorAll('.admin-tab').forEach(tab => {
      tab.onclick = () => {
        const target = tab.dataset.tab;
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.admin-panel').forEach(p => {
          p.classList.toggle('hidden', p.dataset.panel !== target);
        });
        if (target === 'dashboard') { Net.adminGetStats(); Net.adminGetOnline(); }
        if (target === 'players' || target === 'gift') Net.adminGetPlayers();
        if (target === 'logs') Net.adminGetLogs();
        if (target === 'bugs') Net.adminGetBugs();
        if (target === 'feedback') Net.adminGetFeedback();
        if (target === 'crystalaudit') Net.adminGetCrystalAudit();
        if (target === 'cheatflags') Net.adminGetCheatFlags();
      };
    });
    document.getElementById('admin-log-refresh').onclick = () => Net.adminGetLogs();
    document.getElementById('admin-log-filter').addEventListener('input', renderAdminLogs);
    document.getElementById('admin-log-type').addEventListener('change', renderAdminLogs);
    document.getElementById('admin-log-auto').addEventListener('change', _toggleAdminAutoRefresh);
    document.getElementById('admin-player-refresh').onclick = () => Net.adminGetPlayers();
    document.getElementById('admin-player-filter').addEventListener('input', renderAdminPlayers);
    document.getElementById('admin-gift-send').onclick = () => {
      const userId = parseInt(document.getElementById('admin-gift-user').value, 10);
      const giftType = document.getElementById('admin-gift-type').value;
      const amount = parseInt(document.getElementById('admin-gift-amount').value, 10);
      const r = document.getElementById('admin-gift-result');
      if (!Number.isFinite(userId)) { r.textContent = '❌ Pick a recipient'; r.style.color = '#ff6b6b'; return; }
      if (!Number.isFinite(amount) || amount < 1) { r.textContent = '❌ Invalid amount'; r.style.color = '#ff6b6b'; return; }
      Net.adminSendGift(userId, giftType, amount);
      r.textContent = 'Sending…'; r.style.color = '#cbd5f0';
    };
    _initAdminPlayerDetail();

    // Wire net events
    Net.on('admin_logs', logs => { _adminLogs = logs; renderAdminLogs(); });
    Net.on('admin_players', players => { _adminPlayers = players; renderAdminPlayers(); _populateGiftDropdown(); });
    Net.on('admin_result', msg => {
      if (msg.action === 'banned') { toast('🔨 Banned', 'success'); Net.adminGetPlayers(); Net.adminGetLogs(); }
      else if (msg.action === 'unbanned') { toast('✓ Unbanned', 'success'); Net.adminGetPlayers(); Net.adminGetLogs(); }
      else if (msg.action === 'gifted') {
        const r = document.getElementById('admin-gift-result');
        if (r) { r.textContent = '✓ Sent ' + msg.amount + ' ' + msg.giftType; r.style.color = '#4ade80'; }
        Net.adminGetLogs();
      }
      else if (msg.action === 'maintenance') {
        const s = document.getElementById('admin-maint-status');
        if (s) { s.textContent = msg.enabled ? '✓ Maintenance ON' : '✓ Maintenance OFF'; s.style.color = msg.enabled ? '#ff6b6b' : '#4ade80'; }
        toast(msg.enabled ? '🔧 Maintenance ON' : '🔧 Maintenance OFF', 'success');
      }
      else if (msg.action === 'reset') { toast('⚠️ Player reset', 'success'); Net.adminGetPlayers(); Net.adminGetLogs(); }
      else if (msg.action === 'set_level') { toast('📈 Level set to ' + msg.level, 'success'); if (_pdPlayer) Net.adminGetPlayerDetail(_pdPlayer.id); }
      else if (msg.action === 'leaderboard_wiped') { toast('🗑️ Leaderboard stats wiped', 'success'); if (_pdPlayer) Net.adminGetPlayerDetail(_pdPlayer.id); }
      else if (msg.action === 'chat_deleted') { toast('🗑️ Chat deleted', 'success'); }
      else if (msg.action === 'force_update') { toast('🔄 Update pushed to all players', 'success'); Net.adminGetLogs(); }
      else if (!msg.ok) {
        toast('❌ ' + (msg.reason || 'Admin action failed'), 'error');
        const r = document.getElementById('admin-gift-result');
        if (r) { r.textContent = '❌ ' + (msg.reason || 'Failed'); r.style.color = '#ff6b6b'; }
      }
    });
    Net.on('admin_gift_received', msg => {
      toast('🎁 Admin sent you ' + msg.amount + ' ' + msg.giftType + '!', 'success');
    });
    Net.on('banned', msg => {
      const reason = msg && msg.reason ? '\n\nReason: ' + msg.reason : '';
      alert('You have been banned from the server.' + reason);
      localStorage.removeItem('mmoToken');
      location.reload();
    });
    Net.on('maintenance', msg => {
      alert(msg.message || 'Server is under maintenance. Please come back soon.');
      localStorage.removeItem('mmoToken');
      location.reload();
    });
    Net.on('force_reload', msg => {
      alert(msg.reason || 'Your session has been ended by an administrator.');
      localStorage.removeItem('mmoToken');
      location.reload();
    });
    Net.on('version_update', msg => {
      _showUpdateBanner(msg.reason || 'A new update is available!');
    });
    Net.on('chat_deleted', msg => {
      // Remove chat message from local state
      Net.state.chat = (Net.state.chat || []).filter(m => m.id !== msg.chatId);
      const chatList = document.getElementById('chat-messages');
      if (chatList) {
        const row = chatList.querySelector('[data-chat-id="' + msg.chatId + '"]');
        if (row) row.remove();
      }
    });
    Net.on('admin_stats', renderAdminDashboard);
    Net.on('admin_online', renderAdminOnline);

    // Maintenance tab
    const maintSave = document.getElementById('admin-maint-save');
    if (maintSave) {
      maintSave.onclick = () => {
        const enabled = document.getElementById('admin-maint-enabled').checked;
        const message = (document.getElementById('admin-maint-message').value || '').trim();
        Net.adminMaintenance(enabled, message);
      };
    }
    // Push Update button
    const pushUpdateBtn = document.getElementById('admin-push-update');
    if (pushUpdateBtn) {
      pushUpdateBtn.onclick = () => {
        const reason = (document.getElementById('admin-update-reason').value || '').trim();
        if (!confirm('This will force ALL players to reload. Continue?')) return;
        Net.adminForceUpdate(reason);
        const status = document.getElementById('admin-update-status');
        if (status) { status.textContent = 'Update pushed to all players!'; status.style.color = '#4fc3f7'; }
      };
    }
  }
  function openAdmin() {
    if (!isAdmin()) return;
    open('admin-modal');
    Net.adminGetStats();
    Net.adminGetOnline();
    Net.adminGetLogs();
    Net.adminGetPlayers();
    _toggleAdminAutoRefresh();
  }
  function _toggleAdminAutoRefresh() {
    const cb = document.getElementById('admin-log-auto');
    if (_adminLogTimer) { clearInterval(_adminLogTimer); _adminLogTimer = null; }
    if (cb && cb.checked) {
      _adminLogTimer = setInterval(() => {
        const modal = document.getElementById('admin-modal');
        if (!modal || modal.classList.contains('hidden')) {
          clearInterval(_adminLogTimer); _adminLogTimer = null; return;
        }
        // Only refresh if logs tab is active
        const logsPanel = document.querySelector('.admin-panel[data-panel="logs"]');
        if (logsPanel && !logsPanel.classList.contains('hidden')) Net.adminGetLogs();
      }, 3000);
    }
  }
  function _logTypeColor(type) {
    if (type.startsWith('admin_')) return '#ffd166';
    if (type === 'login' || type === 'register' || type === 'connect') return '#7bed9f';
    if (type === 'logout') return '#a4b0be';
    if (type === 'login_fail' || type === 'register_fail' || type === 'banned') return '#ff6b6b';
    if (type === 'catch') return '#74b9ff';
    if (type === 'catch_fail') return '#ff9f43';
    if (type === 'chat') return '#ffd166';
    if (type.startsWith('market_') || type === 'crystals_buy' || type === 'shop_buy') return '#e056fd';
    if (type === 'tower_start' || type === 'pvp_start') return '#ff6b6b';
    if (type.startsWith('boss_')) return '#ff4444';
    return '#cbd5f0';
  }
  function _formatLogTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function renderAdminLogs() {
    const list = document.getElementById('admin-logs-list');
    if (!list) return;
    const filterText = (document.getElementById('admin-log-filter').value || '').trim().toLowerCase();
    const filterType = document.getElementById('admin-log-type').value;
    const filtered = _adminLogs.filter(l => {
      if (filterType && l.type !== filterType) return false;
      if (!filterText) return true;
      return (l.username || '').toLowerCase().includes(filterText) ||
             (l.details || '').toLowerCase().includes(filterText) ||
             l.type.toLowerCase().includes(filterText);
    });
    if (!filtered.length) { list.innerHTML = '<div class="empty-state">No log entries.</div>'; return; }
    // Newest first
    list.innerHTML = filtered.slice().reverse().map(l => {
      const color = _logTypeColor(l.type);
      const usr = l.username ? '<b style="color:#fff">' + escapeHtml(l.username) + '</b>' : '<span style="color:#777">[system]</span>';
      const det = l.details ? ' — ' + escapeHtml(l.details) : '';
      return '<div class="admin-log-row">' +
        '<span class="admin-log-time">' + _formatLogTime(l.t) + '</span>' +
        '<span class="admin-log-type" style="color:' + color + '">' + l.type + '</span>' +
        '<span class="admin-log-user">' + usr + '</span>' +
        '<span class="admin-log-det">' + det + '</span>' +
      '</div>';
    }).join('');
  }
  function renderAdminPlayers() {
    const list = document.getElementById('admin-players-list');
    if (!list) return;
    const filterText = (document.getElementById('admin-player-filter').value || '').trim().toLowerCase();
    const filtered = _adminPlayers.filter(p =>
      !filterText || p.username.toLowerCase().includes(filterText)
    );
    filtered.sort((a, b) => (b.online?1:0) - (a.online?1:0) || (b.level - a.level));
    if (!filtered.length) { list.innerHTML = '<div class="empty-state">No players.</div>'; return; }
    list.innerHTML = filtered.map(p => {
      const onlineDot = p.online ? '<span class="player-dot online" title="Online"></span>' : '<span class="player-dot offline" title="Offline"></span>';
      const banBadge = p.banned ? '<span class="ban-badge" title="Banned: ' + escapeHtml(p.bannedReason) + '">BANNED</span>' : '';
      const lastSeen = p.lastSeen ? new Date(p.lastSeen).toLocaleString() : '—';
      const balls = p.balls;
      return '<div class="admin-player-row clickable" data-detail-id="' + p.id + '">' +
        '<div class="admin-player-main">' + onlineDot + '<b>' + escapeHtml(p.username) + '</b>' + banBadge + ' <span class="player-meta">Lv ' + p.level + (p.title ? ' · ' + escapeHtml(p.title) : '') + '</span></div>' +
        '<div class="admin-player-stats">' +
          '🪙' + p.gold + ' · 💎' + p.crystals + ' · 🎯' + p.totalCatches +
          ' · 🗼Best ' + p.towerBestFloor + ' · ⚔' + p.pvpWins + 'W/' + p.pvpLosses + 'L' +
        '</div>' +
        '<div class="admin-player-balls">⚪' + balls.pokeball + ' 🔵' + balls.superball + ' 🟡' + balls.hyperball + ' 🟣' + balls.masterball + ' 🟢' + balls.afkball + '</div>' +
        '<div class="admin-player-meta">Last: ' + lastSeen + '</div>' +
        '<div class="admin-player-actions">' +
          (p.banned
            ? '<button class="secondary-btn small" data-action="unban" data-id="' + p.id + '">✓ Unban</button>'
            : '<button class="ban-btn small" data-action="ban" data-id="' + p.id + '" data-name="' + escapeHtml(p.username) + '">🔨 Ban</button>') +
          ' <button class="secondary-btn small" data-action="gift" data-id="' + p.id + '" data-name="' + escapeHtml(p.username) + '">🎁 Gift</button>' +
        '</div>' +
      '</div>';
    }).join('');
    list.querySelectorAll('button[data-action]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const name = btn.dataset.name || '';
        const action = btn.dataset.action;
        if (action === 'ban') {
          const reason = prompt('Ban reason for ' + name + ':', '');
          if (reason === null) return;
          Net.adminBanUser(id, reason);
        } else if (action === 'unban') {
          Net.adminUnbanUser(id);
        } else if (action === 'gift') {
          document.querySelector('.admin-tab[data-tab="gift"]').click();
          const sel = document.getElementById('admin-gift-user');
          sel.value = String(id);
        }
      };
    });
    // Row click → open player detail
    list.querySelectorAll('.admin-player-row.clickable').forEach(row => {
      row.onclick = () => {
        const id = parseInt(row.dataset.detailId, 10);
        if (Number.isFinite(id)) openAdminPlayerDetail(id);
      };
    });
  }

  // ============ Admin Player Detail ============
  let _pdPlayer = null;
  let _pdLogs = [];
  function openAdminPlayerDetail(userId) {
    if (!isAdmin()) return;
    _pdPlayer = null; _pdLogs = [];
    document.getElementById('admin-pd-header').innerHTML = '<div class="empty-state">Loading…</div>';
    document.getElementById('admin-pd-stats').innerHTML = '';
    document.getElementById('admin-pd-logs').innerHTML = '';
    open('admin-player-detail-modal');
    Net.adminGetPlayerDetail(userId);
  }
  function _renderAdminPlayerDetail() {
    if (!_pdPlayer) return;
    const p = _pdPlayer;
    const onlineDot = p.online ? '<span class="player-dot online"></span>' : '<span class="player-dot offline"></span>';
    const banBadge = p.banned ? '<span class="ban-badge" title="' + escapeHtml(p.bannedReason) + '">BANNED</span>' : '';
    document.getElementById('admin-pd-header').innerHTML =
      '<h2>' + onlineDot + ' ' + escapeHtml(p.username) + ' ' + banBadge + '</h2>' +
      (p.title ? '<div class="profile-title">« ' + escapeHtml(p.title) + ' »</div>' : '') +
      (p.bio ? '<p class="settings-desc">' + escapeHtml(p.bio) + '</p>' : '');
    const created = p.createdAt ? new Date(p.createdAt).toLocaleString() : '—';
    const lastSeen = p.lastSeen ? new Date(p.lastSeen).toLocaleString() : '—';
    const counts = p.actionCounts || {};
    document.getElementById('admin-pd-stats').innerHTML =
      '<div class="pd-stats-grid">' +
        '<div><b>Lv</b> ' + p.level + '</div>' +
        '<div><b>🪙 Gold</b> ' + p.gold + '</div>' +
        '<div><b>💎 Crystals</b> ' + p.crystals + ' <span class="pd-sub">(bought ' + (p.totalCrystalsBought || 0) + ')</span></div>' +
        '<div><b>🎯 Catches</b> ' + p.totalCatches + ' <span class="pd-sub">/ ' + p.totalThrows + ' throws</span></div>' +
        '<div><b>🌟 Legendaries</b> ' + p.legendaryCaught + '</div>' +
        '<div><b>📦 Box</b> ' + p.caughtCount + ' Pokemon</div>' +
        '<div><b>🗼 Tower Best</b> ' + p.towerBestFloor + '</div>' +
        '<div><b>⚔ PvP</b> ' + p.pvpWins + 'W / ' + p.pvpLosses + 'L</div>' +
        '<div><b>Bälle</b> ⚪' + p.balls.pokeball + ' 🔵' + p.balls.superball + ' 🟡' + p.balls.hyperball + ' 🟣' + p.balls.masterball + ' 🟢' + p.balls.afkball + '</div>' +
        '<div><b>Created</b> ' + (p.createdAt ? new Date(p.createdAt).toLocaleString() : '—') + '</div>' +
        '<div><b>Last seen</b> ' + (p.lastSeen ? new Date(p.lastSeen).toLocaleString() : '—') + '</div>' +
        '<div><b>Actions logged</b> ' + Object.keys(p.actionCounts || {}).length + ' types</div>' +
      '</div>' +
      (p.banned ? '<div class="pd-ban-notice">🔨 BANNED: ' + escapeHtml(p.bannedReason || '(no reason)') + '</div>' : '');
    document.getElementById('admin-pd-ban').classList.toggle('hidden', p.banned);
    document.getElementById('admin-pd-unban').classList.toggle('hidden', !p.banned);
    _renderAdminPdLogs();
  }
  function _renderAdminPdLogs() {
    const list = document.getElementById('admin-pd-logs');
    if (!list) return;
    const filterText = (document.getElementById('admin-pd-filter').value || '').trim().toLowerCase();
    const filterType = document.getElementById('admin-pd-type').value;
    const filtered = _pdLogs.filter(l => {
      if (filterType && l.type !== filterType) return false;
      if (!filterText) return true;
      return (l.details || '').toLowerCase().includes(filterText) || l.type.toLowerCase().includes(filterText);
    });
    if (!filtered.length) { list.innerHTML = '<div class="empty-state">No log entries.</div>'; return; }
    list.innerHTML = filtered.slice().reverse().map(l => {
      const color = _logTypeColor(l.type);
      const det = l.details ? ' — ' + escapeHtml(l.details) : '';
      return '<div class="admin-log-row">' +
        '<span class="admin-log-type" style="color:' + color + '">' + l.type + '</span>' +
        '<span class="admin-log-det" style="grid-column: 3 / span 2;">' + det + '</span>' +
      '</div>';
    }).join('');
  }
  function _initAdminPlayerDetail() {
    document.getElementById('admin-pd-filter').addEventListener('input', _renderAdminPdLogs);
    document.getElementById('admin-pd-type').addEventListener('change', _renderAdminPdLogs);
    document.getElementById('admin-pd-gift').onclick = () => {
      if (!_pdPlayer) return;
      close('admin-player-detail-modal');
      open('admin-modal');
      document.querySelector('.admin-tab[data-tab="gift"]').click();
      document.getElementById('admin-gift-user').value = String(_pdPlayer.id);
    };
    document.getElementById('admin-pd-ban').onclick = () => {
      if (!_pdPlayer) return;
      const reason = prompt('Ban reason for ' + _pdPlayer.username + ':', '');
      if (reason === null) return;
      Net.adminBanUser(_pdPlayer.id, reason);
    };
    document.getElementById('admin-pd-unban').onclick = () => {
      if (!_pdPlayer) return;
      Net.adminUnbanUser(_pdPlayer.id);
    };
    const closeBtn = document.querySelector('#admin-player-detail-modal .modal-close');
    if (closeBtn) closeBtn.onclick = () => close('admin-player-detail-modal');
    Net.on('admin_player_detail', (msg) => {
      _pdPlayer = msg.player;
      _pdLogs = msg.logs || [];
      _renderAdminPlayerDetail();
    });
    const searchBtn = document.getElementById('admin-global-search-btn');
    const searchInp = document.getElementById('admin-global-search');
    function doSearch() {
      const q = (searchInp.value || '').trim().toLowerCase();
      if (!q) return;
      const match = _adminPlayers.find(p => p.username.toLowerCase() === q) ||
                    _adminPlayers.find(p => p.username.toLowerCase().startsWith(q)) ||
                    _adminPlayers.find(p => p.username.toLowerCase().includes(q));
      if (match) openAdminPlayerDetail(match.id);
      else toast('No player matches "' + q + '"', 'error');
    }
    if (searchBtn) searchBtn.onclick = doSearch;
    if (searchInp) searchInp.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

    // New player detail buttons
    document.getElementById('admin-pd-set-level').onclick = () => {
      if (!_pdPlayer) return;
      const lvl = prompt('Set level for ' + _pdPlayer.username + ' (1-50):', String(_pdPlayer.level || 1));
      if (lvl === null) return;
      const n = parseInt(lvl, 10);
      if (!Number.isFinite(n) || n < 1 || n > 50) { toast('Level must be 1-50', 'error'); return; }
      Net.adminSetLevel(_pdPlayer.id, n);
    };
    document.getElementById('admin-pd-reset').onclick = () => {
      if (!_pdPlayer) return;
      if (!confirm('Are you sure you want to RESET ' + _pdPlayer.username + '? This deletes all Pokemon, gold, crystals, and progress. This cannot be undone!')) return;
      Net.adminResetPlayer(_pdPlayer.id);
      close('admin-player-detail-modal');
    };
    document.getElementById('admin-pd-wipe-lb').onclick = () => {
      if (!_pdPlayer) return;
      if (!confirm('Wipe all leaderboard stats for ' + _pdPlayer.username + '? (catches, streak, tower, pvp)')) return;
      Net.adminWipeLeaderboard(_pdPlayer.id);
    };
  }

  // ============ Bug Report & Feedback ============
  let _feedbackRating = 0;

  function openBugReport() {
    document.getElementById('bugReportOverlay').classList.add('active');
    const info = document.getElementById('bugReportInfo');
    if (info && Net.state.user) info.textContent = 'Logged in as: ' + Net.state.user.username;
  }
  function closeBugReport() { document.getElementById('bugReportOverlay').classList.remove('active'); }

  function submitBugReport() {
    const text = (document.getElementById('bugReportText').value || '').trim();
    if (!text || text.length < 10) { toast('Please describe the bug in more detail (min 10 chars).', 'error'); return; }
    Net.submitBugReport(text);
  }

  function openFeedback() {
    document.getElementById('feedbackOverlay').classList.add('active');
    const info = document.getElementById('feedbackInfo');
    if (info && Net.state.user) info.textContent = 'Logged in as: ' + Net.state.user.username;
    setFeedbackRating(0);
  }
  function closeFeedback() { document.getElementById('feedbackOverlay').classList.remove('active'); }

  function setFeedbackRating(n) {
    _feedbackRating = n;
    document.querySelectorAll('#feedbackStars span').forEach(function(s, i) {
      s.classList.toggle('active', i < n);
    });
  }

  function submitFeedback() {
    const text = (document.getElementById('feedbackText').value || '').trim();
    if (!text || text.length < 5) { toast('Please write at least a short message.', 'error'); return; }
    if (_feedbackRating === 0) { toast('Please select a star rating.', 'error'); return; }
    Net.submitFeedback(text, _feedbackRating);
  }

  // Wire up star clicks via event delegation
  (function() {
    const stars = document.getElementById('feedbackStars');
    if (stars) stars.addEventListener('click', function(e) {
      const s = e.target.closest('[data-star]');
      if (s) setFeedbackRating(parseInt(s.dataset.star));
    });
    const bugBtn = document.getElementById('bugReportSubmitBtn');
    if (bugBtn) bugBtn.addEventListener('click', submitBugReport);
    const fbBtn = document.getElementById('feedbackSubmitBtn');
    if (fbBtn) fbBtn.addEventListener('click', submitFeedback);
  })();

  // Result handlers
  Net.on('bug_report_result', function(msg) {
    if (msg.ok) {
      toast('Bug report submitted! Thank you!', 'success');
      document.getElementById('bugReportText').value = '';
      closeBugReport();
    } else {
      toast(msg.reason || 'Failed to submit bug report.', 'error');
    }
  });
  Net.on('feedback_result', function(msg) {
    if (msg.ok) {
      toast('Feedback sent! Thank you!', 'success');
      document.getElementById('feedbackText').value = '';
      _feedbackRating = 0;
      closeFeedback();
    } else {
      toast(msg.reason || 'Failed to send feedback.', 'error');
    }
  });

  // Admin: render bug reports
  function renderAdminBugs(reports) {
    const el = document.getElementById('admin-bugs-list');
    if (!el) return;
    if (!reports || reports.length === 0) {
      el.innerHTML = '<div class="empty-state">No bug reports yet.</div>';
      return;
    }
    el.innerHTML = reports.map(function(r) {
      var date = new Date(r.createdAt).toLocaleString();
      return '<div class="admin-report-card">'
        + '<div class="admin-report-header">'
        + '<span class="admin-report-user" style="color:#f87171">' + r.username + '</span>'
        + '<span class="admin-report-date">' + date + '</span>'
        + '</div>'
        + '<div class="admin-report-body">' + (r.message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>'
        + '</div>';
    }).join('');
  }

  // Admin: render feedback
  function renderAdminFeedback(entries) {
    var el = document.getElementById('admin-feedback-list');
    if (!el) return;
    if (!entries || entries.length === 0) {
      el.innerHTML = '<div class="empty-state">No feedback yet.</div>';
      return;
    }
    el.innerHTML = entries.map(function(f) {
      var date = new Date(f.createdAt).toLocaleString();
      var stars = '';
      for (var i = 0; i < 5; i++) stars += i < f.rating ? '⭐' : '☆';
      return '<div class="admin-report-card">'
        + '<div class="admin-report-header">'
        + '<span class="admin-report-user">' + f.username + '</span>'
        + '<span class="admin-report-date">' + date + '</span>'
        + '</div>'
        + '<div class="admin-report-stars">' + stars + '</div>'
        + '<div class="admin-report-body">' + (f.message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>'
        + '</div>';
    }).join('');
  }

  Net.on('admin_bugs', renderAdminBugs);
  Net.on('admin_feedback', renderAdminFeedback);

  // Admin: render cheat flags
  function renderAdminCheatFlags(flags) {
    var el = document.getElementById('admin-cheatflags-list');
    if (!el) return;
    if (!flags || flags.length === 0) {
      el.innerHTML = '<div class="empty-state">No cheat flags recorded.</div>';
      return;
    }
    el.innerHTML = flags.map(function(f) {
      var date = new Date(f.ts).toLocaleString();
      return '<div class="admin-report-card">'
        + '<div class="admin-report-header">'
        + '<span class="admin-report-user" style="color:#ff6b6b">' + (f.username || 'id:' + f.userId) + '</span>'
        + '<span class="admin-report-date">' + date + '</span>'
        + '</div>'
        + '<div style="margin-bottom:4px"><span style="background:#2d1b1b;color:#ff6b6b;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600">' + (f.type || 'unknown') + '</span></div>'
        + '<div class="admin-report-body">' + (f.detail || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>'
        + '</div>';
    }).join('');
  }
  Net.on('admin_cheat_flags', renderAdminCheatFlags);

  // Admin: render crystal audit trail
  function renderAdminCrystalAudit(entries) {
    var el = document.getElementById('admin-crystal-audit-list');
    if (!el) return;
    if (!entries || entries.length === 0) {
      el.innerHTML = '<div class="empty-state">No crystal transactions yet.</div>';
      return;
    }
    el.innerHTML = entries.slice().reverse().map(function(e) {
      var date = new Date(e.t).toLocaleString();
      var extra = e.extra || {};
      var balanceInfo = '';
      if (extra.balanceBefore != null && extra.balanceAfter != null) {
        balanceInfo = '<div style="margin-top:4px;font-size:0.75rem;color:#ffd700">💎 Balance: ' + extra.balanceBefore + ' → ' + extra.balanceAfter + '</div>';
      }
      var typeColor = e.type === 'crystals_buy' ? '#4ade80' : e.type === 'shop_buy' ? '#ff6b6b' : '#60a5fa';
      var typeLabel = e.type.replace(/_/g, ' ');
      return '<div class="admin-report-card">'
        + '<div class="admin-report-header">'
        + '<span class="admin-report-user">' + (e.username || 'System') + '</span>'
        + '<span class="admin-report-date">' + date + '</span>'
        + '</div>'
        + '<div style="margin-bottom:4px"><span style="background:rgba(255,255,255,0.1);color:' + typeColor + ';padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600">' + typeLabel + '</span></div>'
        + '<div class="admin-report-body">' + (e.details || '').replace(/</g, '&lt;') + '</div>'
        + balanceInfo
        + '</div>';
    }).join('');
  }
  Net.on('admin_crystal_audit', renderAdminCrystalAudit);

  // ============ Version Update Banner ============
  function _showUpdateBanner(reason) {
    // Don't show if already visible
    if (document.getElementById('update-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;text-align:center;padding:18px 20px;font-size:16px;box-shadow:0 4px 20px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;gap:14px;';
    const icon = document.createElement('span');
    icon.textContent = '🔄';
    icon.style.fontSize = '24px';
    const text = document.createElement('span');
    text.textContent = reason;
    const btn = document.createElement('button');
    btn.textContent = 'Update Now';
    btn.style.cssText = 'background:#4fc3f7;color:#000;border:none;padding:8px 20px;border-radius:6px;font-weight:bold;cursor:pointer;font-size:14px;';
    btn.onclick = () => {
      localStorage.removeItem('mmoToken');
      location.reload();
    };
    const countdown = document.createElement('span');
    countdown.style.cssText = 'font-size:13px;opacity:0.7;';
    let sec = 10;
    countdown.textContent = '(auto-reload in ' + sec + 's)';
    banner.appendChild(icon);
    banner.appendChild(text);
    banner.appendChild(btn);
    banner.appendChild(countdown);
    document.body.appendChild(banner);
    const timer = setInterval(() => {
      sec--;
      countdown.textContent = '(auto-reload in ' + sec + 's)';
      if (sec <= 0) {
        clearInterval(timer);
        localStorage.removeItem('mmoToken');
        location.reload();
      }
    }, 1000);
  }

  function _populateGiftDropdown() {
    const sel = document.getElementById('admin-gift-user');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Select a player…</option>';
    const sorted = [..._adminPlayers].sort((a, b) => a.username.localeCompare(b.username));
    for (const p of sorted) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.username + ' (Lv ' + p.level + ')';
      sel.appendChild(opt);
    }
    if (current) sel.value = current;
  }

  function renderAdminDashboard(stats) {
    const grid = document.getElementById('admin-stats-grid');
    if (!grid) return;
    grid.innerHTML =
      '<div class="admin-stat-card"><div class="stat-val">' + stats.totalPlayers + '</div><div class="stat-label">Total Players</div></div>' +
      '<div class="admin-stat-card online"><div class="stat-val">' + stats.onlinePlayers + '</div><div class="stat-label">Online Now</div></div>' +
      '<div class="admin-stat-card"><div class="stat-val">' + stats.totalPokemon + '</div><div class="stat-label">Total Pokemon</div></div>' +
      '<div class="admin-stat-card"><div class="stat-val">' + stats.totalCatches + '</div><div class="stat-label">Total Catches</div></div>' +
      '<div class="admin-stat-card"><div class="stat-val">' + (stats.totalGold || 0).toLocaleString() + '</div><div class="stat-label">Gold in Economy</div></div>' +
      '<div class="admin-stat-card"><div class="stat-val">' + (stats.totalCrystals || 0).toLocaleString() + '</div><div class="stat-label">Crystals in Economy</div></div>' +
      '<div class="admin-stat-card' + (stats.bannedPlayers > 0 ? ' banned' : '') + '"><div class="stat-val">' + stats.bannedPlayers + '</div><div class="stat-label">Banned</div></div>' +
      '<div class="admin-stat-card' + (stats.maintenanceMode ? ' maint-on' : '') + '"><div class="stat-val">' + (stats.maintenanceMode ? 'ON' : 'OFF') + '</div><div class="stat-label">Maintenance</div></div>';
    // Sync the maintenance tab checkbox
    var cb = document.getElementById('admin-maint-enabled');
    if (cb) cb.checked = stats.maintenanceMode;
    var inp = document.getElementById('admin-maint-message');
    if (inp && stats.maintenanceMessage) inp.value = stats.maintenanceMessage;
  }

  function renderAdminOnline(players) {
    var list = document.getElementById('admin-online-list');
    if (!list) return;
    if (!players.length) { list.innerHTML = '<div class="empty-state">Nobody is online.</div>'; return; }
    list.innerHTML = players.map(function(p) {
      return '<div class="admin-online-row"><span class="player-dot online"></span> <b>' + escapeHtml(p.username) + '</b> <span class="player-meta">(ID: ' + p.id + ')</span></div>';
    }).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  // ---------- World Boss UI ----------
  let _bossTimerInterval = null;

  function _buildDropTableHtml() {
    return '<div class="boss-drop-table">' +
      '<div class="boss-drop-title">Drop Table</div>' +
      '<div class="boss-drop-grid">' +
        '<div class="boss-drop-item"><span class="boss-drop-icon">&#x1f947;</span><span class="boss-drop-label">#1 Damage</span><span class="boss-drop-value">3x Ultra Ball</span></div>' +
        '<div class="boss-drop-item"><span class="boss-drop-icon">&#x1f948;</span><span class="boss-drop-label">#2 Damage</span><span class="boss-drop-value">3x Great Ball</span></div>' +
        '<div class="boss-drop-item"><span class="boss-drop-icon">&#x1f949;</span><span class="boss-drop-label">#3 Damage</span><span class="boss-drop-value">3x Poke Ball</span></div>' +
        '<div class="boss-drop-item"><span class="boss-drop-icon">&#x1f4b0;</span><span class="boss-drop-label">All Raiders</span><span class="boss-drop-value">20 Gold</span></div>' +
        '<div class="boss-drop-item"><span class="boss-drop-icon">&#x2b50;</span><span class="boss-drop-label">All Raiders</span><span class="boss-drop-value">5 XP / Pokemon</span></div>' +
        '<div class="boss-drop-item"><span class="boss-drop-icon">&#x1f95a;</span><span class="boss-drop-label">10% Chance</span><span class="boss-drop-value">Epic Egg</span></div>' +
      '</div>' +
    '</div>';
  }

  function _buildLeaderboardHtml(leaderboard) {
    if (!leaderboard || !leaderboard.length) return '<div class="boss-lb-empty">No participants yet.</div>';
    var html = '';
    for (var i = 0; i < leaderboard.length; i++) {
      var p = leaderboard[i];
      var medal = i === 0 ? '&#x1f947;' : i === 1 ? '&#x1f948;' : i === 2 ? '&#x1f949;' : '#' + (i + 1);
      var barW = leaderboard[0].damage > 0 ? Math.max(5, (p.damage / leaderboard[0].damage) * 100) : 5;
      html += '<div class="boss-lb-row">' +
        '<span class="boss-lb-rank">' + medal + '</span>' +
        '<span class="boss-lb-name">' + escapeHtml(p.username) + '</span>' +
        '<div class="boss-lb-bar-wrap"><div class="boss-lb-bar" style="width:' + barW + '%;background:' + (i === 0 ? '#ffd166' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#4a6fa5') + '"></div></div>' +
        '<span class="boss-lb-dmg">' + p.damage.toLocaleString() + '</span>' +
      '</div>';
    }
    return html;
  }

  function initBoss() {
    var bb = document.getElementById('boss-btn');
    if (bb) bb.onclick = openBoss;
    var ab = document.getElementById('boss-attack-btn');
    if (ab) ab.onclick = function () { Net.bossAttack(); ab.disabled = true; ab.textContent = 'Attacking...'; };
  }

  function updateBossButton() {
    var bb = document.getElementById('boss-btn');
    var badge = document.getElementById('boss-badge');
    if (!bb) return;
    // Boss button is ALWAYS visible
    bb.classList.remove('hidden');
    var bs = Net.state.bossState;
    if (bs && bs.active) {
      if (badge) { badge.classList.remove('boss-badge-sleep'); badge.classList.add('boss-badge-glow'); }
      if (badge && !Net.state.bossAttacked) { badge.classList.remove('hidden'); badge.textContent = '!'; }
      else if (badge) badge.classList.add('hidden');
    } else {
      // Sleeping state: show zzz badge
      if (badge) { badge.classList.remove('hidden'); badge.textContent = 'zzz'; badge.classList.remove('boss-badge-glow'); badge.classList.add('boss-badge-sleep'); }
    }
  }

  function showBossBanner(bossName) {
    var banner = document.getElementById('boss-banner');
    var sub = document.getElementById('boss-banner-sub');
    if (!banner) return;
    if (sub) sub.textContent = bossName + ' appeared! Send your party to deal damage!';
    banner.classList.remove('hidden');
    setTimeout(function () { banner.classList.add('hidden'); }, 8000);
  }

  function openBoss() {
    open('boss-modal');
    renderBoss();
    _startBossTimer();
  }

  function _startBossTimer() {
    if (_bossTimerInterval) clearInterval(_bossTimerInterval);
    _bossTimerInterval = setInterval(function () {
      var bs = Net.state.bossState;
      if (!bs) return;
      var timerEl = document.getElementById('boss-timer');
      if (!timerEl) return;

      if (bs.active) {
        // Active boss countdown
        var remain = Math.max(0, bs.endsAt - Date.now());
        if (remain <= 0) { timerEl.innerHTML = '<span style="color:#ff6b6b">Time expired!</span>'; return; }
        var m = Math.floor(remain / 60000);
        var s = Math.floor((remain % 60000) / 1000);
        var urgency = remain < 60000 ? ' style="color:#ff6b6b;font-weight:bold"' : remain < 180000 ? ' style="color:#ffd166"' : '';
        timerEl.innerHTML = '<span' + urgency + '>Raid ends in ' + m + ':' + String(s).padStart(2, '0') + '</span>';
      } else {
        // Sleeping: countdown to next spawn
        var nextAt = bs.nextSpawnAt;
        if (!nextAt) { timerEl.innerHTML = '<span style="color:#aaa">Next boss: soon...</span>'; return; }
        var remain = Math.max(0, nextAt - Date.now());
        if (remain <= 0) { timerEl.innerHTML = '<span style="color:#7bed9f">Spawning soon...</span>'; return; }
        var m = Math.floor(remain / 60000);
        var s = Math.floor((remain % 60000) / 1000);
        timerEl.innerHTML = '<span style="color:#88aaff">Next Boss in ' + m + ':' + String(s).padStart(2, '0') + '</span>';
      }
    }, 1000);
  }

  function renderBoss() {
    var bs = Net.state.bossState;
    var panel = document.getElementById('boss-panel');
    var empty = document.getElementById('boss-empty');

    if (!bs || !bs.active) {
      // --- SLEEPING STATE ---
      if (panel) panel.classList.add('hidden');
      if (empty) empty.classList.remove('hidden');

      var html = '<div class="boss-sleeping">';
      html += '<div class="boss-sleeping-icon"><span class="boss-zzz">Z<span>Z</span><span>Z</span></span></div>';
      html += '<div class="boss-sleeping-title">Boss is Sleeping...</div>';

      // Next spawn timer
      html += '<div id="boss-timer" class="boss-timer" style="margin:12px 0">';
      if (bs && bs.nextSpawnAt) {
        var remain = Math.max(0, bs.nextSpawnAt - Date.now());
        if (remain <= 0) {
          html += '<span style="color:#7bed9f">Spawning soon...</span>';
        } else {
          var m = Math.floor(remain / 60000);
          var s = Math.floor((remain % 60000) / 1000);
          html += '<span style="color:#88aaff">Next Boss in ' + m + ':' + String(s).padStart(2, '0') + '</span>';
        }
      } else {
        html += '<span style="color:#aaa">Next boss: soon...</span>';
      }
      html += '</div>';

      // Drop table
      html += _buildDropTableHtml();

      // Last boss leaderboard
      if (bs && bs.lastLeaderboard && bs.lastLeaderboard.length) {
        html += '<div class="boss-leaderboard-section" style="margin-top:16px">';
        html += '<h3 style="color:#aaa;margin:0 0 8px">Last Raid Leaderboard' + (bs.lastBossName ? ' (' + escapeHtml(bs.lastBossName) + ')' : '') + '</h3>';
        html += '<div class="boss-leaderboard">' + _buildLeaderboardHtml(bs.lastLeaderboard) + '</div>';
        html += '</div>';
      }

      html += '</div>';
      if (empty) empty.innerHTML = html;
      return;
    }

    // --- ACTIVE STATE ---
    if (panel) panel.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');

    var species = GameData.POKEMON_BY_ID[bs.pokemonId];
    var typeColor = species ? (species.color || '#888') : '#888';

    // Boss info
    var infoEl = document.getElementById('boss-info');
    if (infoEl) {
      var spriteHtml = species && species.spriteUrl ? '<img class="boss-sprite" src="' + species.spriteUrl + '" alt="' + bs.name + '">' : '<div style="font-size:64px">' + (species ? species.emoji : '') + '</div>';
      infoEl.innerHTML = '<div class="boss-info-top">' +
        '<div class="boss-sprite-wrap">' + spriteHtml + '</div>' +
        '<div class="boss-info-details">' +
          '<div class="boss-name">' + escapeHtml(bs.name) + '</div>' +
          '<div class="boss-meta-row">' +
            '<span class="boss-type-badge" style="background:' + typeColor + '">' + (species ? species.type : '') + '</span>' +
            '<span class="boss-level-badge">Lv ' + bs.level + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // Timer
    var timerEl = document.getElementById('boss-timer');
    if (timerEl) {
      var remain = Math.max(0, bs.endsAt - Date.now());
      var m = Math.floor(remain / 60000);
      var s = Math.floor((remain % 60000) / 1000);
      timerEl.innerHTML = '<span>Raid ends in ' + m + ':' + String(s).padStart(2, '0') + '</span>';
    }

    // Stats bar (total damage + participants)
    var statsEl = document.getElementById('boss-stats');
    if (statsEl) {
      statsEl.innerHTML =
        '<div class="boss-stat-card"><div class="boss-stat-value">' + (bs.totalDamage || 0).toLocaleString() + '</div><div class="boss-stat-label">Total Damage</div></div>' +
        '<div class="boss-stat-card"><div class="boss-stat-value">' + (bs.participantCount || 0) + '</div><div class="boss-stat-label">Raiders</div></div>';
    }

    // Party preview
    var atkSection = document.getElementById('boss-attack-section');
    if (atkSection) {
      var partyPreviewEl = document.getElementById('boss-party-preview');
      if (!partyPreviewEl) {
        partyPreviewEl = document.createElement('div');
        partyPreviewEl.id = 'boss-party-preview';
        partyPreviewEl.className = 'boss-party-preview';
        atkSection.insertBefore(partyPreviewEl, atkSection.firstChild);
      }
      var partyIds = (Net.state.user && Net.state.user.party) || [];
      var caught = Net.state.caught || [];
      if (partyIds.length === 0) {
        partyPreviewEl.innerHTML = '<div class="boss-no-party">No party set! Go to your Box and build a party first.</div>';
      } else {
        var partyHtml = '<div class="boss-party-title">Your Party</div><div class="boss-party-row">';
        for (var pi = 0; pi < partyIds.length; pi++) {
          var c = caught.find(function(x) { return x.id === partyIds[pi]; });
          if (!c) continue;
          var sp = GameData.POKEMON_BY_ID[c.pokemonId];
          if (!sp) continue;
          var lvl = c.level || 5;
          var sprUrl = sp.spriteUrl;
          var tColor = sp.color || '#888';
          partyHtml += '<div class="boss-party-member">' +
            (sprUrl ? '<img src="' + sprUrl + '" alt="' + escapeHtml(sp.name) + '" class="boss-party-sprite">' : '<span style="font-size:28px">' + (sp.emoji || '?') + '</span>') +
            '<div class="boss-party-name">' + escapeHtml(sp.name) + '</div>' +
            '<div class="boss-party-lvl" style="color:' + tColor + '">Lv' + lvl + '</div>' +
          '</div>';
        }
        partyHtml += '</div>';
        partyPreviewEl.innerHTML = partyHtml;
      }
    }

    // Attack button
    var atkBtn = document.getElementById('boss-attack-btn');
    if (atkBtn) {
      if (Net.state.bossAttacked) {
        atkBtn.disabled = true;
        atkBtn.textContent = 'Already Attacked';
        atkBtn.className = 'boss-attack-btn attacked';
      } else if (!partyIds || partyIds.length === 0) {
        atkBtn.disabled = true;
        atkBtn.textContent = 'No Party Set!';
        atkBtn.className = 'boss-attack-btn';
      } else {
        atkBtn.disabled = false;
        atkBtn.textContent = 'Send Party to Battle!';
        atkBtn.className = 'boss-attack-btn';
      }
    }

    // Leaderboard
    var lbEl = document.getElementById('boss-leaderboard');
    if (lbEl && bs.leaderboard) {
      lbEl.innerHTML = _buildLeaderboardHtml(bs.leaderboard);
      if (!bs.leaderboard.length) lbEl.innerHTML = '<div class="boss-lb-empty">No participants yet -- be the first!</div>';
    }

    // Drop table — inject after leaderboard section if not already there
    var dropEl = document.getElementById('boss-drop-table-active');
    if (!dropEl) {
      var lbSection = document.getElementById('boss-leaderboard-section');
      if (lbSection) {
        var div = document.createElement('div');
        div.id = 'boss-drop-table-active';
        div.innerHTML = _buildDropTableHtml();
        lbSection.parentNode.insertBefore(div, lbSection.nextSibling);
      }
    }
  }

  function showBossAttackResult(data) {
    var resultEl = document.getElementById('boss-attack-result');
    if (!resultEl || !data.ok) return;
    resultEl.classList.remove('hidden');
    var r = data.result;
    var html = '<div class="boss-result-header">Your Attack</div>';
    html += '<div class="boss-atk-total">' + r.totalDamage.toLocaleString() + ' <small>total damage</small></div>';
    html += '<div class="boss-atk-list">';
    for (var i = 0; i < r.attacks.length; i++) {
      var a = r.attacks[i];
      var species = GameData.POKEMON_BY_ID[a.pokemonId];
      var spriteUrl = species ? species.spriteUrl : '';
      var effClass = a.effectiveness >= 2 ? 'super' : (a.effectiveness > 0 && a.effectiveness <= 0.5) ? 'weak' : a.effectiveness === 0 ? 'immune' : '';
      var effText = a.effectiveness >= 2 ? 'Super effective!' : (a.effectiveness > 0 && a.effectiveness <= 0.5) ? 'Not very effective' : a.effectiveness === 0 ? 'No effect' : '';
      var moveColor = (GameData.TYPE_COLORS && GameData.TYPE_COLORS[a.moveType]) || '#888';
      html += '<div class="boss-atk-row">' +
        (spriteUrl ? '<img class="boss-atk-sprite" src="' + spriteUrl + '" alt="">' : '<span style="font-size:24px">' + (species ? species.emoji : '?') + '</span>') +
        '<div class="boss-atk-info">' +
          '<div class="boss-atk-name">' + escapeHtml(a.pokemonName) + ' <small>Lv' + a.level + (a.isShiny ? ' *' : '') + '</small></div>' +
          '<div class="boss-atk-move" style="color:' + moveColor + '">' + escapeHtml(a.moveName) + '</div>' +
        '</div>' +
        '<div class="boss-atk-dmg-col">' +
          '<div class="boss-atk-dmg-num">' + a.damage.toLocaleString() + (a.crit ? ' <span class="boss-crit">CRIT!</span>' : '') + '</div>' +
          (effText ? '<div class="boss-eff boss-eff-' + effClass + '">' + effText + '</div>' : '') +
        '</div>' +
      '</div>';
    }
    html += '</div>';
    resultEl.innerHTML = html;
    var atkBtn = document.getElementById('boss-attack-btn');
    if (atkBtn) { atkBtn.disabled = true; atkBtn.textContent = 'Already Attacked'; atkBtn.className = 'boss-attack-btn attacked'; }
    updateBossButton();
  }

  function showBossResults(data) {
    // Called when boss_ended event fires while modal is open
    // Re-render to show sleeping state with the ended boss data
    renderBoss();
  }

  return { init, refreshHud, openBallPicker, openBox, renderBox, showDetail, openPokedex, openLeaderboards, setLeaderboards, openSettings, openInfo, showOfflineResults, toast, openQuests, openAchievements, renderQuests, renderAchievements, openShop, renderShop, renderCrystalShop, openLevels, openBattle, renderBattle, queueEvolution, openEggs, renderEggs, playHatchAnimation, _updateEggsBadge, openTower, renderTower, openProfile, renderProfile, openAvatarSwitcher, renderAvatarSwitcher, openPlayers, renderPlayers, openMarket, renderMarket, openCrystalShop, renderCrystalPackages, openAdmin, isAdmin, openBugReport, closeBugReport, openFeedback, closeFeedback, initBoss, updateBossButton, showBossBanner, openBoss, renderBoss, showBossAttackResult, showBossResults };
})();
window.UI = UI;
