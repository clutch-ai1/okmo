// js/net.js
// Auth API + WebSocket connection. Single source of truth for server state.

const Net = (function () {
  let socket = null;
  let token = null;
  let user = null;
  const listeners = {};
  // Internal write-key: only code with _stateKey can modify state
  const _stateKey = Symbol('netState');
  const _rawState = {
    user: null,
    spawn: null,           // { spawnId, pokemonId, areaId, spawnedAt, resolvesAt, pokemon, area }
    myAttempt: null,       // { ivs, ball, isShiny }
    caught: [],
    pokedex: {},
    chat: [],
    spawnIntervalMs: 60000,
    catchWindowMs: 45000,
    nextSpawnAt: null,
    gameVersion: null,     // set from init, used for version-check on reconnect
    bossState: null,       // current world boss state
    bossAttacked: false,   // has current user attacked this boss
  };
  // Expose a read-only proxy as 'state' — console writes are silently ignored
  let _allowWrite = false;
  const state = new Proxy(_rawState, {
    set(target, prop, value) {
      if (!_allowWrite) {
        console.warn('[Anti-Cheat] Writing to Net.state is not allowed.');
        return true; // fail silently
      }
      target[prop] = value;
      return true;
    },
    deleteProperty(target, prop) {
      if (!_allowWrite) return true;
      delete target[prop];
      return true;
    }
  });
  function _writeState(fn) { _allowWrite = true; try { fn(); } finally { _allowWrite = false; } }

  function on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  function fire(type, payload) { (listeners[type] || []).forEach(fn => fn(payload)); }

  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json().catch(() => ({ ok: false, error: 'Bad response' }));
  }

  async function register(username, password, gender) {
    const r = await api('/auth/register', { username, password, gender });
    if (r.ok) { token = r.token; user = r.user; localStorage.setItem('mmoToken', token); }
    return r;
  }
  async function login(username, password) {
    const r = await api('/auth/login', { username, password });
    if (r.ok) { token = r.token; user = r.user; localStorage.setItem('mmoToken', token); }
    return r;
  }
  async function autoLogin() {
    token = localStorage.getItem('mmoToken');
    if (!token) return null;
    try {
      const r = await api('/auth/me');
      if (r && r.ok) { user = r.user; return r.user; }
    } catch (e) {
      console.warn('[auth] auto-login network error:', e.message);
    }
    // Stale or invalid token — clear it cleanly
    token = null;
    localStorage.removeItem('mmoToken');
    return null;
  }
  function logout() {
    localStorage.removeItem('mmoToken');
    token = null; user = null;
    if (socket) socket.close();
    location.reload();
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    socket = new WebSocket(url);
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', token }));
    };
    socket.onclose = () => {
      fire('disconnect');
      setTimeout(connect, 2000);
    };
    socket.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      handle(msg);
    };
  }

  function send(type, data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(Object.assign({ type }, data || {})));
  }

  function handle(msg) { _allowWrite = true; try { _handle(msg); } finally { _allowWrite = false; } }
  function _handle(msg) {
    if (msg.type === 'auth_fail') {
      console.warn('[auth] WebSocket auth failed — clearing local token');
      localStorage.removeItem('mmoToken');
      // Don't auto-reload — let user see the login screen
      try { socket.close(); } catch {}
      setTimeout(() => location.reload(), 500);
      return;
    }
    if (msg.type === 'init') {
      // Version mismatch check — if server version changed since we loaded, force reload
      if (state.gameVersion && msg.gameVersion && state.gameVersion !== msg.gameVersion) {
        fire('version_update', { reason: 'A new update has been deployed! Reloading...' });
        return;
      }
      state.gameVersion = msg.gameVersion || null;
      state.user = msg.user;
      state.spawn = msg.spawn;
      state.myAttempt = msg.myAttempt;
      state.caught = msg.caught;
      state.pokedex = msg.pokedex;
      state.chat = msg.chat;
      state.spawnIntervalMs = msg.spawnIntervalMs;
      state.catchWindowMs = msg.catchWindowMs;
      state.dailyQuests = msg.dailyQuests || [];
      state.dailyReward = msg.dailyReward || null;
      state.bossState = msg.bossState || { active: false, nextSpawnAt: null, lastBossName: null, lastLeaderboard: [] };
      state.bossAttacked = !!msg.bossAttacked;
      fire('init', { ...state, dailyReward: state.dailyReward });
      if (msg.offlineResults && msg.offlineResults.length) fire('offline', msg.offlineResults);
      return;
    }
    if (msg.type === 'legendary_alert') {
      fire('legendary_alert', msg);
      return;
    }
    if (msg.type === 'legendary_first_catch') {
      fire('legendary_first_catch', msg);
      return;
    }
    if (msg.type === 'achievement_broadcast') {
      fire('achievement_broadcast', msg);
      return;
    }
    if (msg.type === 'daily_quests') {
      state.dailyQuests = msg.quests || [];
      fire('daily_quests', state.dailyQuests);
      return;
    }
    if (msg.type === 'profile') {
      fire('profile', msg.profile);
      return;
    }
    if (msg.type === 'market_listings') {
      state.marketListings = msg.listings || [];
      fire('market_listings', state.marketListings);
      return;
    }
    if (msg.type === 'market_result') {
      if (msg.user) state.user = msg.user;
      if (msg.caught) state.caught = msg.caught;
      fire('market_result', msg);
      return;
    }
    if (msg.type === 'crystal_packages') {
      state.crystalPackages = msg.packages || [];
      fire('crystal_packages', state.crystalPackages);
      return;
    }
    if (msg.type === 'players_list') {
      fire('players_list', msg.players);
      return;
    }
    if (msg.type === 'shop') {
      state.shopItems = msg.items || [];
      state.crystalShopItems = msg.crystalItems || [];
      fire('shop', state.shopItems);
      return;
    }
    if (msg.type === 'npcs') {
      state.npcs = msg.npcs || [];
      fire('npcs', state.npcs);
      return;
    }
    if (msg.type === 'battle_state') {
      if (msg.user) state.user = msg.user;
      if (msg.caught) state.caught = msg.caught;
      // Only update state.battle if we got a battle back (preserve null on errors w/o data)
      if (msg.battle !== undefined) state.battle = msg.battle;
      fire('battle_state', msg);
      return;
    }
    if (msg.type === 'buy_result') {
      if (msg.ok && msg.user) state.user = msg.user;
      fire('buy_result', msg);
      return;
    }
    if (msg.type === 'egg_data') {
      state.eggTiers = msg.eggTiers;
      state.incubatorTiers = msg.incubatorTiers;
      fire('egg_data', msg);
      return;
    }
    if (msg.type === 'egg_action_result') {
      if (msg.ok && msg.user) state.user = msg.user;
      if (msg.ok && msg.caught) state.caught = msg.caught;
      fire('egg_action_result', msg);
      return;
    }
    if (msg.type === 'train_result') {
      if (msg.ok && msg.user) state.user = msg.user;
      if (msg.ok) {
        // Update local caught list
        const inst = state.caught.find(c => c.id === msg.caughtId);
        if (inst) { inst.level = msg.newLevel; inst.xp = msg.newXp; }
      }
      fire('train_result', msg);
      return;
    }
    if (msg.type === 'spawn_start') {
      state.spawn = msg.spawn;
      state.myAttempt = null;
      fire('spawn_start', msg.spawn);
      return;
    }
    if (msg.type === 'attempt_update') {
      state.myAttempt = msg.attempt;
      fire('attempt_update', msg.attempt);
      return;
    }
    if (msg.type === 'choose_ball_result') {
      if (msg.user) state.user = msg.user;
      state.myAttempt = msg.attempt;
      fire('choose_ball_result', msg);
      return;
    }
    if (msg.type === 'spawn_result') {
      if (msg.user) state.user = msg.user;
      if (msg.dailyQuests) state.dailyQuests = msg.dailyQuests;
      // Append caught locally if successful
      if (msg.result && msg.result.caught) {
        const p = GameData.POKEMON_BY_ID[msg.pokemonId];
        // Use the real caughtId from the server so it matches the DB row.
        // Fallback to a string placeholder only if the server didn't send one (older deploys).
        const realId = msg.result.caughtId;
        const inst = {
          id: (realId != null) ? realId : ('live_' + Date.now()),
          pokemonId: msg.pokemonId,
          ivs: msg.result.ivs,
          ivTotal: ivTotalFromObj(msg.result.ivs),
          isShiny: msg.result.isShiny,
          ball: msg.result.ball,
          caughtAt: Date.now(),
          moves: msg.result.moves || [],
          level: 5,
          xp: 0,
          upgrades: 0,
        };
        state.caught.unshift(inst);
        state.pokedex[msg.pokemonId] = (state.pokedex[msg.pokemonId] || 0) + 1;
      }
      fire('spawn_result', msg);
      return;
    }
    if (msg.type === 'spawn_end') {
      state.spawn = null;
      state.nextSpawnAt = msg.nextSpawnAt || (Date.now() + 15000);
      fire('spawn_end', msg);
      return;
    }
    if (msg.type === 'chat') {
      state.chat.push(msg.message);
      if (state.chat.length > 100) state.chat = state.chat.slice(-100);
      fire('chat', msg.message);
      return;
    }
    if (msg.type === 'leaderboards') { fire('leaderboards', msg.boards); return; }
    if (msg.type === 'user_update') { state.user = msg.user; fire('user_update', msg.user); return; }
    if (msg.type === 'error') { fire('error', msg.message); return; }
    if (msg.type === 'avatar_catalog') { fire('avatar_catalog', msg.avatars || []); return; }
    if (msg.type === 'avatar_result') {
      if (msg.user) state.user = msg.user;
      fire('avatar_result', msg);
      return;
    }
    if (msg.type === 'arena_state') { fire('arena_state', msg); return; }
    if (msg.type === 'arena_turn') { fire('arena_turn', msg); return; }
    if (msg.type === 'battle_preview') { fire('battle_preview', msg); return; }
    if (msg.type === 'arena_finish') {
      if (msg.user) state.user = msg.user;
      if (msg.caught) state.caught = msg.caught;
      fire('arena_finish', msg);
      return;
    }
    if (msg.type === 'upgrade_result') {
      if (msg.ok && msg.user) state.user = msg.user;
      if (msg.ok && msg.caught) state.caught = msg.caught;
      fire('upgrade_result', msg);
      return;
    }
    if (msg.type === 'sell_result') {
      if (msg.ok && msg.user) state.user = msg.user;
      if (msg.ok && msg.caught) state.caught = msg.caught;
      fire('sell_result', msg);
      return;
    }
    if (msg.type === 'admin_logs') { fire('admin_logs', msg.logs || []); return; }
    if (msg.type === 'admin_players') { fire('admin_players', msg.players || []); return; }
    if (msg.type === 'admin_player_detail') { fire('admin_player_detail', msg); return; }
    if (msg.type === 'admin_result') { fire('admin_result', msg); return; }
    if (msg.type === 'admin_gift_received') { fire('admin_gift_received', msg); return; }
    if (msg.type === 'admin_stats') { fire('admin_stats', msg.stats); return; }
    if (msg.type === 'admin_online') { fire('admin_online', msg.players || []); return; }
    if (msg.type === 'bug_report_result') { fire('bug_report_result', msg); return; }
    if (msg.type === 'feedback_result') { fire('feedback_result', msg); return; }
    if (msg.type === 'admin_bugs') { fire('admin_bugs', msg.reports || []); return; }
    if (msg.type === 'admin_feedback') { fire('admin_feedback', msg.entries || []); return; }
    if (msg.type === 'admin_cheat_flags') { fire('admin_cheat_flags', msg.flags || []); return; }
    if (msg.type === 'admin_crystal_audit') { fire('admin_crystal_audit', msg.entries || []); return; }
    if (msg.type === 'admin_user_logs') { fire('admin_user_logs', msg); return; }
    if (msg.type === 'boss_spawn') { state.bossState = msg.boss; state.bossAttacked = false; fire('boss_spawn', msg); return; }
    if (msg.type === 'boss_update') { state.bossState = msg.boss; fire('boss_update', msg); return; }
    if (msg.type === 'boss_ended') { state.bossState = { active: false, nextSpawnAt: msg.nextSpawnAt, lastBossName: msg.bossName, lastLeaderboard: msg.leaderboard || [] }; state.bossAttacked = false; fire('boss_ended', msg); return; }
    if (msg.type === 'boss_attack_result') {
      if (msg.ok) state.bossAttacked = true;
      fire('boss_attack_result', msg);
      return;
    }
    if (msg.type === 'boss_state') { state.bossState = msg.boss; state.bossAttacked = !!msg.attacked; fire('boss_state', msg); return; }
    if (msg.type === 'maintenance') { fire('maintenance', msg); return; }
    if (msg.type === 'force_reload') { fire('force_reload', msg); return; }
    if (msg.type === 'version_update') { fire('version_update', msg); return; }
    if (msg.type === 'chat_deleted') { fire('chat_deleted', msg); return; }
    if (msg.type === 'banned') { fire('banned', msg); return; }
  }

  function ivTotalFromObj(ivs) { return ivs.hp + ivs.atk + ivs.def + ivs.spAtk + ivs.spDef + ivs.spd; }

  return {
    register, login, autoLogin, logout,
    connect, send, on, state,
    chooseBall: (ballId) => send('choose_ball', { ballId }),
    setDefaultBall: (ballId) => send('set_default_ball', { ballId }),
    chat: (text) => send('chat', { text }),
    fetchLeaderboards: () => send('leaderboards'),
    fetchDailyQuests: () => send('request_daily_quests'),
    fetchShop: () => send('request_shop'),
    buyItem: (itemId) => send('buy_item', { itemId }),
    setParty: (party) => send('set_party', { party }),
    startTower: () => send('start_tower'),
    startPvp: (targetUserId) => send('start_pvp', { targetUserId }),
    arenaForfeit: () => send('arena_forfeit'),
    arenaGet: () => send('arena_get'),
    fetchMarket: () => send('request_market'),
    listPokemon: (caughtId, currency, price) => send('list_pokemon', { caughtId, currency, price }),
    cancelListing: (listingId) => send('cancel_listing', { listingId }),
    buyListing: (listingId) => send('buy_listing', { listingId }),
    fetchCrystalPackages: () => send('request_crystal_packages'),
    buyCrystalsDemo: (packageId) => send('buy_crystals_demo', { packageId }),
    requestProfile: (userId, username) => send('request_profile', { userId, username }),
    listPlayers: () => send('list_players'),
    setGender: (gender) => send('set_gender', { gender }),
    setBio: (bio) => send('set_bio', { bio }),
    battleMove: (moveId) => send('battle_move', { moveId }),
    battleForfeit: () => send('battle_forfeit'),
    fetchEggData: () => send('request_egg_data'),
    placeEgg: (eggId, incubatorTier, slotIdx) => send('place_egg', { eggId, incubatorTier, slotIdx }),
    hatchEgg: (incubatorTier, slotIdx) => send('hatch_egg', { incubatorTier, slotIdx }),
    buyIncubator: (tier) => send('buy_incubator', { tier }),
    buyEgg: (tier) => send('buy_egg', { tier }),
    // Admin
    adminGetPlayers: () => send('admin_get_players'),
    adminSendGift: (userId, giftType, amount) => send('admin_send_gift', { userId, giftType, amount }),
    adminGetPlayerDetail: (userId) => send('admin_get_player_detail', { userId }),
    adminBanUser: (userId, reason) => send('admin_ban_user', { userId, reason }),
    adminUnbanUser: (userId) => send('admin_unban_user', { userId }),
    adminGetLogs: (limit) => send('admin_get_logs', { limit }),
    adminGetStats: () => send('admin_get_stats'),
    adminGetOnline: () => send('admin_get_online'),
    adminMaintenance: (enabled, message) => send('admin_maintenance', { enabled, message }),
    adminResetPlayer: (userId) => send('admin_reset_player', { userId }),
    adminSetLevel: (userId, level) => send('admin_set_level', { userId, level }),
    adminDeleteChat: (chatId) => send('admin_delete_chat', { chatId }),
    adminWipeLeaderboard: (userId) => send('admin_wipe_leaderboard', { userId }),
    adminForceUpdate: (reason) => send('admin_force_update', { reason }),
    adminGetBugs: () => send('admin_get_bugs'),
    adminGetFeedback: () => send('admin_get_feedback'),
    adminGetCheatFlags: () => send('admin_get_cheat_flags'),
    adminGetCrystalAudit: () => send('admin_get_crystal_audit'),
    adminGetUserLogs: (userId) => send('admin_get_user_logs', { userId }),
    bossAttack: () => send('boss_attack'),
    requestBossState: () => send('boss_state'),
    adminSpawnBoss: (speciesId) => send('admin_spawn_boss', { speciesId }),
    upgradePokemon: (targetId, materialId) => send('upgrade_pokemon', { targetId, materialId }),
    sellPokemon: (caughtId) => send('sell_pokemon', { caughtId }),
    submitBugReport: (message) => send('submit_bug_report', { message }),
    submitFeedback: (message, rating) => send('submit_feedback', { message, rating }),
    ivTotal: ivTotalFromObj,
  };
})();

Object.freeze(Net);
Object.defineProperty(window, 'Net', { value: Net, writable: false, configurable: false });
