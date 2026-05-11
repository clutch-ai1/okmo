// js/main.js
// Init: handle login, connect WebSocket, wire spawn view + chat + UI events.

(function () {
  // ---------- Login screen ----------
  let mode = 'login';
  const loginScreen = document.getElementById('login-screen');
  const app = document.getElementById('app');
  const tabs = document.querySelectorAll('.tab');
  const errorEl = document.getElementById('auth-error');
  const submitBtn = document.getElementById('auth-submit');
  const passEl = document.getElementById('auth-password');
  const userEl = document.getElementById('auth-username');
  const rememberEl = document.getElementById('auth-remember');

  // ---------- Remember-Me ----------
  // Only stores username for convenience. Auth is handled via JWT token in localStorage ('mmoToken').
  // Passwords are NEVER stored client-side.
  const REMEMBER_KEY = 'okmo_remember_v2';
  function loadRemembered() {
    try {
      const raw = localStorage.getItem(REMEMBER_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.remember) {
        rememberEl.checked = true;
        if (data.username) userEl.value = data.username;
      }
    } catch (_) {}
    // Clean up old insecure format that stored passwords
    try { localStorage.removeItem('okmo_remember_v1'); } catch (_) {}
  }
  function saveRemembered(username) {
    if (rememberEl.checked) {
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({ remember: true, username }));
    } else {
      localStorage.removeItem(REMEMBER_KEY);
    }
  }
  loadRemembered();

  // ---------- Login Music (YouTube IFrame Player) ----------
  // Plays the Pokémon theme song on the login screen. Browsers block
  // unmuted autoplay, so we start MUTED and unmute on user click.
  const SOUND_KEY = 'okmo_sound_v1';
  const YT_VIDEO_ID = 'YMEblRM4pGc';
  const soundBtn = document.getElementById('login-sound-btn');
  let ytPlayer = null;
  let ytReady = false;
  let pendingUnmute = false; // user clicked unmute before player was ready

  // Inject YT IFrame API script
  (function loadYTApi() {
    if (window.YT && window.YT.Player) return; // already loaded
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  })();

  window.onYouTubeIframeAPIReady = function () {
    ytPlayer = new YT.Player('yt-player', {
      height: '1',
      width: '1',
      videoId: YT_VIDEO_ID,
      playerVars: {
        autoplay: 1,
        loop: 1,
        playlist: YT_VIDEO_ID, // required for loop to work
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        iv_load_policy: 3,
      },
      events: {
        onReady: (e) => {
          ytReady = true;
          e.target.setVolume(35);
          // Browsers block unmuted autoplay → start muted, but try to
          // unmute immediately. Works if the user has interacted with
          // the page/origin before; otherwise the first-click listener
          // below will pick it up.
          e.target.mute();
          try { e.target.playVideo(); } catch (_) {}
          if (!soundBtn.classList.contains('muted')) {
            try { e.target.unMute(); e.target.playVideo(); } catch (_) {}
          }
          if (pendingUnmute) {
            try { e.target.unMute(); e.target.playVideo(); } catch (_) {}
            pendingUnmute = false;
          }
        },
      },
    });
  };

  function setMuted(muted) {
    if (muted) {
      soundBtn.classList.add('muted');
      if (ytReady && ytPlayer) {
        try { ytPlayer.mute(); } catch (_) {}
      }
      localStorage.setItem(SOUND_KEY, 'off');
    } else {
      soundBtn.classList.remove('muted');
      if (ytReady && ytPlayer) {
        try { ytPlayer.unMute(); ytPlayer.playVideo(); } catch (_) {}
      } else {
        pendingUnmute = true;
      }
      localStorage.setItem(SOUND_KEY, 'on');
    }
  }

  // Default state: ON unless explicitly saved as "off"
  const savedSound = localStorage.getItem(SOUND_KEY);
  if (savedSound === 'off') soundBtn.classList.add('muted');
  else soundBtn.classList.remove('muted');

  soundBtn.addEventListener('click', () => {
    const wasMuted = soundBtn.classList.contains('muted');
    setMuted(!wasMuted);
  });

  // Browser autoplay policy: unmuted autoplay is blocked without a user
  // gesture. The first time the user clicks/keys/touches anywhere on the
  // page, attempt to unmute (only if button is in "on" state).
  function tryUnmuteOnFirstGesture() {
    if (soundBtn.classList.contains('muted')) return; // user wanted muted
    if (ytReady && ytPlayer) {
      try { ytPlayer.unMute(); ytPlayer.playVideo(); } catch (_) {}
    } else {
      pendingUnmute = true;
    }
  }
  const onceOpts = { once: true, capture: true };
  document.addEventListener('pointerdown', tryUnmuteOnFirstGesture, onceOpts);
  document.addEventListener('keydown',     tryUnmuteOnFirstGesture, onceOpts);
  document.addEventListener('touchstart',  tryUnmuteOnFirstGesture, onceOpts);

  // Stop music once user enters the game
  function stopLoginMusic() {
    if (ytReady && ytPlayer) {
      try { ytPlayer.stopVideo(); } catch (_) {}
    }
  }
  // Hook into bootGame: hide login screen handler will trigger this
  window.__stopLoginMusic = stopLoginMusic;

  tabs.forEach(t => {
    t.onclick = () => {
      mode = t.dataset.tab;
      tabs.forEach(b => b.classList.toggle('active', b === t));
      submitBtn.textContent = mode === 'login' ? '▶ Log in' : '▶ Register';
      passEl.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      errorEl.textContent = '';
    };
  });

  // Char-selection state for register flow
  let _pendingRegister = null; // { username, password }
  let _selectedGender = null;
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const u = userEl.value.trim();
    const p = passEl.value;
    submitBtn.disabled = true;
    if (mode === 'login') {
      const r = await Net.login(u, p);
      submitBtn.disabled = false;
      if (!r.ok) { errorEl.textContent = r.error || 'Failed'; return; }
      saveRemembered(u);
      bootGame();
    } else {
      // Register: show character selection step
      submitBtn.disabled = false;
      _pendingRegister = { username: u, password: p };
      document.getElementById('login-panel').classList.add('hidden');
      document.getElementById('char-select-panel').classList.remove('hidden');
    }
  });

  // Wire character selection
  document.querySelectorAll('.char-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      _selectedGender = card.dataset.gender;
      const btn = document.getElementById('char-confirm');
      btn.disabled = false;
      btn.textContent = 'Start as ' + (_selectedGender === 'male' ? 'Male' : 'Female') + ' Trainer';
    });
  });
  document.getElementById('char-confirm').addEventListener('click', async () => {
    if (!_pendingRegister || !_selectedGender) return;
    const btn = document.getElementById('char-confirm');
    btn.disabled = true;
    btn.textContent = 'Creating account...';
    const r = await Net.register(_pendingRegister.username, _pendingRegister.password, _selectedGender);
    if (!r.ok) {
      btn.disabled = false;
      btn.textContent = 'Try again';
      // Show error and go back to login
      document.getElementById('login-panel').classList.remove('hidden');
      document.getElementById('char-select-panel').classList.add('hidden');
      errorEl.textContent = r.error || 'Registration failed';
      return;
    }
    saveRemembered(_pendingRegister.username);
    bootGame();
  });

  // ---------- Boot ----------
  let booted = false;
  Net.autoLogin().then(user => {
    if (user) bootGame();
  });

  // ---------- Legendary banner ----------
  function showLegendaryBanner(name) {
    const banner = document.getElementById('legendary-banner');
    const sub = document.getElementById('legendary-banner-sub');
    if (!banner) return;
    if (sub) sub.textContent = 'A wild ' + name + ' has appeared! Catch it before it flees!';
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('hidden'), 5000);
  }

  function showLevelUpFlash() {
    const flash = document.createElement('div');
    flash.className = 'level-up-flash';
    flash.innerHTML = '🎉 LEVEL UP! 🎉';
    document.body.appendChild(flash);
    setTimeout(() => flash.classList.add('show'), 10);
    setTimeout(() => { flash.classList.remove('show'); setTimeout(() => flash.remove(), 500); }, 1800);
  }

  // ---------- Activity Log ----------
  function logEvent(kind, html, pokemonId) {
    const list = document.getElementById('log-list');
    if (!list) return;
    const el = document.createElement('div');
    el.className = 'log-entry ' + (kind || 'info');
    let imgHtml = '';
    if (pokemonId) {
      const p = GameData.POKEMON_BY_ID[pokemonId];
      if (p) imgHtml = '<img src="' + p.spriteUrl + '" alt="" loading="lazy">';
    }
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = imgHtml + '<div class="log-text">' + html + '<div class="log-time">' + time + '</div></div>';
    list.insertBefore(el, list.firstChild);
    while (list.children.length > 60) list.removeChild(list.lastChild);
  }

  function bootGame() {
    if (booted) return;
    booted = true;
    if (window.__stopLoginMusic) window.__stopLoginMusic();
    loginScreen.classList.add('hidden');
    app.classList.remove('hidden');
    UI.init();
    // ArenaUI disabled — battle system is "Coming Soon"
    // if (window.ArenaUI && ArenaUI.init) ArenaUI.init();
    if (window.AvatarUI && AvatarUI.init) AvatarUI.init();
    UI.initBoss();
    ChatUI.init();
    logEvent('info', 'Welcome, <b>' + (Net.state.user ? Net.state.user.username : 'Trainer') + '</b>! AFK Ball is running…');
    const spawnCanvas = document.getElementById('spawn-canvas');
    const spawnView = new SpawnView(spawnCanvas);

    // Catch button
    const catchBtn = document.getElementById('catch-btn');
    catchBtn.onclick = () => UI.openBallPicker();

    // Spawn timer ticker — only updates DOM when values actually change
    const timerEl = document.getElementById('spawn-overlay-timer');
    let _lastCatchState = '', _lastTimerText = '', _lastLockedBall = '';
    function updateCatchBtn() {
      const spawn = Net.state.spawn;
      const attempt = Net.state.myAttempt;
      if (spawn) {
        const remain = Math.max(0, spawn.resolvesAt - Date.now());
        const secs = Math.ceil(remain / 1000);
        if (remain > 0) {
          if (attempt && attempt.ballLocked && attempt.ball) {
            const b = GameData.BALL_BY_ID[attempt.ball];
            const label = 'Locked: ' + (b ? b.name : attempt.ball) + ' (' + secs + 's)';
            const stateKey = 'locked:' + attempt.ball + ':' + secs;
            if (stateKey !== _lastCatchState) {
              _lastCatchState = stateKey;
              // Only rebuild the icon img if the ball changed
              if (_lastLockedBall !== attempt.ball) {
                _lastLockedBall = attempt.ball;
                const iconHtml = b ? '<img src="' + b.spriteUrl + '" alt="" class="lock-ball-icon">' : '';
                catchBtn.innerHTML = iconHtml + '<span class="catch-label"></span>';
              }
              const span = catchBtn.querySelector('.catch-label');
              if (span) span.textContent = label; else catchBtn.lastChild.textContent = label;
              catchBtn.classList.add('locked');
              catchBtn.disabled = true;
            }
          } else {
            const stateKey = 'open:' + secs;
            if (stateKey !== _lastCatchState) {
              _lastCatchState = stateKey;
              _lastLockedBall = '';
              catchBtn.textContent = 'Catch! (' + secs + 's) — auto: AFK Ball';
              catchBtn.classList.remove('locked');
              catchBtn.disabled = false;
            }
          }
          const timerText = 'Resolves in ' + secs + 's';
          if (timerEl && timerText !== _lastTimerText) { _lastTimerText = timerText; timerEl.textContent = timerText; }
        } else {
          if (_lastCatchState !== 'resolving') {
            _lastCatchState = 'resolving'; _lastLockedBall = '';
            catchBtn.textContent = 'Resolving…';
            catchBtn.classList.remove('locked');
            catchBtn.disabled = true;
          }
        }
      } else {
        if (_lastCatchState !== 'idle') {
          _lastCatchState = 'idle'; _lastLockedBall = '';
          catchBtn.textContent = 'No active spawn';
          catchBtn.classList.remove('locked');
          catchBtn.disabled = true;
        }
        if (timerEl) {
          const nextAt = Net.state.nextSpawnAt;
          if (nextAt && nextAt > Date.now()) {
            const t = 'Next spawn in ' + Math.ceil((nextAt - Date.now()) / 1000) + 's';
            if (t !== _lastTimerText) { _lastTimerText = t; timerEl.textContent = t; }
          }
        }
      }
    }
    setInterval(updateCatchBtn, 250);

    // ---------- Net events ----------
    Net.on('init', (s) => {
      UI.refreshHud();
      UI.updateBossButton();
      ChatUI.setMessages(s.chat);
      spawnView.setSpawn(s.spawn);
      spawnView.setAttempt(s.myAttempt);
      if (s.dailyReward) {
        const r = s.dailyReward;
        const ballName = (GameData.BALL_BY_ID[r.ball] || {name: r.ball}).name;
        UI.toast('🎁 Daily ' + r.label + ': +🪙' + r.gold + ' + ' + r.count + '× ' + ballName, 'success');
        logEvent('bonus', '🎁 <b>Daily Login Reward</b> — ' + r.label + ' (Streak: ' + r.totalStreak + ' days)<br>+🪙' + r.gold + ' · ' + r.count + '× ' + ballName);
      }
    });

    Net.on('spawn_start', (sp) => {
      spawnView.setSpawn(sp);
      const p = GameData.POKEMON_BY_ID[sp.pokemonId];
      if (sp.isLegendary) {
        UI.toast('🌟 LEGENDARY: ' + p.name + ' has appeared! 🌟', 'success');
        logEvent('legendary', '🌟 <b>LEGENDARY</b>: A wild <b>' + p.name + '</b> appeared!', sp.pokemonId);
        showLegendaryBanner(p.name);
      } else {
        UI.toast('A wild ' + p.name + ' appeared!', 'info');
        logEvent('info', 'A wild <b>' + p.name + '</b> appeared', sp.pokemonId);
      }
    });
    Net.on('legendary_alert', (m) => {
      // Already handled in spawn_start; just log a fancy message
      logEvent('legendary', m.message);
    });
    Net.on('legendary_first_catch', (m) => {
      UI.toast('🥇 ' + m.username + ' caught ' + m.pokemonName + ' first!', 'success');
      logEvent('bonus', '🥇 <b>' + m.username + '</b> caught the legendary <b>' + m.pokemonName + '</b> first!', m.pokemonId);
    });
    Net.on('achievement_broadcast', (m) => {
      logEvent('bonus', '🏅 <b>' + m.username + '</b> earned: <i>' + m.achievement + '</i>' + (m.title ? ' — Title « ' + m.title + ' »' : ''));
    });
    Net.on('attempt_update', (a) => {
      spawnView.setAttempt(a);
      UI.refreshHud();
    });
    Net.on('choose_ball_result', (m) => {
      if (!m.ok) UI.toast(m.reason || 'Could not select ball', 'error');
      else {
        spawnView.setAttempt(m.attempt);
        UI.refreshHud();
        UI.toast('Ball locked in', 'success');
      }
    });
    Net.on('spawn_result', (m) => {
      const r = m.result;
      const p = GameData.POKEMON_BY_ID[m.pokemonId];
      spawnView.setResult(r);
      if (r.caught) {
        UI.toast(p.name + (r.isShiny ? ' ✨' : '') + ' caught!', 'success');
        const ivT = r.ivs ? Object.values(r.ivs).reduce((a,b)=>a+b, 0) : 0;
        const power = Math.round(ivT / 186 * 100);
        const ballName = GameData.BALL_BY_ID[r.ball] ? GameData.BALL_BY_ID[r.ball].name : r.ball;
        const kind = r.isShiny ? 'shiny' : 'caught';
        const shinyStr = r.isShiny ? ' ✨ <b>SHINY!</b>' : '';
        logEvent(kind, 'Caught <b>' + p.name + '</b>' + shinyStr + '<br>IVs ' + ivT + '/186 · Power ' + power + ' · ' + ballName, m.pokemonId);
        if (r.bonus) {
          const ball = GameData.BALL_BY_ID[r.bonus];
          UI.toast('Bonus: 1× ' + ball.name, 'success');
          logEvent('bonus', 'Bonus drop: <b>1× ' + ball.name + '</b>');
        }
      } else if (r.ball) {
        UI.toast(p.name + ' broke free!', 'error');
        const ballName = GameData.BALL_BY_ID[r.ball] ? GameData.BALL_BY_ID[r.ball].name : r.ball;
        logEvent('failed', '<b>' + p.name + '</b> broke free<br>Used ' + ballName, m.pokemonId);
      }
      // Gold reward (server adds 1 per attempt + bonuses)
      if (r.gold) {
        logEvent('info', '+<b>' + r.gold + ' 🪙</b>');
      }
      // Egg drop
      if (m.eggDrop) {
        UI.toast('🥚 You found a ' + m.eggDrop.name + '!', 'success');
        logEvent('bonus', '🥚 Found a <b>' + m.eggDrop.name + '</b> — check the Eggs tab to incubate it!');
        if (UI._updateEggsBadge) UI._updateEggsBadge();
      }
      // Pokemon party XP updates (silent +1 per catch; only celebrate level-ups + evolutions)
      if (m.progression && m.progression.partyXp) {
        for (const px of m.progression.partyXp) {
          const inst = Net.state.caught.find(c => c.id === px.caughtId);
          if (inst) {
            inst.level = px.newLevel; inst.xp = px.newXp;
            if (px.evolved) inst.pokemonId = px.evolved.toId;
          }
          if (px.levelUps && px.levelUps.length) {
            UI.toast('🎓 ' + px.pokemonName + ' grew to Lv ' + px.newLevel + '!', 'success');
            logEvent('bonus', '🎓 <b>' + px.pokemonName + '</b> grew to Level <b>' + px.newLevel + '</b>!', px.pokemonId);
          }
          if (px.evolved) {
            logEvent('bonus', '✨ <b>' + px.evolved.fromName + '</b> evolved into <b>' + px.evolved.toName + '</b>!', px.evolved.toId);
            UI.queueEvolution(px.evolved);
          }
        }
      }
      // Progression: XP, level-ups, achievements, quest completions
      const prog = m.progression;
      if (prog) {
        if (prog.xpGained) {
          logEvent('info', '+<b>' + prog.xpGained + ' XP</b>');
        }
        if (prog.newStreak >= 3) {
          UI.toast('🔥 Streak: ' + prog.newStreak + 'x!', 'success');
        }
        if (prog.levelUps && prog.levelUps.length) {
          for (const lu of prog.levelUps) {
            UI.toast('🎉 LEVEL UP! Level ' + lu.level, 'success');
            const rewardStr = lu.reward ? ' — Reward: ' + lu.reward.count + '× ' + (GameData.BALL_BY_ID[lu.reward.ball] || {name:lu.reward.ball}).name : '';
            logEvent('bonus', '🎉 <b>LEVEL UP!</b> Reached Level <b>' + lu.level + '</b>' + rewardStr);
          }
          showLevelUpFlash();
        }
        if (prog.achievements && prog.achievements.length) {
          for (const ach of prog.achievements) {
            UI.toast('🏅 Achievement: ' + ach.name + (ach.title ? ' — Title « ' + ach.title + ' »' : ''), 'success');
            logEvent('bonus', '🏅 Unlocked: <b>' + ach.name + '</b>' + (ach.title ? ' — Title « ' + ach.title + ' »' : ''));
          }
        }
        if (prog.questsCompleted && prog.questsCompleted.length) {
          for (const q of prog.questsCompleted) {
            const ball = q.reward ? GameData.BALL_BY_ID[q.reward.ball] : null;
            UI.toast('📜 Quest done: ' + q.label + (ball ? ' — ' + q.reward.count + '× ' + ball.name : ''), 'success');
            logEvent('bonus', '📜 Quest complete: <b>' + q.label + '</b>' + (ball ? ' — ' + q.reward.count + '× ' + ball.name : ''));
          }
        }
      }
      UI.refreshHud();
      if (UI.renderQuests) UI.renderQuests();
    });
    Net.on('daily_quests', () => { if (UI.renderQuests) UI.renderQuests(); UI.refreshHud(); });
    Net.on('shop', () => {
      if (UI.renderShop) UI.renderShop();
      if (UI.renderCrystalShop) UI.renderCrystalShop();
    });
    Net.on('buy_result', (m) => {
      if (m.ok) {
        const itemName = m.item && m.item.name ? m.item.name : 'item';
        const isCrystal = m.item && m.item.id && m.item.id.indexOf('c_') === 0;
        const symbol = isCrystal ? '💎' : '🪙';
        const currency = isCrystal ? 'crystals' : 'gold';
        UI.toast('Bought ' + itemName + ' for ' + symbol + m.item.price, 'success');
        logEvent('bonus', symbol + ' Purchased <b>' + itemName + '</b> for ' + m.item.price + ' ' + currency);
      } else {
        UI.toast('Buy failed: ' + (m.reason || 'unknown'), 'error');
      }
      UI.refreshHud();
      if (UI.renderShop) UI.renderShop();
      if (UI.renderCrystalShop) UI.renderCrystalShop();
    });
    Net.on('user_update', () => {
      UI.refreshHud();
      if (UI.renderBox) UI.renderBox();
      if (UI._updateEggsBadge) UI._updateEggsBadge();
      if (UI.renderCrystalShop) UI.renderCrystalShop();
    });
    Net.on('profile', (p) => { if (UI.renderProfile) UI.renderProfile(p); });
    Net.on('players_list', (players) => { if (UI.renderPlayers) UI.renderPlayers(players); });
    Net.on('market_listings', () => { if (UI.renderMarket) UI.renderMarket(); });
    Net.on('crystal_packages', () => { if (UI.renderCrystalPackages) UI.renderCrystalPackages(); });
    Net.on('market_result', (m) => {
      if (!m.ok) { UI.toast(m.reason || 'Market error', 'error'); return; }
      if (m.action === 'listed') { UI.toast('🏪 Pokemon listed for sale!', 'success'); Net.fetchMarket(); }
      else if (m.action === 'cancelled') { UI.toast('Listing cancelled', 'info'); Net.fetchMarket(); }
      else if (m.action === 'bought') { UI.toast('🎉 Pokemon purchased!', 'success'); UI.refreshHud(); Net.fetchMarket(); if (UI.renderMarket) UI.renderMarket(); }
      else if (m.action === 'crystals_added') { UI.toast('💎 +' + m.amount + ' Crystals added!', 'success'); UI.refreshHud(); }
    });
    Net.on('upgrade_result', (m) => {
      if (!m.ok) { UI.toast(m.reason || 'Upgrade failed', 'error'); return; }
      UI.toast('Pokemon upgraded successfully!', 'success');
      UI.refreshHud();
      if (UI.renderBox) UI.renderBox();
    });
    Net.on('sell_result', (m) => {
      if (!m.ok) { UI.toast(m.reason || 'Sell failed', 'error'); return; }
      UI.toast('Sold ' + m.pokemonName + ' for ' + m.price + ' Gold!', 'success');
      UI.refreshHud();
      UI.close('detail-modal');
      if (UI.renderBox) UI.renderBox();
    });
    Net.on('egg_data', () => { if (UI.renderEggs) UI.renderEggs(); });
    Net.on('egg_action_result', (m) => {
      if (!m.ok) { UI.toast(m.reason || 'Egg error', 'error'); return; }
      if (m.action === 'placed') UI.toast('Egg placed in incubator', 'success');
      else if (m.action === 'bought_egg') UI.toast('Egg purchased', 'success');
      else if (m.action === 'bought_incubator') UI.toast('Incubator purchased!', 'success');
      else if (m.action === 'hatched') {
        UI.playHatchAnimation(m.hatch);
        const shinyStr = m.hatch.isShiny ? ' ✨ <b>SHINY!</b>' : '';
        logEvent('shiny', '🥚 Hatched <b>' + m.hatch.name + '</b>' + shinyStr + '<br>IV ' + m.hatch.ivTotal + '/186', m.hatch.speciesId);
      }
      UI.refreshHud();
      if (UI.renderEggs) UI.renderEggs();
    });
    Net.on('battle_state', (m) => {
      if (!m.ok) {
        UI.toast(m.reason || 'Battle error', 'error');
        // If server returned an existing battle (e.g. "already in battle"), open it
        if (m.battle && !m.battle.over) UI.openBattle();
        return;
      }
      if (m.battle && !m.battle.over) {
        // Open battle modal if not already open
        const isOpen = !document.getElementById('battle-modal').classList.contains('hidden');
        if (!isOpen) UI.openBattle();
        else UI.renderBattle();
      } else if (m.battle && m.battle.over) {
        UI.renderBattle();
        if (m.battle.winner === 'player') {
          UI.toast('🏆 Victory vs ' + m.battle.npcName + '!', 'success');
          logEvent('bonus', '🏆 Defeated <b>' + m.battle.npcName + '</b> · +🪙' + m.battle.reward.gold + ' · +' + m.battle.reward.xp + ' XP per party member');
          if (m.battle.eggDrop) {
            UI.toast('🥚 Battle drop: ' + m.battle.eggDrop.name + '!', 'success');
            logEvent('bonus', '🥚 Battle drop: <b>' + m.battle.eggDrop.name + '</b>');
          }
          if (m.battle.partyProgression) {
            for (const px of m.battle.partyProgression) {
              if (px.levelUps && px.levelUps.length) {
                logEvent('bonus', '🎓 <b>' + px.pokemonName + '</b> grew to Lv <b>' + px.newLevel + '</b>!', px.pokemonId);
              }
              if (px.evolved) {
                logEvent('bonus', '✨ <b>' + px.evolved.fromName + '</b> evolved into <b>' + px.evolved.toName + '</b>!', px.evolved.toId);
                UI.queueEvolution(px.evolved);
                const inst = Net.state.caught.find(c => c.id === px.instanceId);
                if (inst) inst.pokemonId = px.evolved.toId;
              }
            }
          }
        } else {
          UI.toast('💔 Lost vs ' + m.battle.npcName, 'error');
          logEvent('failed', '💔 Lost battle vs <b>' + m.battle.npcName + '</b>');
        }
        UI.refreshHud();
      }
    });
    Net.on('spawn_end', () => {
      // Keep result on screen briefly, then clear (shorter to avoid stale overlap)
      setTimeout(() => spawnView.clear(), 2500);
    });
    Net.on('chat', (m) => ChatUI.appendMessage(m));
    Net.on('leaderboards', (b) => UI.setLeaderboards(b));
    Net.on('offline', (results) => {
      if (results && results.length) UI.showOfflineResults(results);
    });
    // ---------- World Boss events ----------
    Net.on('boss_spawn', (m) => {
      UI.updateBossButton();
      UI.showBossBanner(m.boss.name);
      UI.toast('👹 WORLD BOSS: ' + m.boss.name + ' appeared!', 'success');
      logEvent('legendary', '👹 <b>WORLD BOSS</b>: <b>' + m.boss.name + '</b> (Lv ' + m.boss.level + ') appeared!');
    });
    Net.on('boss_update', (m) => {
      UI.updateBossButton();
      if (!document.getElementById('boss-modal').classList.contains('hidden')) UI.renderBoss();
    });
    Net.on('boss_ended', (m) => {
      UI.updateBossButton();
      UI.toast('👹 ' + m.bossName + ' raid ended! ' + m.participantCount + ' participants', 'info');
      logEvent('bonus', '👹 <b>' + m.bossName + '</b> raid ended — ' + m.totalDamage.toLocaleString() + ' total damage!');
      if (!document.getElementById('boss-modal').classList.contains('hidden')) {
        UI.showBossResults(m);
      }
      UI.refreshHud();
    });
    Net.on('boss_attack_result', (m) => {
      if (!m.ok) { UI.toast(m.reason || 'Attack failed', 'error'); var btn = document.getElementById('boss-attack-btn'); if (btn) { btn.disabled = false; btn.textContent = '⚔️ Send Party to Battle!'; } return; }
      UI.showBossAttackResult(m);
      UI.toast('👹 Dealt ' + m.result.totalDamage.toLocaleString() + ' damage!', 'success');
      logEvent('bonus', '👹 Dealt <b>' + m.result.totalDamage.toLocaleString() + '</b> damage to the World Boss!');
      UI.refreshHud();
      if (!document.getElementById('boss-modal').classList.contains('hidden')) UI.renderBoss();
    });
    Net.on('boss_state', () => { UI.updateBossButton(); if (!document.getElementById('boss-modal').classList.contains('hidden')) UI.renderBoss(); });

    Net.on('error', (msg) => UI.toast(msg, 'error'));
    Net.on('disconnect', () => {
      console.warn("[net] WebSocket closed — make sure the server is running");
    });

    Net.connect();
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.onclick = () => Net.logout();
  }
})();
