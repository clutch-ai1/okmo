// client/js/game.js
// Glue-Code: verbindet Network + Renderer + Input + Battle-UI und enthaelt den Game-Loop.

(function () {
  const canvas   = document.getElementById('game-canvas');
  const renderer = new WorldRenderer(canvas);
  const input    = new InputManager();
  const battleUI = new BattleUI(window.net);

  const loginScreen = document.getElementById('login-screen');
  const gameRoot    = document.getElementById('game-root');
  const nameInput   = document.getElementById('name-input');
  const loginBtn    = document.getElementById('login-btn');
  const playerInfo  = document.getElementById('player-info');
  const chatLog     = document.getElementById('chat-log');
  const chatInput   = document.getElementById('chat-input');

  let me = null; // privater Spielerzustand (mit Party)

  // ----- Login -----
  loginBtn.addEventListener('click', startGame);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });
  nameInput.focus();

  function startGame() {
    const name = nameInput.value.trim() || 'Trainer';
    window.net.connect();
    window.net.on('open', () => window.net.send('login', { name }));
  }

  // ----- Server-Nachrichten -----
  window.net.on('init', (msg) => {
    me = msg.you;
    renderer.setWorld(msg.world);
    renderer.setYou(me);
    renderer.setPlayers(msg.players);
    loginScreen.classList.add('hidden');
    gameRoot.classList.remove('hidden');
    updateHud();
  });

  window.net.on('players_update', (msg) => {
    renderer.setPlayers(msg.players);
    // Eigene Position aus Liste aktualisieren
    if (me) {
      const upd = msg.players.find(p => p.id === me.id);
      if (upd) { me.x = upd.x; me.y = upd.y; me.facing = upd.facing; renderer.setYou(me); }
    }
  });

  window.net.on('chat', (msg) => {
    const line = document.createElement('div');
    line.className = 'line';
    if (msg.from === 'System') {
      line.classList.add('system');
      line.textContent = msg.text;
    } else {
      const from = document.createElement('span');
      from.className = 'from'; from.textContent = msg.from + ': ';
      line.appendChild(from);
      line.appendChild(document.createTextNode(msg.text));
    }
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
  });

  window.net.on('battle_start',  (msg) => { input.setDisabled(true); battleUI.open(msg.state); });
  window.net.on('battle_update', (msg) => { battleUI.update(msg.state); });
  window.net.on('battle_end',    (msg) => {
    if (msg.party) me.party = msg.party;
    battleUI.end(msg.state);
    updateHud();
  });
  battleUI.onClose = () => { input.setDisabled(false); };

  window.net.on('error', (msg) => console.warn('Server-Fehler:', msg.message));
  window.net.on('close', () => {
    const line = document.createElement('div');
    line.className = 'line system';
    line.textContent = 'Verbindung verloren. Lade die Seite neu.';
    chatLog.appendChild(line);
  });

  // ----- Input -> Server -----
  input.onMove = (dir) => window.net.send('move', { direction: dir });
  input.onChatToggle = (key) => {
    if (key === 'Enter') {
      if (document.activeElement === chatInput) {
        const text = chatInput.value.trim();
        if (text) window.net.send('chat', { text });
        chatInput.value = '';
        chatInput.blur();
      } else {
        chatInput.focus();
      }
    } else if (key === 'Escape') {
      chatInput.value = '';
      chatInput.blur();
    }
  };

  // ----- HUD -----
  function updateHud() {
    if (!me) return;
    const m = me.party && me.party[0];
    if (!m) { playerInfo.textContent = me.name; return; }
    playerInfo.innerHTML = `<b>${me.name}</b> &middot; ${m.name} Lv.${m.level} &middot; HP ${m.hp}/${m.maxHp}`;
  }

  // ----- Game-Loop -----
  function loop() {
    input.tick();
    renderer.render();
    updateHud();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
