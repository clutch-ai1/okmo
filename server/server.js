// server/server.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');

const { db, stmt, data, save, beginBatch, endBatch } = require('./db');
const auth = require('./auth');
const game = require('./game');
const chat = require('./chat');
const leaderboard = require('./leaderboard');
const battle = require('./battle');
const adminLogs = require('./admin-logs');
const security = require('./security');
const arena = require('./arena');
const paypal = require('./paypal');
const avatars = require('./avatars');
const anticheat = require('./anticheat');
const worldboss = require('./worldboss');
const { GameData } = require('./data');

// Track pending PayPal orders so we can verify the package + user when capturing.
const pendingPaypalOrders = new Map();   // orderId -> { userId, packageId, expectedCrystals, createdAt }
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;  // expire after 1 hour
  for (const [k, v] of pendingPaypalOrders) if (v.createdAt < cutoff) pendingPaypalOrders.delete(k);
}, 10 * 60 * 1000).unref();

security.checkJwtSecret();

// ============ Game Version (bump on deploy to force client reload) ============
const GAME_VERSION = process.env.GAME_VERSION || '1.0.0';

// ============ Maintenance Mode ============
let maintenanceMode = false;
let maintenanceMessage = 'Server is under maintenance. Please come back soon.';

function isAdmin(u) { return u && u.username === 'admin'; }

// ============ Seed Admin Account ============
(async function seedAdmin() {
  const bcrypt = require('bcryptjs');
  if (!process.env.ADMIN_PASSWORD) {
    console.error('[admin] ERROR: ADMIN_PASSWORD not set in .env! Admin account will not be created/synced.');
    return;
  }
  const existing = stmt.getUserByName.get('admin');
  if (!existing) {
    console.log('[admin] Creating admin account...');
    try {
      await auth.register('admin', process.env.ADMIN_PASSWORD, 'male');
      console.log('[admin] Admin account created (username: admin)');
    } catch (e) {
      console.warn('[admin] Failed to create admin account:', e.message);
    }
  } else {
    // Ensure password is always synced to the expected value
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
    existing.password_hash = hash;
    // Grant admin crystals if below threshold
    if ((existing.crystals || 0) < 99999) {
      existing.crystals = 99999;
    }
    save();
    console.log('[admin] Admin account exists (id: ' + existing.id + ') — password synced, crystals: ' + existing.crystals);
  }
})();
function userIdToWs(userId) {
  for (const ws of sockets) if (ws.user && ws.user.id === userId) return ws;
  return null;
}

// Called when an arena match concludes (victory, defeat, or forfeit).
// Distributes rewards: gold, xp, bonus balls, tower floor progression, pvp record.
function handleArenaFinish(match) {
  const userId = match.userId;
  const win = match.winner === 'player';
  const user = stmt.getUserById.get(userId);
  if (!user) return;

  if (match.isPvp) {
    stmt.recordPvp.run(userId, win ? 'win' : 'loss');
    if (match.targetUserId) stmt.recordPvp.run(match.targetUserId, win ? 'loss' : 'win');
  }

  if (win) {
    if (match.isTower) {
      user.tower_floor = match.towerFloor;
      if (match.towerFloor > (user.tower_best_floor || 0)) user.tower_best_floor = match.towerFloor;
    }
    if (match.reward && match.reward.gold) stmt.addGold.run(match.reward.gold, userId);
    if (match.reward && match.reward.bonus) {
      const b = match.reward.bonus;
      stmt.awardBall.run(b.ball, b.count, userId);
    }
    // Award XP per surviving party Pokemon
    const xpEach = (match.reward && match.reward.xp) || 0;
    if (xpEach > 0) {
      const fresh = stmt.getUserById.get(userId);
      for (const cid of (fresh.party || [])) {
        const c = stmt.getOneCaught.get(cid, userId);
        if (!c) continue;
        const newXp = (c.xp || 0) + xpEach;
        // Simple levelup: every 100 xp = 1 level (cap 100)
        let lvl = c.level || 5; let xpLeft = newXp;
        while (xpLeft >= 100 && lvl < 100) { xpLeft -= 100; lvl++; }
        stmt.updateCaughtLevel.run(lvl, xpLeft, c.id, userId);
      }
    }
  } else {
    // Loser still gets a token reward to ease the sting
    stmt.addGold.run(5, userId);
  }

  adminLogs.log(match.isTower ? 'tower_end' : 'pvp_end', user,
    (win ? 'WIN' : 'LOSS') + (match.isTower ? ' floor ' + match.towerFloor : '') +
    (match.reward && match.reward.gold ? ' +' + match.reward.gold + 'g' : ''));

  // Notify the client of fresh state
  const refreshed = stmt.getUserById.get(userId);
  const refreshedCaught = stmt.getCaughtByUser.all(userId).map(c => ({
    id: c.id, pokemonId: c.pokemon_id, ivs: JSON.parse(c.ivs_json),
    ivTotal: c.iv_total, isShiny: !!c.is_shiny, ball: c.ball, caughtAt: c.caught_at,
    moves: c.moves_json ? JSON.parse(c.moves_json) : [],
    level: c.level || 5, xp: c.xp || 0,
    upgrades: c.upgrades || 0,
  }));
  const ws = userIdToWs(userId);
  if (ws) {
    send(ws, { type: 'user_update', user: publicUser(refreshed) });
    send(ws, { type: 'arena_finish', match: arena.publicMatch(match), user: publicUser(refreshed), caught: refreshedCaught });
  }
  // Keep the match around for one final state push, then clear after a delay
  setTimeout(() => arena.endMatch(userId), 5000);
}

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || ('http://localhost:' + PORT);

const app = express();
app.use(security.securityHeaders);
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

app.post('/auth/register', security.registerRateLimit, async (req, res) => {
  try {
    const { username, password, gender } = req.body;
    const { user, token } = await auth.register(username, password, gender);
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    adminLogs.log('register', user, 'New account (' + (gender || 'male') + ') IP: ' + ip, { ip });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30*24*3600*1000 });
    res.json({ ok: true, user: publicUser(user), token });
  } catch (e) {
    adminLogs.log('register_fail', null, (req.body && req.body.username) + ': ' + e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});
app.post('/auth/login', security.loginRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body;
    const { user, token } = await auth.login(username, password);
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    adminLogs.log('login', user, 'IP: ' + ip, { ip, level: user.level, gold: user.gold, crystals: user.crystals });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30*24*3600*1000 });
    res.json({ ok: true, user: publicUser(user), token });
  } catch (e) {
    const failIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    adminLogs.log('login_fail', null, (req.body && req.body.username) + ': ' + e.message + ' IP: ' + failIp, { ip: failIp });
    res.status(400).json({ ok: false, error: e.message });
  }
});
app.post('/auth/logout', (req, res) => {
  const tok = req.cookies.token;
  const claims = tok && auth.verifyToken(tok);
  if (claims) {
    const u = stmt.getUserById.get(claims.id);
    if (u) adminLogs.log('logout', u, '');
  }
  res.clearCookie('token'); res.json({ ok: true });
});
app.get('/auth/me', (req, res) => {
  const tok = req.cookies.token || (req.headers.authorization || '').replace(/^Bearer /, '');
  const claims = tok && auth.verifyToken(tok);
  if (!claims) return res.status(401).json({ ok: false });
  const user = stmt.getUserById.get(claims.id);
  if (!user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: publicUser(user) });
});
app.get('/auth/:provider', (req, res) => {
  const url = auth.oauthRedirectUrl(req.params.provider, PUBLIC_URL + '/auth/' + req.params.provider + '/callback');
  if (!url) return res.status(400).send(req.params.provider + ' OAuth not configured. See README.');
  res.redirect(url);
});
app.get('/auth/:provider/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const { user, token } = await auth.exchangeOAuthCode(req.params.provider, code, PUBLIC_URL + '/auth/' + req.params.provider + '/callback');
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30*24*3600*1000 });
    res.redirect('/');
  } catch (e) { res.status(400).send('OAuth failed: ' + e.message); }
});

// ============ PayPal endpoints ============
function _authedUser(req) {
  const tok = req.cookies.token || (req.headers.authorization || '').replace(/^Bearer /, '');
  const claims = tok && auth.verifyToken(tok);
  if (!claims) return null;
  return stmt.getUserById.get(claims.id);
}

// Returns whether PayPal is configured + the public client ID for the browser
app.get('/paypal/config', (req, res) => {
  res.json({
    configured: paypal.isConfigured(),
    clientId: paypal.CLIENT_ID || null,
    mode: paypal.MODE,
  });
});

app.post('/paypal/create-order', async (req, res) => {
  try {
    const u = _authedUser(req);
    if (!u) return res.status(401).json({ ok: false, error: 'Not authenticated' });
    if (u.banned) return res.status(403).json({ ok: false, error: 'Banned' });
    if (!paypal.isConfigured()) return res.status(503).json({ ok: false, error: 'PayPal not configured on server' });
    const packageId = String(req.body && req.body.packageId || '');
    const pkg = CRYSTAL_PACKAGES.find(p => p.id === packageId);
    if (!pkg) return res.status(400).json({ ok: false, error: 'Invalid package' });

    const order = await paypal.createOrder({
      amountUsd: pkg.priceUsd,
      packageId: pkg.id,
      userId: u.id,
    });
    pendingPaypalOrders.set(order.id, {
      userId: u.id, packageId: pkg.id,
      expectedCrystals: pkg.crystals + (pkg.bonus || 0),
      expectedAmountUsd: pkg.priceUsd,
      createdAt: Date.now(),
    });
    adminLogs.log('paypal_order_created', u, pkg.id + ' $' + pkg.priceUsd + ' orderId=' + order.id);
    res.json({ ok: true, orderID: order.id });
  } catch (e) {
    adminLogs.log('paypal_error', null, 'create-order: ' + e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/paypal/capture-order', async (req, res) => {
  try {
    const u = _authedUser(req);
    if (!u) return res.status(401).json({ ok: false, error: 'Not authenticated' });
    if (u.banned) return res.status(403).json({ ok: false, error: 'Banned' });
    const orderId = String(req.body && req.body.orderID || '');
    if (!orderId) return res.status(400).json({ ok: false, error: 'Missing orderID' });
    const pending = pendingPaypalOrders.get(orderId);
    if (!pending) return res.status(400).json({ ok: false, error: 'Unknown order — already captured or expired' });
    if (pending.userId !== u.id) return res.status(403).json({ ok: false, error: 'Not your order' });

    const capture = await paypal.captureOrder(orderId);
    // Verify capture actually completed and amount matches
    const status = capture && capture.status;
    const cap = capture && capture.purchase_units && capture.purchase_units[0]
                && capture.purchase_units[0].payments
                && capture.purchase_units[0].payments.captures
                && capture.purchase_units[0].payments.captures[0];
    const paidValue = cap && cap.amount && parseFloat(cap.amount.value);
    if (status !== 'COMPLETED' || cap.status !== 'COMPLETED') {
      adminLogs.log('paypal_capture_fail', u, orderId + ' status=' + status);
      return res.status(400).json({ ok: false, error: 'Payment not completed' });
    }
    if (Math.abs(paidValue - pending.expectedAmountUsd) > 0.005) {
      adminLogs.log('paypal_amount_mismatch', u, 'paid=' + paidValue + ' expected=' + pending.expectedAmountUsd);
      return res.status(400).json({ ok: false, error: 'Amount mismatch' });
    }

    // Grant crystals — log balance BEFORE and AFTER for dispute proof
    const balanceBefore = u.crystals || 0;
    stmt.addCrystals.run(pending.expectedCrystals, u.id);
    pendingPaypalOrders.delete(orderId);

    // Push refreshed user state to active socket
    const refreshed = stmt.getUserById.get(u.id);
    const balanceAfter = refreshed.crystals || 0;
    const ws = userIdToWs(u.id);
    if (ws) send(ws, { type: 'user_update', user: publicUser(refreshed) });

    adminLogs.log('crystals_buy', u,
      '+' + pending.expectedCrystals + ' crystals (' + pending.packageId + ', PayPal $' + paidValue + ', orderId=' + orderId + ') Balance: ' + balanceBefore + ' → ' + balanceAfter, {
      orderId, packageId: pending.packageId, paidUsd: paidValue,
      crystalsAdded: pending.expectedCrystals,
      balanceBefore, balanceAfter,
      captureId: (cap && cap.id) || null,
    });

    res.json({ ok: true, crystalsAdded: pending.expectedCrystals, newCrystalBalance: balanceAfter });
  } catch (e) {
    adminLogs.log('paypal_error', null, 'capture-order: ' + e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

function publicUser(u) {
  const { xpForLevelUp } = require('./data');
  return {
    id: u.id, username: u.username,
    defaultBall: u.default_ball,
    balls: { afkball: u.ball_afkball, pokeball: u.ball_pokeball, superball: u.ball_superball, hyperball: u.ball_hyperball, masterball: u.ball_masterball },
    totalCatches: u.total_catches, totalThrows: u.total_throws,
    level: u.level || 1, xp: u.xp || 0, xpToNext: xpForLevelUp(u.level || 1),
    streak: u.streak || 0, bestStreak: u.best_streak || 0,
    title: u.title || '', achievements: u.achievements || [],
    legendaryCaught: u.legendary_caught || 0, legendaryFirst: u.legendary_first || 0,
    gold: u.gold || 0, party: u.party || [],
    eggs: u.eggs || [], incubators: u.incubators || [],
    towerFloor: u.tower_floor || 0,
    towerBestFloor: u.tower_best_floor || 0,
    gender: u.gender || 'male',
    bio: u.bio || '',
    crystals: u.crystals || 0,
    pvpWins: u.pvp_wins || 0,
    pvpLosses: u.pvp_losses || 0,
    formation: Array.isArray(u.formation) ? u.formation : [null,null,null,null,null,null],
    avatar: u.avatar || 'default',
    avatarSprite: avatars.resolveSpriteForUser(u),
    ownedAvatars: Array.isArray(u.owned_avatars) ? u.owned_avatars : [],
  };
}

const CRYSTAL_PACKAGES = [
  { id: 'small',    crystals: 200,   priceUsd: 4.99,  label: 'Small',         bonus: 0 },
  { id: 'medium',   crystals: 500,   priceUsd: 9.99,  label: 'Medium',        bonus: 0 },
  { id: 'large',    crystals: 1500,  priceUsd: 24.99, label: 'Large',         bonus: 0 },
  { id: 'whale',    crystals: 5000,  priceUsd: 79.99, label: 'Trainer Vault', bonus: 0 },
];

function publicProfile(targetUser) {
  if (!targetUser) return null;
  const partyMons = (targetUser.party || []).map(id => {
    try {
      const c = stmt.getOneCaught.get(id, targetUser.id);
      if (!c) return null;
      return {
        id: c.id, pokemonId: c.pokemon_id,
        level: c.level || 5, ivTotal: c.iv_total, isShiny: !!c.is_shiny,
        upgrades: c.upgrades || 0,
      };
    } catch (e) { return null; }
  }).filter(Boolean);
  let dexCount = 0;
  try { dexCount = (stmt.getPokedexCounts.all(targetUser.id) || []).length; } catch (e) {}
  let avSprite = null;
  try { avSprite = avatars.resolveSpriteForUser(targetUser); } catch (e) {}
  return {
    id: targetUser.id, username: targetUser.username,
    gender: targetUser.gender || 'male',
    title: targetUser.title || '',
    bio: targetUser.bio || '',
    level: targetUser.level || 1,
    totalCatches: targetUser.total_catches || 0,
    bestStreak: targetUser.best_streak || 0,
    legendaryCaught: targetUser.legendary_caught || 0,
    legendaryFirst: targetUser.legendary_first || 0,
    achievements: (targetUser.achievements || []).length,
    towerBestFloor: targetUser.tower_best_floor || 0,
    pokedexCount: dexCount,
    party: partyMons,
    pvpWins: targetUser.pvp_wins || 0,
    pvpLosses: targetUser.pvp_losses || 0,
    avatar: targetUser.avatar || 'default',
    avatarSprite: avSprite,
  };
}

const SHOP_ITEMS = [
  { id: 'pokeball',   ball: 'pokeball',   count: 1, price: 20,   name: 'Poke Ball' },
  { id: 'pokeball_5', ball: 'pokeball',   count: 5, price: 90,   name: 'Poke Ball x5' },
  { id: 'superball',  ball: 'superball',  count: 1, price: 60,   name: 'Great Ball' },
  { id: 'superball_5',ball: 'superball',  count: 5, price: 270,  name: 'Great Ball x5' },
  { id: 'hyperball',  ball: 'hyperball',  count: 1, price: 150,  name: 'Ultra Ball' },
  { id: 'hyperball_5',ball: 'hyperball',  count: 5, price: 680,  name: 'Ultra Ball x5' },
];

// Crystal-priced premium shop items (paid with the premium currency).
// Master Ball intentionally excluded — too strong for crystals; keep it gold-only.
const CRYSTAL_SHOP_ITEMS = [
  { id: 'c_pokeball_20',  ball: 'pokeball',  count: 20, price: 200, name: 'Poke Ball x20',  desc: 'A small premium pack.' },
  { id: 'c_superball_10', ball: 'superball', count: 10, price: 300, name: 'Great Ball x10', desc: '1.5x catch rate.' },
  { id: 'c_hyperball_10', ball: 'hyperball', count: 10, price: 400, name: 'Ultra Ball x10', desc: '2x catch rate.' },
];

// Static file serving — explicitly whitelist only public assets.
// Serving the project root would expose data.json (the entire DB), package.json,
// node_modules, server source code, etc. Whitelist exact paths instead.
const PROJECT_ROOT = path.join(__dirname, '..');
const STATIC_OPTS = {
  dotfiles: 'deny',
  index: false,
  setHeaders: (res, filePath) => {
    // Block source maps from being served
    if (filePath.endsWith('.map')) {
      res.status(404).end();
    }
  },
};
// Serve index.html at /
app.get('/', (req, res) => res.sendFile(path.join(PROJECT_ROOT, 'index.html')));
// Whitelisted static directories
app.use('/js',     express.static(path.join(PROJECT_ROOT, 'js'), STATIC_OPTS));
app.use('/css',    express.static(path.join(PROJECT_ROOT, 'css'), STATIC_OPTS));
app.use('/assets', express.static(path.join(PROJECT_ROOT, 'assets'), STATIC_OPTS));
// Explicit fallback: 404 anything else (no fall-through to project root)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/auth') && !req.path.startsWith('/ws')) {
    return res.status(404).type('text/plain').send('Not found');
  }
  next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32 * 1024 });
const sockets = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(data);
}
function send(ws, msg) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); }

wss.on('connection', (ws, req) => {
  ws.user = null;
  ws._ip = security.getClientIp(req);
  security.initWsLimits(ws);
  sockets.add(ws);

  ws.on('message', async (raw) => {
    // Hard cap on individual message size — anything bigger is dropped immediately.
    if (raw && raw.length > 16 * 1024) {
      try { ws.close(); } catch (_) {}
      return;
    }
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

    // Rate limit gate
    const gate = security.checkWsMessage(ws, msg.type);
    if (!gate.ok) {
      send(ws, { type: 'error', message: gate.reason });
      if (security.shouldKickForAbuse(ws)) {
        adminLogs.log('rate_kick', ws.user || null, (ws.user ? ws.user.username : ws._ip) + ' kicked for abuse');
        try { ws.close(); } catch (_) {}
      }
      return;
    }

    // Schema validation — kicks back malformed payloads with detailed type/range checks.
    const validation = security.validateMessage(msg);
    if (!validation.ok) {
      adminLogs.log('validation_fail', ws.user || null,
        (ws.user ? ws.user.username : ws._ip) + ' sent ' + msg.type + ' — ' + validation.reason);
      send(ws, { type: 'error', message: 'Invalid request' });
      return;
    }

    // Per-user action quota — only applies to authenticated actions
    if (ws.user) {
      const q = security.checkUserActionQuota(ws.user.id, msg.type);
      if (!q.ok) {
        adminLogs.log('quota_hit', ws.user, msg.type);
        send(ws, { type: 'error', message: q.reason });
        return;
      }
    }

    // Re-check banned flag on every authenticated message: a ban issued mid-session
    // must not let further actions through just because their token is still valid.
    if (ws.user) {
      const fresh = stmt.getUserById.get(ws.user.id);
      if (!fresh || fresh.banned) {
        send(ws, { type: 'banned', reason: fresh ? fresh.banned_reason : '' });
        try { ws.close(); } catch (_) {}
        return;
      }
      // Refresh the cached user reference so balls/gold/etc. reflect current DB state.
      ws.user = fresh;
    }

    if (msg.type === 'auth') {
      const claims = msg.token && auth.verifyToken(msg.token);
      if (!claims) { return send(ws, { type: 'auth_fail' }); }
      const user = stmt.getUserById.get(claims.id);
      if (!user) { return send(ws, { type: 'auth_fail' }); }
      if (user.banned) {
        send(ws, { type: 'banned', reason: user.banned_reason || '' });
        try { ws.close(); } catch (_) {}
        return;
      }
      // Maintenance mode: only admin can connect
      if (maintenanceMode && !isAdmin(user)) {
        send(ws, { type: 'maintenance', enabled: true, message: maintenanceMessage });
        try { ws.close(); } catch (_) {}
        return;
      }
      ws.user = user;
      adminLogs.log('connect', user, '');
      game.registerActiveUser(user.id, ws);
      stmt.updateLastSeen.run(Date.now(), user.id);

      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      let dailyReward = null;
      if (user.last_login_day !== today) {
        const newStreak = (user.last_login_day === yesterday) ? (user.login_streak || 0) + 1 : 1;
        const day = ((newStreak - 1) % 7) + 1;
        const rewards = [
          { gold: 30,  ball: 'pokeball',   count: 3, label: 'Day 1' },
          { gold: 50,  ball: 'pokeball',   count: 5, label: 'Day 2' },
          { gold: 80,  ball: 'superball',  count: 2, label: 'Day 3' },
          { gold: 120, ball: 'superball',  count: 4, label: 'Day 4' },
          { gold: 160, ball: 'hyperball',  count: 2, label: 'Day 5' },
          { gold: 220, ball: 'hyperball',  count: 4, label: 'Day 6' },
          { gold: 500, ball: 'masterball', count: 1, label: 'Day 7' },
        ];
        dailyReward = rewards[day - 1];
        dailyReward.streakDay = day;
        dailyReward.totalStreak = newStreak;
        stmt.addGold.run(dailyReward.gold, user.id);
        stmt.awardBall.run(dailyReward.ball, dailyReward.count, user.id);
        stmt.setLoginStreak.run(today, newStreak, user.id);
      }

      const caught = stmt.getCaughtByUser.all(user.id).map(c => ({
        id: c.id, pokemonId: c.pokemon_id, ivs: JSON.parse(c.ivs_json),
        ivTotal: c.iv_total, isShiny: !!c.is_shiny, ball: c.ball, caughtAt: c.caught_at,
        moves: c.moves_json ? JSON.parse(c.moves_json) : [],
        level: c.level || 5, xp: c.xp || 0,
        upgrades: c.upgrades || 0,
      }));
      const pokedex = {};
      for (const r of stmt.getPokedexCounts.all(user.id)) pokedex[r.pokemon_id] = r.cnt;
      const offlineResults = [];
      const refreshedUser = stmt.getUserById.get(user.id);

      // Anti-cheat: enforce value caps on login
      const capViolations = anticheat.enforceValueCaps(refreshedUser);
      if (capViolations.length) save();

      send(ws, {
        type: 'init',
        gameVersion: GAME_VERSION,
        user: publicUser(refreshedUser),
        caught, pokedex,
        spawn: game.getCurrentSpawnState(),
        myAttempt: game.getMyAttempt(user.id),
        chat: chat.getRecent(),
        offlineResults,
        spawnIntervalMs: game.SPAWN_INTERVAL_MS,
        catchWindowMs: game.CATCH_WINDOW_MS,
        dailyQuests: game.getDailyQuestsForUser(user.id),
        dailyReward,
        bossState: worldboss.getState(),
        bossAttacked: worldboss.hasAttacked(user.id),
      });
      if (game.getCurrentSpawnState() && !game.getMyAttempt(user.id)) {
        game.initUserAttempt(user.id);
        send(ws, { type: 'attempt_update', attempt: game.getMyAttempt(user.id) });
      }
      return;
    }

    if (!ws.user) return send(ws, { type: 'error', message: 'Not authenticated' });
    const u = ws.user;

    // Anti-cheat: check if user is auto-banned by flag accumulation
    if (!isAdmin(u) && anticheat.getFlags(u.id) >= 50) {
      const dbUser = stmt.getUserById.get(u.id);
      if (dbUser && !dbUser.banned) {
        stmt.setBanned.run(true, 'Anti-cheat: auto-banned (50+ flags)', u.id);
        send(ws, { type: 'banned', reason: 'Suspicious activity detected. Please contact support.' });
        try { ws.close(); } catch (_) {}
      }
      return;
    }

    if (msg.type === 'choose_ball') {
      const r = game.chooseBall(u.id, msg.ballId);
      const refreshedUser = stmt.getUserById.get(u.id);
      send(ws, { type: 'choose_ball_result', ok: r.ok, reason: r.reason || null,
                 user: publicUser(refreshedUser), attempt: game.getMyAttempt(u.id) });
      return;
    }
    if (msg.type === 'chat') {
      const text = security.isSafeString(msg.text, 300);
      if (text == null || !text.trim()) return send(ws, { type: 'error', message: 'Empty message' });
      const r = chat.postMessage(u, text);
      if (r.ok) {
        broadcast({ type: 'chat', message: r.message });
        adminLogs.log('chat', u, text.slice(0, 200));
      }
      else send(ws, { type: 'error', message: r.reason });
      return;
    }
    if (msg.type === 'leaderboards') {
      send(ws, { type: 'leaderboards', boards: leaderboard.getLeaderboards() });
      return;
    }
    if (msg.type === 'request_daily_quests') {
      send(ws, { type: 'daily_quests', quests: game.getDailyQuestsForUser(u.id) });
      return;
    }
    if (msg.type === 'set_party') {
      const ids = Array.isArray(msg.party) ? msg.party.filter(id => Number.isFinite(id)).slice(0, 6) : [];
      // Dedupe — same Pokemon can't appear in two slots of the party
      const seen = new Set();
      const unique = ids.filter(id => { if (seen.has(id)) return false; seen.add(id); return true; });
      const valid = unique.filter(id => !!stmt.getOneCaught.get(id, u.id));
      stmt.setUserParty.run(valid, u.id);
      const refreshed = stmt.getUserById.get(u.id);
      send(ws, { type: 'user_update', user: publicUser(refreshed) });
      return;
    }
    if (msg.type === 'request_shop') {
      send(ws, { type: 'shop', items: SHOP_ITEMS, crystalItems: CRYSTAL_SHOP_ITEMS });
      return;
    }
    if (msg.type === 'request_npcs') {
      send(ws, { type: 'npcs', npcs: battle.getNpcs(u.id) });
      return;
    }
    if (msg.type === 'start_battle') {
      const r = battle.startBattle(u.id, msg.npcId);
      if (!r.ok) return send(ws, { type: 'battle_state', ok: false, reason: r.reason, cooldownMs: r.cooldownMs, battle: r.battle || null });
      send(ws, { type: 'battle_state', ok: true, battle: r.battle });
      return;
    }
    if (msg.type === 'start_tower') {
      const formation = Array.isArray(msg.formation) ? msg.formation : null;
      const onFinish = (m) => handleArenaFinish(m);
      const r = arena.startTowerArena(u.id, formation, onFinish);
      if (!r.ok) return send(ws, { type: 'arena_state', ok: false, reason: r.reason });
      adminLogs.log('tower_start', u, 'Floor ' + r.match.towerFloor);
      send(ws, { type: 'arena_state', ok: true, match: arena.publicMatch(r.match) });
      return;
    }
    if (msg.type === 'start_pvp') {
      const targetId = security.isSafeInt(msg.targetUserId, 1, 9999999);
      if (targetId == null) return send(ws, { type: 'arena_state', ok: false, reason: 'Invalid opponent' });
      const formation = Array.isArray(msg.formation) ? msg.formation : null;
      const onFinish = (m) => handleArenaFinish(m);
      const r = arena.startPvpArena(u.id, targetId, formation, onFinish);
      if (!r.ok) return send(ws, { type: 'arena_state', ok: false, reason: r.reason });
      const target = stmt.getUserById.get(targetId);
      adminLogs.log('pvp_start', u, 'vs ' + (target ? target.username : '?'));
      send(ws, { type: 'arena_state', ok: true, match: arena.publicMatch(r.match) });
      return;
    }
    if (msg.type === 'request_avatars') {
      try {
        const catalog = avatars.publicCatalog();
        console.log('[avatars] sending catalog (' + catalog.length + ' items) to user', u && u.username);
        send(ws, { type: 'avatar_catalog', avatars: catalog });
      } catch (e) {
        console.error('[request_avatars] error:', e && e.message);
        send(ws, { type: 'avatar_catalog', avatars: [] });
      }
      return;
    }
    if (msg.type === 'buy_avatar') {
      const avatarId = security.isSafeString(msg.avatarId, 32) || '';
      const av = avatars.getAvatar(avatarId);
      if (!av || avatarId === 'default') return send(ws, { type: 'avatar_result', ok: false, reason: 'Invalid avatar' });
      const fresh = stmt.getUserById.get(u.id);
      if ((fresh.owned_avatars || []).includes(avatarId)) {
        return send(ws, { type: 'avatar_result', ok: false, reason: 'Already owned' });
      }
      if (av.priceCrystals > 0) {
        if (!stmt.spendCrystals.run(av.priceCrystals, u.id)) {
          return send(ws, { type: 'avatar_result', ok: false, reason: 'Not enough crystals' });
        }
      }
      const crystalsBefore = stmt.getUserById.get(u.id).crystals || 0;
      stmt.addOwnedAvatar.run(avatarId, u.id);
      stmt.setAvatar.run(avatarId, u.id);
      const refreshed = stmt.getUserById.get(u.id);
      adminLogs.log('avatar_buy', u, avatarId + ' for ' + av.priceCrystals + ' crystals. Balance: ' + crystalsBefore + ' → ' + refreshed.crystals, {
        avatarId, price: av.priceCrystals, currency: 'crystals', balanceBefore: crystalsBefore, balanceAfter: refreshed.crystals,
      });
      send(ws, { type: 'avatar_result', ok: true, action: 'bought', avatarId, user: publicUser(refreshed) });
      return;
    }
    if (msg.type === 'equip_avatar') {
      const avatarId = security.isSafeString(msg.avatarId, 32) || 'default';
      const fresh = stmt.getUserById.get(u.id);
      if (avatarId !== 'default' && !(fresh.owned_avatars || []).includes(avatarId)) {
        return send(ws, { type: 'avatar_result', ok: false, reason: 'You do not own this avatar' });
      }
      stmt.setAvatar.run(avatarId, u.id);
      const refreshed = stmt.getUserById.get(u.id);
      send(ws, { type: 'avatar_result', ok: true, action: 'equipped', avatarId, user: publicUser(refreshed) });
      return;
    }
    if (msg.type === 'request_battle_preview') {
      const kind = msg.kind === 'pvp' ? 'pvp' : 'tower';
      const targetId = security.isSafeInt(msg.targetUserId, 1, 9999999);
      const r = arena.previewBattle(u.id, kind, targetId);
      send(ws, { type: 'battle_preview', ok: r.ok, reason: r.reason || null, preview: r.preview || null });
      return;
    }
    if (msg.type === 'set_formation') {
      const slots = Array.isArray(msg.formation) ? msg.formation.slice(0, 6) : null;
      if (!slots) return send(ws, { type: 'error', message: 'Invalid formation' });
      // Validate ownership AND deduplicate — same Pokemon can't be in two slots
      const seen = new Set();
      const validated = slots.map(s => {
        const id = parseInt(s, 10);
        if (!Number.isFinite(id)) return null;
        if (seen.has(id)) return null;
        if (!stmt.getOneCaught.get(id, u.id)) return null;
        seen.add(id);
        return id;
      });
      while (validated.length < 6) validated.push(null);
      stmt.setFormation.run(validated, u.id);
      const refreshed = stmt.getUserById.get(u.id);
      send(ws, { type: 'user_update', user: publicUser(refreshed) });
      return;
    }
    if (msg.type === 'arena_get') {
      const m = arena.getMatch(u.id);
      send(ws, { type: 'arena_state', ok: true, match: m ? arena.publicMatch(m) : null });
      return;
    }
    if (msg.type === 'arena_forfeit') {
      const m = arena.forfeitMatch(u.id);
      send(ws, { type: 'arena_state', ok: true, match: m ? arena.publicMatch(m) : null });
      return;
    }
    if (msg.type === 'battle_move') {
      const r = battle.chooseMove(u.id, msg.moveId);
      if (!r.ok) return send(ws, { type: 'battle_state', ok: false, reason: r.reason });
      const b = r.battle;
      if (b.over && b.winner === 'player') {
        const refreshed = stmt.getUserById.get(u.id);
        const refreshedCaught = stmt.getCaughtByUser.all(u.id).map(c => ({
          id: c.id, pokemonId: c.pokemon_id, ivs: JSON.parse(c.ivs_json),
          ivTotal: c.iv_total, isShiny: !!c.is_shiny, ball: c.ball, caughtAt: c.caught_at,
          moves: c.moves_json ? JSON.parse(c.moves_json) : [],
          level: c.level || 5, xp: c.xp || 0,
          upgrades: c.upgrades || 0,
        }));
        send(ws, { type: 'battle_state', ok: true, battle: b, user: publicUser(refreshed), caught: refreshedCaught });
      } else {
        send(ws, { type: 'battle_state', ok: true, battle: b });
      }
      return;
    }
    if (msg.type === 'battle_forfeit') {
      const r = battle.forfeit(u.id);
      send(ws, { type: 'battle_state', ok: true, battle: r.battle || null });
      return;
    }
    if (msg.type === 'battle_get') {
      const b = battle.getBattle(u.id);
      send(ws, { type: 'battle_state', ok: true, battle: b });
      return;
    }
    if (msg.type === 'buy_item') {
      // Try gold-priced items first
      const goldItem = SHOP_ITEMS.find(i => i.id === msg.itemId);
      if (goldItem) {
        const goldBefore = stmt.getUserById.get(u.id).gold || 0;
        const ok = stmt.spendGold.run(goldItem.price, u.id);
        if (!ok) return send(ws, { type: 'buy_result', ok: false, reason: 'Not enough gold' });
        stmt.awardBall.run(goldItem.ball, goldItem.count, u.id);
        const refreshed = stmt.getUserById.get(u.id);
        adminLogs.log('shop_buy', u, goldItem.name + ' for ' + goldItem.price + ' gold. Balance: ' + goldBefore + ' → ' + refreshed.gold, {
          item: goldItem.id, currency: 'gold', price: goldItem.price, balanceBefore: goldBefore, balanceAfter: refreshed.gold,
        });
        return send(ws, { type: 'buy_result', ok: true, item: goldItem, user: publicUser(refreshed) });
      }
      // Then crystal-priced items
      const crystalItem = CRYSTAL_SHOP_ITEMS.find(i => i.id === msg.itemId);
      if (crystalItem) {
        const crystalsBefore = stmt.getUserById.get(u.id).crystals || 0;
        const ok = stmt.spendCrystals.run(crystalItem.price, u.id);
        if (!ok) return send(ws, { type: 'buy_result', ok: false, reason: 'Not enough crystals' });
        stmt.awardBall.run(crystalItem.ball, crystalItem.count, u.id);
        adminLogs.log('shop_buy', u, crystalItem.name + ' for ' + crystalItem.price + ' crystals. Balance: ' + crystalsBefore + ' → ' + (crystalsBefore - crystalItem.price), {
          item: crystalItem.id, currency: 'crystals', price: crystalItem.price, balanceBefore: crystalsBefore, balanceAfter: crystalsBefore - crystalItem.price,
        });
        const refreshed = stmt.getUserById.get(u.id);
        return send(ws, { type: 'buy_result', ok: true, item: crystalItem, user: publicUser(refreshed) });
      }
      return send(ws, { type: 'buy_result', ok: false, reason: 'Unknown item' });
    }
    if (msg.type === 'place_egg') {
      const { eggId, incubatorTier, slotIdx } = msg;
      const user = stmt.getUserById.get(u.id);
      const egg = (user.eggs || []).find(e => e.id === eggId);
      if (!egg) return send(ws, { type: 'egg_action_result', ok: false, reason: 'Egg not found' });
      const inc = (user.incubators || []).find(i => i.tier === incubatorTier);
      if (!inc) return send(ws, { type: 'egg_action_result', ok: false, reason: 'You do not own this incubator' });
      if (slotIdx < 0 || slotIdx >= inc.slots.length) return send(ws, { type: 'egg_action_result', ok: false, reason: 'Invalid slot' });
      if (inc.slots[slotIdx]) return send(ws, { type: 'egg_action_result', ok: false, reason: 'Slot is occupied' });
      const tierDef = require('./data').EGG_TIERS[egg.tier];
      const incDef = require('./data').INCUBATOR_TIERS.find(t => t.tier === incubatorTier);
      const totalMs = Math.round(tierDef.hatchMs / (incDef.speedMult || 1));
      inc.slots[slotIdx] = { eggId: egg.id, eggTier: egg.tier, startedAt: Date.now(), totalMs };
      stmt.removeEgg.run(eggId, u.id);
      stmt.setIncubators.run(user.incubators, u.id);
      const refreshed = stmt.getUserById.get(u.id);
      send(ws, { type: 'egg_action_result', ok: true, action: 'placed', user: publicUser(refreshed) });
      return;
    }
    if (msg.type === 'hatch_egg') {
      const { incubatorTier, slotIdx } = msg;
      const user = stmt.getUserById.get(u.id);
      const inc = (user.incubators || []).find(i => i.tier === incubatorTier);
      if (!inc) return send(ws, { type: 'egg_action_result', ok: false, reason: 'No such incubator' });
      const slot = inc.slots[slotIdx];
      if (!slot) return send(ws, { type: 'egg_action_result', ok: false, reason: 'Slot is empty' });
      const elapsed = Date.now() - slot.startedAt;
      if (elapsed < slot.totalMs) return send(ws, { type: 'egg_action_result', ok: false, reason: 'Egg is not ready yet' });
      const result = require('./data').rollEggHatch(slot.eggTier);
      if (!result) return send(ws, { type: 'egg_action_result', ok: false, reason: 'Could not hatch' });
      const { species, ivs, isShiny } = result;
      const ivT = ivs.hp + ivs.atk + ivs.def + ivs.spAtk + ivs.spDef + ivs.spd;
      const moves = require('./data').rollMoveset(species);
      const inserted = stmt.insertCaught.run(u.id, species.id, JSON.stringify(ivs), ivT, isShiny ? 1 : 0, 'egg', Date.now(), JSON.stringify(moves));
      stmt.incrementCatches.run(u.id);
      inc.slots[slotIdx] = null;
      stmt.setIncubators.run(user.incubators, u.id);
      const refreshed = stmt.getUserById.get(u.id);
      const refreshedCaught = stmt.getCaughtByUser.all(u.id).map(c => ({
        id: c.id, pokemonId: c.pokemon_id, ivs: JSON.parse(c.ivs_json),
        ivTotal: c.iv_total, isShiny: !!c.is_shiny, ball: c.ball, caughtAt: c.caught_at,
        moves: c.moves_json ? JSON.parse(c.moves_json) : [],
        level: c.level || 5, xp: c.xp || 0,
        upgrades: c.upgrades || 0,
      }));
      send(ws, { type: 'egg_action_result', ok: true, action: 'hatched',
        hatch: { speciesId: species.id, name: species.name, spriteUrl: species.spriteUrl, spriteShinyUrl: species.spriteShinyUrl, isShiny, ivTotal: ivT, ivs, moves, eggTier: slot.eggTier, caughtId: inserted.lastInsertRowid },
        user: publicUser(refreshed), caught: refreshedCaught,
      });
      return;
    }
    if (msg.type === 'buy_incubator') {
      const { tier } = msg;
      const incDef = require('./data').INCUBATOR_TIERS.find(t => t.tier === tier);
      if (!incDef || incDef.tier === 1) return send(ws, { type: 'egg_action_result', ok: false, reason: 'Invalid incubator' });
      const user = stmt.getUserById.get(u.id);
      if ((user.incubators || []).find(i => i.tier === tier)) return send(ws, { type: 'egg_action_result', ok: false, reason: 'Already owned' });
      if (!stmt.spendGold.run(incDef.gold, u.id)) return send(ws, { type: 'egg_action_result', ok: false, reason: 'Not enough gold' });
      stmt.buyIncubator.run(tier, incDef.slots, u.id);
      const refreshed = stmt.getUserById.get(u.id);
      send(ws, { type: 'egg_action_result', ok: true, action: 'bought_incubator', user: publicUser(refreshed) });
      return;
    }
    if (msg.type === 'buy_egg') {
      const { tier } = msg;
      const eggDef = require('./data').EGG_TIERS[tier];
      if (!eggDef) return send(ws, { type: 'egg_action_result', ok: false, reason: 'Invalid egg' });
      if (!stmt.spendGold.run(eggDef.shopPrice, u.id)) return send(ws, { type: 'egg_action_result', ok: false, reason: 'Not enough gold' });
      stmt.addEgg.run(tier, u.id);
      const refreshed = stmt.getUserById.get(u.id);
      send(ws, { type: 'egg_action_result', ok: true, action: 'bought_egg', user: publicUser(refreshed) });
      return;
    }
    if (msg.type === 'request_egg_data') {
      const { EGG_TIERS, INCUBATOR_TIERS } = require('./data');
      send(ws, { type: 'egg_data', eggTiers: EGG_TIERS, incubatorTiers: INCUBATOR_TIERS });
      return;
    }
    if (msg.type === 'request_profile') {
      try {
        // If neither userId nor username given, default to the requesting user's own profile.
        const target = msg.userId ? stmt.getUserById.get(msg.userId)
                     : (msg.username ? stmt.getUserByName.get(msg.username)
                     : stmt.getUserById.get(u.id));
        // Hidden users (admin, test accounts) are invisible to everyone except themselves.
        const { isHiddenUser } = require('./db');
        if (target && isHiddenUser(target.username) && target.id !== u.id) {
          return send(ws, { type: 'profile', profile: null });
        }
        send(ws, { type: 'profile', profile: publicProfile(target) });
      } catch (e) {
        console.error('[request_profile] error:', e && e.message);
        send(ws, { type: 'profile', profile: null });
      }
      return;
    }
    if (msg.type === 'list_players') {
      const all = stmt.getAllUsers.all().sort((a,b) => (b.level||1) - (a.level||1)).slice(0, 50);
      send(ws, { type: 'players_list', players: all });
      return;
    }
    if (msg.type === 'set_gender') {
      if (msg.gender === 'male' || msg.gender === 'female') {
        stmt.setGender.run(msg.gender, u.id);
        const refreshed = stmt.getUserById.get(u.id);
        send(ws, { type: 'user_update', user: publicUser(refreshed) });
      }
      return;
    }
    if (msg.type === 'set_bio') {
      const bio = security.isSafeString(msg.bio, 200) || '';
      const safeBio = bio.replace(/[<>"'&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c]));
      stmt.setBio.run(safeBio, u.id);
      const refreshed = stmt.getUserById.get(u.id);
      send(ws, { type: 'user_update', user: publicUser(refreshed) });
      return;
    }
    // ---------- Market / Trade House ----------
    if (msg.type === 'request_market') {
      const { isHiddenUser } = require('./db');
      const listings = stmt.getAllListings.all().map(l => {
        const c = stmt.getOneCaught.get(l.caughtId, l.sellerId);
        const seller = stmt.getUserById.get(l.sellerId);
        if (!c || !seller) return null;
        // Skip listings from hidden users (admin / test accounts)
        if (isHiddenUser(seller.username)) return null;
        return {
          id: l.id, currency: l.currency, price: l.price, listedAt: l.listedAt,
          sellerId: l.sellerId, sellerName: seller.username, sellerGender: seller.gender || 'male',
          pokemon: {
            id: c.id, pokemonId: c.pokemon_id,
            ivs: JSON.parse(c.ivs_json), ivTotal: c.iv_total,
            isShiny: !!c.is_shiny, level: c.level || 5,
            moves: c.moves_json ? JSON.parse(c.moves_json) : [],
            upgrades: c.upgrades || 0,
          },
        };
      }).filter(Boolean);
      send(ws, { type: 'market_listings', listings });
      return;
    }
    if (msg.type === 'list_pokemon') {
      const { currency } = msg;
      if (!['gold', 'crystal'].includes(currency)) return send(ws, { type: 'market_result', ok: false, reason: 'Invalid currency' });
      const caughtId = security.isSafeInt(msg.caughtId, 1, 99999999);
      const p = security.isSafeInt(msg.price, 1, 9999999);
      if (caughtId == null) return send(ws, { type: 'market_result', ok: false, reason: 'Invalid Pokemon id' });
      if (p == null) return send(ws, { type: 'market_result', ok: false, reason: 'Invalid price' });
      const c = stmt.getOneCaught.get(caughtId, u.id);
      if (!c) return send(ws, { type: 'market_result', ok: false, reason: 'You do not own this Pokemon' });
      if (stmt.isCaughtListed.get(caughtId)) return send(ws, { type: 'market_result', ok: false, reason: 'Already listed' });
      const refreshedUser = stmt.getUserById.get(u.id);
      if ((refreshedUser.party || []).includes(caughtId)) return send(ws, { type: 'market_result', ok: false, reason: 'Remove from party first' });
      const listing = stmt.addListing.run(u.id, caughtId, currency, p);
      adminLogs.log('market_list', u, 'Pokemon #' + caughtId + ' for ' + p + ' ' + currency);
      send(ws, { type: 'market_result', ok: true, action: 'listed', listing });
      return;
    }
    if (msg.type === 'cancel_listing') {
      const listingId = security.isSafeInt(msg.listingId, 1, 99999999);
      if (listingId == null) return send(ws, { type: 'market_result', ok: false, reason: 'Invalid listing id' });
      const listing = stmt.getListing.get(listingId);
      if (!listing) return send(ws, { type: 'market_result', ok: false, reason: 'Listing not found' });
      if (listing.sellerId !== u.id) return send(ws, { type: 'market_result', ok: false, reason: 'Not your listing' });
      stmt.removeListing.run(listing.id);
      send(ws, { type: 'market_result', ok: true, action: 'cancelled' });
      return;
    }
    if (msg.type === 'buy_listing') {
      const listingId = security.isSafeInt(msg.listingId, 1, 99999999);
      if (listingId == null) return send(ws, { type: 'market_result', ok: false, reason: 'Invalid listing id' });
      const listing = stmt.getListing.get(listingId);
      if (!listing) return send(ws, { type: 'market_result', ok: false, reason: 'Listing not found' });
      if (listing.sellerId === u.id) return send(ws, { type: 'market_result', ok: false, reason: "Can't buy your own listing" });
      let paid = false;
      if (listing.currency === 'gold') paid = stmt.spendGold.run(listing.price, u.id);
      else if (listing.currency === 'crystal') paid = stmt.spendCrystals.run(listing.price, u.id);
      if (!paid) return send(ws, { type: 'market_result', ok: false, reason: 'Not enough ' + listing.currency });
      const sellerCut = Math.floor(listing.price * 0.95);
      if (listing.currency === 'gold') stmt.addGold.run(sellerCut, listing.sellerId);
      else if (listing.currency === 'crystal') stmt.addCrystals.run(sellerCut, listing.sellerId);
      const transferred = stmt.transferCaught.run(listing.caughtId, listing.sellerId, u.id);
      if (!transferred) {
        // Refund buyer if transfer failed (seller no longer owns the Pokemon)
        if (listing.currency === 'gold') stmt.addGold.run(listing.price, u.id);
        else if (listing.currency === 'crystal') stmt.addCrystals.run(listing.price, u.id);
        stmt.removeListing.run(listing.id);
        return send(ws, { type: 'market_result', ok: false, reason: 'Trade failed — Pokemon is no longer available' });
      }
      stmt.removeListing.run(listing.id);
      stmt.incrementCatches.run(u.id);
      const seller = stmt.getUserById.get(listing.sellerId);
      const buyerRefreshed = stmt.getUserById.get(u.id);
      adminLogs.log('market_buy', u, 'Bought Pokemon #' + listing.caughtId + ' from ' + (seller ? seller.username : '?') + ' for ' + listing.price + ' ' + listing.currency, {
        pokemonId: listing.caughtId, sellerId: listing.sellerId, sellerName: seller ? seller.username : '?',
        price: listing.price, currency: listing.currency, sellerCut,
        buyerBalanceAfter: listing.currency === 'gold' ? buyerRefreshed.gold : buyerRefreshed.crystals,
        sellerBalanceAfter: seller ? (listing.currency === 'gold' ? seller.gold : seller.crystals) : null,
      });
      const refreshed = stmt.getUserById.get(u.id);
      const refreshedCaught = stmt.getCaughtByUser.all(u.id).map(c => ({
        id: c.id, pokemonId: c.pokemon_id, ivs: JSON.parse(c.ivs_json),
        ivTotal: c.iv_total, isShiny: !!c.is_shiny, ball: c.ball, caughtAt: c.caught_at,
        moves: c.moves_json ? JSON.parse(c.moves_json) : [],
        level: c.level || 5, xp: c.xp || 0,
        upgrades: c.upgrades || 0,
      }));
      send(ws, { type: 'market_result', ok: true, action: 'bought', user: publicUser(refreshed), caught: refreshedCaught });
      return;
    }
    if (msg.type === 'request_crystal_packages') {
      send(ws, { type: 'crystal_packages', packages: CRYSTAL_PACKAGES });
      return;
    }
    if (msg.type === 'buy_crystals_demo') {
      const pkg = CRYSTAL_PACKAGES.find(p => p.id === msg.packageId);
      if (!pkg) return send(ws, { type: 'market_result', ok: false, reason: 'Invalid package' });
      if (u.username !== 'admin') {
        return send(ws, { type: 'market_result', ok: false, reason: 'Real payment integration not yet available. Coming soon!' });
      }
      const crystalsBefore = stmt.getUserById.get(u.id).crystals || 0;
      stmt.addCrystals.run(pkg.crystals + pkg.bonus, u.id);
      const refreshed = stmt.getUserById.get(u.id);
      adminLogs.log('crystals_buy', u, '+' + (pkg.crystals + pkg.bonus) + ' crystals (' + pkg.id + ', admin demo). Balance: ' + crystalsBefore + ' → ' + refreshed.crystals, {
        packageId: pkg.id, crystalsAdded: pkg.crystals + pkg.bonus, method: 'admin_demo',
        balanceBefore: crystalsBefore, balanceAfter: refreshed.crystals,
      });
      send(ws, { type: 'market_result', ok: true, action: 'crystals_added', amount: pkg.crystals + pkg.bonus, user: publicUser(refreshed) });
      return;
    }

    // ---------- Pokemon Upgrade ----------
    if (msg.type === 'upgrade_pokemon') {
      const UPGRADE_COSTS = [500, 1500, 3000, 6000, 12000];
      const targetId = security.isSafeInt(msg.targetId, 1, 99999999);
      const materialId = security.isSafeInt(msg.materialId, 1, 99999999);
      if (targetId == null || materialId == null) return send(ws, { type: 'upgrade_result', ok: false, reason: 'Invalid Pokemon id' });
      if (targetId === materialId) return send(ws, { type: 'upgrade_result', ok: false, reason: 'Target and material must be different' });
      const target = stmt.getOneCaught.get(targetId, u.id);
      if (!target) return send(ws, { type: 'upgrade_result', ok: false, reason: 'Target Pokemon not found' });
      const currentUpgrades = target.upgrades || 0;
      if (currentUpgrades >= 5) return send(ws, { type: 'upgrade_result', ok: false, reason: 'Already at max upgrade level' });
      const material = stmt.getOneCaught.get(materialId, u.id);
      if (!material) return send(ws, { type: 'upgrade_result', ok: false, reason: 'Material Pokemon not found' });
      if (target.pokemon_id !== material.pokemon_id) return send(ws, { type: 'upgrade_result', ok: false, reason: 'Material must be the same species' });
      if (material.is_shiny) return send(ws, { type: 'upgrade_result', ok: false, reason: 'Shiny Pokemon cannot be used as upgrade material' });
      const refreshedUser = stmt.getUserById.get(u.id);
      if ((refreshedUser.party || []).includes(materialId)) return send(ws, { type: 'upgrade_result', ok: false, reason: 'Remove material from party first' });
      // Check market listings
      if (stmt.isCaughtListed.get(targetId)) return send(ws, { type: 'upgrade_result', ok: false, reason: 'Target is listed on the market' });
      if (stmt.isCaughtListed.get(materialId)) return send(ws, { type: 'upgrade_result', ok: false, reason: 'Material is listed on the market' });
      const cost = UPGRADE_COSTS[currentUpgrades];
      if ((refreshedUser.gold || 0) < cost) return send(ws, { type: 'upgrade_result', ok: false, reason: 'Not enough gold (need ' + cost + ')' });
      // Execute atomically
      beginBatch();
      const upgraded = stmt.upgradePokemon.run(targetId, u.id, materialId);
      if (!upgraded) { endBatch(); return send(ws, { type: 'upgrade_result', ok: false, reason: 'Upgrade failed' }); }
      stmt.spendGold.run(cost, u.id);
      endBatch();
      const pokemon = GameData.POKEMON_BY_ID[target.pokemon_id];
      adminLogs.log('upgrade_pokemon', u, (pokemon ? pokemon.name : '#' + target.pokemon_id) + ' +' + (currentUpgrades + 1) + ' for ' + cost + ' gold');
      const refreshed = stmt.getUserById.get(u.id);
      const refreshedCaught = stmt.getCaughtByUser.all(u.id).map(c => ({
        id: c.id, pokemonId: c.pokemon_id, ivs: JSON.parse(c.ivs_json),
        ivTotal: c.iv_total, isShiny: !!c.is_shiny, ball: c.ball, caughtAt: c.caught_at,
        moves: c.moves_json ? JSON.parse(c.moves_json) : [],
        level: c.level || 5, xp: c.xp || 0,
        upgrades: c.upgrades || 0,
      }));
      send(ws, { type: 'upgrade_result', ok: true, user: publicUser(refreshed), caught: refreshedCaught });
      return;
    }

    // ---------- Sell Pokemon for Gold ----------
    if (msg.type === 'sell_pokemon') {
      const caughtId = security.isSafeInt(msg.caughtId, 1, 99999999);
      if (caughtId == null) return send(ws, { type: 'sell_result', ok: false, reason: 'Invalid Pokemon id' });
      const target = stmt.getOneCaught.get(caughtId, u.id);
      if (!target) return send(ws, { type: 'sell_result', ok: false, reason: 'Pokemon not found' });
      const refreshedUser = stmt.getUserById.get(u.id);
      if ((refreshedUser.party || []).includes(caughtId)) return send(ws, { type: 'sell_result', ok: false, reason: 'Remove from party first' });
      if (stmt.isCaughtListed.get(caughtId)) return send(ws, { type: 'sell_result', ok: false, reason: 'Pokemon is listed on the market' });
      // Calculate sell price: base by rarity + level bonus, shiny 2x
      const pokemon = GameData.POKEMON_BY_ID[target.pokemon_id];
      const rarity = pokemon ? pokemon.rarity : 1;
      const SELL_BASE = { 1: 5, 2: 15, 3: 30, 4: 75, 5: 150 };
      const base = SELL_BASE[rarity] || 5;
      const lvlBonus = (target.level || 1);
      let price = base + lvlBonus;
      if (target.is_shiny) price *= 2;
      price = Math.floor(price);
      // Execute
      beginBatch();
      const deleted = stmt.deleteCaught.run(caughtId, u.id);
      if (!deleted) { endBatch(); return send(ws, { type: 'sell_result', ok: false, reason: 'Sell failed' }); }
      stmt.addGold.run(price, u.id);
      endBatch();
      adminLogs.log('sell_pokemon', u, (pokemon ? pokemon.name : '#' + target.pokemon_id) + ' sold for ' + price + ' gold' + (target.is_shiny ? ' (shiny)' : ''));
      const refreshed = stmt.getUserById.get(u.id);
      const refreshedCaught = stmt.getCaughtByUser.all(u.id).map(c => ({
        id: c.id, pokemonId: c.pokemon_id, ivs: JSON.parse(c.ivs_json),
        ivTotal: c.iv_total, isShiny: !!c.is_shiny, ball: c.ball, caughtAt: c.caught_at,
        moves: c.moves_json ? JSON.parse(c.moves_json) : [],
        level: c.level || 5, xp: c.xp || 0,
        upgrades: c.upgrades || 0,
      }));
      send(ws, { type: 'sell_result', ok: true, price, pokemonName: pokemon ? pokemon.name : '?', user: publicUser(refreshed), caught: refreshedCaught });
      return;
    }

    // ---------- Bug Report ----------
    if (msg.type === 'submit_bug_report') {
      const text = security.isSafeString(msg.message, 1000);
      if (!text || text.length < 10) return send(ws, { type: 'bug_report_result', ok: false, reason: 'Bug report must be at least 10 characters.' });
      const id = data._meta.nextBugId++;
      data.bugReports.push({
        id, userId: u.id, username: u.username, message: text, createdAt: Date.now(),
      });
      if (data.bugReports.length > 500) data.bugReports = data.bugReports.slice(-500);
      save();
      console.log('[BUG REPORT] ' + u.username + ': ' + text.substring(0, 200));
      send(ws, { type: 'bug_report_result', ok: true });
      return;
    }

    // ---------- Feedback ----------
    if (msg.type === 'submit_feedback') {
      const text = security.isSafeString(msg.message, 1000);
      if (!text || text.length < 5) return send(ws, { type: 'feedback_result', ok: false, reason: 'Feedback must be at least 5 characters.' });
      const rating = Math.max(0, Math.min(5, parseInt(msg.rating) || 0));
      if (rating === 0) return send(ws, { type: 'feedback_result', ok: false, reason: 'Please select a star rating.' });
      const id = data._meta.nextFeedbackId++;
      data.feedback.push({
        id, userId: u.id, username: u.username, message: text, rating, createdAt: Date.now(),
      });
      if (data.feedback.length > 500) data.feedback = data.feedback.slice(-500);
      save();
      console.log('[FEEDBACK] ' + u.username + ' (' + rating + '/5): ' + text.substring(0, 200));
      send(ws, { type: 'feedback_result', ok: true });
      return;
    }

    // ---------- Admin (only username "admin") ----------
    if (msg.type && msg.type.indexOf('admin_') === 0) {
      if (!isAdmin(u)) return send(ws, { type: 'admin_result', ok: false, reason: 'Not authorized' });
    }
    if (msg.type === 'admin_get_logs') {
      send(ws, { type: 'admin_logs', logs: adminLogs.getAll(msg.limit || 500) });
      return;
    }
    if (msg.type === 'admin_get_players') {
      const players = stmt.getAllUsersAdmin.all();
      const onlineIds = new Set();
      for (const w of sockets) if (w.user) onlineIds.add(w.user.id);
      for (const p of players) p.online = onlineIds.has(p.id);
      send(ws, { type: 'admin_players', players });
      return;
    }
    if (msg.type === 'admin_ban_user') {
      const targetId = security.isSafeInt(msg.userId, 1, 9999999);
      if (targetId == null) return send(ws, { type: 'admin_result', ok: false, reason: 'Invalid user id' });
      const reason = security.isSafeString(msg.reason, 200) || '';
      const target = stmt.getUserById.get(targetId);
      if (!target) return send(ws, { type: 'admin_result', ok: false, reason: 'User not found' });
      if (target.username === 'admin') return send(ws, { type: 'admin_result', ok: false, reason: 'Cannot ban admin' });
      stmt.setBanned.run(true, reason, targetId);
      adminLogs.log('admin_ban', u, 'Banned ' + target.username + (reason ? ' (' + reason + ')' : ''));
      const targetWs = userIdToWs(targetId);
      if (targetWs) {
        send(targetWs, { type: 'banned', reason });
        try { targetWs.close(); } catch (_) {}
      }
      send(ws, { type: 'admin_result', ok: true, action: 'banned', userId: targetId });
      return;
    }
    if (msg.type === 'admin_unban_user') {
      const targetId = security.isSafeInt(msg.userId, 1, 9999999);
      if (targetId == null) return send(ws, { type: 'admin_result', ok: false, reason: 'Invalid user id' });
      const target = stmt.getUserById.get(targetId);
      if (!target) return send(ws, { type: 'admin_result', ok: false, reason: 'User not found' });
      stmt.setBanned.run(false, '', targetId);
      anticheat.clearFlags(targetId);
      adminLogs.log('admin_unban', u, 'Unbanned ' + target.username + ' (cheat flags cleared)');
      send(ws, { type: 'admin_result', ok: true, action: 'unbanned', userId: targetId });
      return;
    }
    if (msg.type === 'admin_get_player_detail') {
      const targetId = security.isSafeInt(msg.userId, 1, 9999999);
      if (targetId == null) return send(ws, { type: 'admin_result', ok: false, reason: 'Invalid user id' });
      const target = stmt.getUserById.get(targetId);
      if (!target) return send(ws, { type: 'admin_result', ok: false, reason: 'User not found' });
      // All logs touching this user
      const allLogs = adminLogs.getAll(800);
      const userLogs = allLogs.filter(l => l.userId === targetId || (l.details || '').includes(target.username));
      // Aggregate counts
      const counts = {};
      let totalCrystalsBought = 0;
      for (const l of userLogs) {
        counts[l.type] = (counts[l.type] || 0) + 1;
        if (l.type === 'crystals_buy' && l.userId === targetId) {
          const m = (l.details || '').match(/\+(\d+)/);
          if (m) totalCrystalsBought += parseInt(m[1], 10);
        }
      }
      const caughtCount = stmt.getCaughtByUser.all(targetId).length;
      const onlineIds = new Set();
      for (const w of sockets) if (w.user) onlineIds.add(w.user.id);
      send(ws, {
        type: 'admin_player_detail',
        player: {
          id: target.id, username: target.username, gender: target.gender || 'male',
          title: target.title || '', bio: target.bio || '',
          level: target.level || 1, xp: target.xp || 0,
          gold: target.gold || 0, crystals: target.crystals || 0,
          totalCatches: target.total_catches || 0, totalThrows: target.total_throws || 0,
          legendaryCaught: target.legendary_caught || 0,
          towerBestFloor: target.tower_best_floor || 0,
          pvpWins: target.pvp_wins || 0, pvpLosses: target.pvp_losses || 0,
          balls: { afkball: target.ball_afkball||0, pokeball: target.ball_pokeball||0, superball: target.ball_superball||0, hyperball: target.ball_hyperball||0, masterball: target.ball_masterball||0 },
          createdAt: target.created_at || 0, lastSeen: target.last_seen || 0,
          banned: !!target.banned, bannedReason: target.banned_reason || '', bannedAt: target.banned_at || 0,
          online: onlineIds.has(targetId),
          caughtCount,
          totalCrystalsBought,
          actionCounts: counts,
        },
        logs: userLogs,
      });
      return;
    }
    // ---------- Maintenance Mode ----------
    if (msg.type === 'admin_maintenance') {
      maintenanceMode = !!msg.enabled;
      maintenanceMessage = security.isSafeString(msg.message, 200) || 'Server is under maintenance. Please come back soon.';
      adminLogs.log('admin_maintenance', u, maintenanceMode ? 'ON: ' + maintenanceMessage : 'OFF');
      if (maintenanceMode) {
        for (const w of sockets) {
          if (w.user && !isAdmin(w.user)) {
            send(w, { type: 'maintenance', enabled: true, message: maintenanceMessage });
            try { w.close(); } catch (_) {}
          }
        }
      }
      send(ws, { type: 'admin_result', ok: true, action: 'maintenance', enabled: maintenanceMode });
      return;
    }

    // ---------- Force Update (version bump broadcast) ----------
    if (msg.type === 'admin_force_update') {
      const reason = security.isSafeString(msg.reason, 200) || 'A new update is available!';
      adminLogs.log('admin_force_update', u, reason);
      for (const w of sockets) {
        if (w.user && !isAdmin(w.user)) {
          send(w, { type: 'version_update', reason });
        }
      }
      send(ws, { type: 'admin_result', ok: true, action: 'force_update' });
      return;
    }

    // ---------- Admin: Crystal Audit Trail ----------
    if (msg.type === 'admin_get_crystal_audit') {
      const entries = adminLogs.readAuditTrail(200);
      send(ws, { type: 'admin_crystal_audit', entries });
      return;
    }

    // ---------- Admin: Logs by User ----------
    if (msg.type === 'admin_get_user_logs') {
      const targetId = security.isSafeInt(msg.userId, 1, 9999999);
      if (targetId == null) return send(ws, { type: 'admin_result', ok: false, reason: 'Invalid user id' });
      const entries = adminLogs.getByUser(targetId, 200);
      send(ws, { type: 'admin_user_logs', userId: targetId, entries });
      return;
    }

    // ---------- Admin: Cheat Flags Log ----------
    if (msg.type === 'admin_get_cheat_flags') {
      const flags = anticheat.getFlagLog(100);
      send(ws, { type: 'admin_cheat_flags', flags });
      return;
    }

    // ---------- Admin: Bug Reports ----------
    if (msg.type === 'admin_get_bugs') {
      const reports = (data.bugReports || []).slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
      send(ws, { type: 'admin_bugs', reports });
      return;
    }

    // ---------- Admin: Feedback ----------
    if (msg.type === 'admin_get_feedback') {
      const entries = (data.feedback || []).slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
      send(ws, { type: 'admin_feedback', entries });
      return;
    }

    // ---------- Dashboard Stats ----------
    if (msg.type === 'admin_get_stats') {
      const allUsers = stmt.getAllUsersAdmin.all();
      let onlineCount = 0;
      for (const w of sockets) if (w.user) onlineCount++;
      const totalCatches = allUsers.reduce((s, u) => s + (u.totalCatches || 0), 0);
      const totalGold = allUsers.reduce((s, u) => s + (u.gold || 0), 0);
      const totalCrystals = allUsers.reduce((s, u) => s + (u.crystals || 0), 0);
      const totalPokemon = stmt.getCaughtCount.get();
      const bannedCount = allUsers.filter(u => u.banned).length;
      send(ws, { type: 'admin_stats', stats: {
        totalPlayers: allUsers.length,
        onlinePlayers: onlineCount,
        totalPokemon,
        totalCatches,
        totalGold,
        totalCrystals,
        bannedPlayers: bannedCount,
        maintenanceMode,
        maintenanceMessage,
      }});
      return;
    }

    // ---------- Online Players ----------
    if (msg.type === 'admin_get_online') {
      const online = [];
      for (const w of sockets) {
        if (w.user) online.push({ id: w.user.id, username: w.user.username });
      }
      send(ws, { type: 'admin_online', players: online });
      return;
    }

    // ---------- Reset Player ----------
    if (msg.type === 'admin_reset_player') {
      const targetId = security.isSafeInt(msg.userId, 1, 9999999);
      if (targetId == null) return send(ws, { type: 'admin_result', ok: false, reason: 'Invalid user id' });
      const target = stmt.getUserById.get(targetId);
      if (!target) return send(ws, { type: 'admin_result', ok: false, reason: 'User not found' });
      if (target.username === 'admin') return send(ws, { type: 'admin_result', ok: false, reason: 'Cannot reset admin' });
      // Remove all caught Pokemon
      data.caughtPokemon = data.caughtPokemon.filter(c => c.user_id !== targetId);
      // Remove all market listings
      data.marketListings = (data.marketListings || []).filter(l => l.sellerId !== targetId);
      // Reset user stats
      target.total_catches = 0; target.total_throws = 0;
      target.level = 1; target.xp = 0;
      target.gold = 0; target.crystals = 0;
      target.streak = 0; target.best_streak = 0;
      target.legendary_caught = 0; target.legendary_first = 0;
      target.achievements = []; target.title = '';
      target.party = [];
      target.formation = [null,null,null,null,null,null];
      target.tower_floor = 0; target.tower_best_floor = 0;
      target.pvp_wins = 0; target.pvp_losses = 0;
      target.ball_pokeball = 20; target.ball_superball = 5;
      target.ball_hyperball = 1; target.ball_masterball = 0;
      target.ball_afkball = 10;
      target.eggs = []; target.incubators = [{ tier: 1, slots: [null] }];
      save();
      adminLogs.log('admin_reset', u, 'Reset player ' + target.username);
      const targetWs = userIdToWs(targetId);
      if (targetWs) {
        send(targetWs, { type: 'force_reload', reason: 'Your account has been reset by an administrator.' });
        try { targetWs.close(); } catch (_) {}
      }
      send(ws, { type: 'admin_result', ok: true, action: 'reset', userId: targetId });
      return;
    }

    // ---------- Set Player Level ----------
    if (msg.type === 'admin_set_level') {
      const targetId = security.isSafeInt(msg.userId, 1, 9999999);
      if (targetId == null) return send(ws, { type: 'admin_result', ok: false, reason: 'Invalid user id' });
      const level = security.isSafeInt(msg.level, 1, 50);
      if (level == null) return send(ws, { type: 'admin_result', ok: false, reason: 'Level must be 1-50' });
      const target = stmt.getUserById.get(targetId);
      if (!target) return send(ws, { type: 'admin_result', ok: false, reason: 'User not found' });
      stmt.setLevelXp.run(level, 0, targetId);
      adminLogs.log('admin_set_level', u, 'Set ' + target.username + ' to level ' + level);
      const targetWs = userIdToWs(targetId);
      if (targetWs) {
        const refreshedTarget = stmt.getUserById.get(targetId);
        send(targetWs, { type: 'user_update', user: publicUser(refreshedTarget) });
      }
      send(ws, { type: 'admin_result', ok: true, action: 'set_level', userId: targetId, level });
      return;
    }

    // ---------- Delete Chat Message ----------
    if (msg.type === 'admin_delete_chat') {
      const chatId = security.isSafeInt(msg.chatId, 1, 99999999);
      if (chatId == null) return send(ws, { type: 'admin_result', ok: false, reason: 'Invalid chat id' });
      data.chatMessages = (data.chatMessages || []).filter(m => m.id !== chatId);
      save();
      adminLogs.log('admin_delete_chat', u, 'Deleted chat #' + chatId);
      broadcast({ type: 'chat_deleted', chatId });
      send(ws, { type: 'admin_result', ok: true, action: 'chat_deleted', chatId });
      return;
    }

    // ---------- Leaderboard Wipe ----------
    if (msg.type === 'admin_wipe_leaderboard') {
      const targetId = security.isSafeInt(msg.userId, 1, 9999999);
      if (targetId == null) return send(ws, { type: 'admin_result', ok: false, reason: 'Invalid user id' });
      const target = stmt.getUserById.get(targetId);
      if (!target) return send(ws, { type: 'admin_result', ok: false, reason: 'User not found' });
      target.total_catches = 0; target.best_streak = 0;
      target.legendary_caught = 0; target.legendary_first = 0;
      target.tower_best_floor = 0;
      target.pvp_wins = 0; target.pvp_losses = 0;
      save();
      adminLogs.log('admin_wipe_lb', u, 'Wiped leaderboard stats for ' + target.username);
      send(ws, { type: 'admin_result', ok: true, action: 'leaderboard_wiped', userId: targetId });
      return;
    }

    if (msg.type === 'admin_send_gift') {
      const targetId = security.isSafeInt(msg.userId, 1, 9999999);
      if (targetId == null) return send(ws, { type: 'admin_result', ok: false, reason: 'Invalid user id' });
      const ALLOWED = ['gold', 'crystals', 'pokeball', 'superball', 'hyperball', 'masterball', 'afkball'];
      const giftType = security.isSafeString(msg.giftType, 32) || '';
      if (!ALLOWED.includes(giftType)) return send(ws, { type: 'admin_result', ok: false, reason: 'Invalid gift type' });
      const amount = security.isSafeInt(msg.amount, 1, 9999999);
      if (amount == null) return send(ws, { type: 'admin_result', ok: false, reason: 'Invalid amount' });
      const target = stmt.getUserById.get(targetId);
      if (!target) return send(ws, { type: 'admin_result', ok: false, reason: 'User not found' });
      const beforeVal = giftType === 'gold' ? target.gold : giftType === 'crystals' ? target.crystals : (target['ball_' + giftType] || 0);
      const ok = stmt.adminGrant.run(giftType, amount, targetId);
      if (!ok) return send(ws, { type: 'admin_result', ok: false, reason: 'Invalid gift type' });
      const afterTarget = stmt.getUserById.get(targetId);
      const afterVal = giftType === 'gold' ? afterTarget.gold : giftType === 'crystals' ? afterTarget.crystals : (afterTarget['ball_' + giftType] || 0);
      adminLogs.log('admin_gift', u, 'Sent ' + amount + ' ' + giftType + ' to ' + target.username + '. Balance: ' + beforeVal + ' → ' + afterVal, {
        targetId, targetName: target.username, giftType, amount, balanceBefore: beforeVal, balanceAfter: afterVal,
      });
      const targetWs = userIdToWs(targetId);
      if (targetWs) {
        const refreshedTarget = afterTarget;
        send(targetWs, { type: 'user_update', user: publicUser(refreshedTarget) });
        send(targetWs, { type: 'admin_gift_received', giftType, amount, fromAdmin: true });
      }
      send(ws, { type: 'admin_result', ok: true, action: 'gifted', userId: targetId, giftType, amount });
      return;
    }

    // ---------- World Boss ----------
    if (msg.type === 'boss_state') {
      send(ws, { type: 'boss_state', boss: worldboss.getState(), attacked: worldboss.hasAttacked(u.id) });
      return;
    }
    if (msg.type === 'boss_attack') {
      const party = (u.party || []).slice(0, 6);
      if (!party.length) return send(ws, { type: 'boss_attack_result', ok: false, reason: 'Build a party first' });
      const result = worldboss.attack(u.id, party);
      if (!result.ok) return send(ws, { type: 'boss_attack_result', ok: false, reason: result.reason });
      const refreshed = stmt.getUserById.get(u.id);
      send(ws, { type: 'boss_attack_result', ok: true, result: result, user: publicUser(refreshed) });
      return;
    }
    if (msg.type === 'admin_spawn_boss') {
      if (!isAdmin(u)) return send(ws, { type: 'admin_result', ok: false, reason: 'Not authorized' });
      const speciesId = security.isSafeString(msg.speciesId, 32) || null;
      const boss = worldboss.forceSpawn(speciesId);
      if (!boss) return send(ws, { type: 'admin_result', ok: false, reason: 'Could not spawn boss' });
      adminLogs.log('admin_spawn_boss', u, 'Force-spawned boss: ' + (boss.name || boss.pokemonId));
      send(ws, { type: 'admin_result', ok: true, action: 'boss_spawned', bossName: boss.name });
      return;
    }

    if (msg.type === 'ping') { send(ws, { type: 'pong', t: Date.now() }); return; }
  });

  ws.on('close', () => {
    sockets.delete(ws);
    if (ws.user) {
      stmt.updateLastSeen.run(Date.now(), ws.user.id);
      game.unregisterActiveUser(ws.user.id);
    }
  });
});

arena.startTicking(
  (match, turn) => {
    const ws = userIdToWs(match.userId);
    if (!ws) return;
    send(ws, { type: 'arena_turn', match: arena.publicMatch(match), turn });
  },
  (match) => {
    const ws = userIdToWs(match.userId);
    if (!ws) return;
    send(ws, { type: 'arena_state', ok: true, match: arena.publicMatch(match) });
  }
);

game.startSpawnLoop(
  (msg) => broadcast(msg),
  (spawn, results, progressionByUser) => {
    const pokemonName = (GameData.POKEMON_BY_ID[spawn.pokemonId] || {}).name || ('#' + spawn.pokemonId);
    for (const r of results) {
      const u = stmt.getUserById.get(r.userId);
      if (u) {
        const shinyStr = r.isShiny ? ' shiny' : '';
        const ivStr = (r.ivTotal != null) ? (' IV ' + r.ivTotal) : '';
        if (r.caught) adminLogs.log('catch', u, pokemonName + shinyStr + ivStr);
        else adminLogs.log('catch_fail', u, pokemonName + ' broke free');
      }
      const prog = progressionByUser ? progressionByUser[r.userId] : null;
      for (const ws of sockets) {
        if (ws.user && ws.user.id === r.userId) {
          const refreshedUser = stmt.getUserById.get(r.userId);
          send(ws, { type: 'spawn_result', spawnId: spawn.id, pokemonId: spawn.pokemonId,
            result: r, user: publicUser(refreshedUser), progression: prog,
            dailyQuests: game.getDailyQuestsForUser(r.userId),
            eggDrop: r.eggDrop || null });
          if (prog && prog.achievements && prog.achievements.length) {
            for (const ach of prog.achievements) {
              broadcast({ type: 'achievement_broadcast', username: refreshedUser.username,
                          achievement: ach.name, title: ach.title });
            }
          }
        }
      }
    }
    const catchCount = results.filter(r => r.caught).length;
    const pokemon = GameData.POKEMON_BY_ID[spawn.pokemonId];
    broadcast({ type: 'spawn_end', spawnId: spawn.id, pokemonId: spawn.pokemonId,
                pokemonName: pokemon.name, totalAttempts: results.length, totalCaught: catchCount,
                isLegendary: !!spawn.isLegendary,
                nextSpawnAt: spawn.spawnedAt + game.SPAWN_INTERVAL_MS });
  }
);

// Initialize World Boss system
worldboss.init(broadcast, stmt, data, save, adminLogs, sockets, publicUser);

server.listen(PORT, () => {
  console.log('Pokemon MMO Catcher v' + GAME_VERSION + ' running at ' + PUBLIC_URL);
  console.log('Spawn loop: every ' + (game.SPAWN_INTERVAL_MS/1000) + 's, catch window ' + (game.CATCH_WINDOW_MS/1000) + 's');
  console.log('World Boss: every ' + (worldboss.BOSS_INTERVAL/3600000) + 'h, duration ' + (worldboss.BOSS_DURATION/3600000) + 'h');
  if (paypal.isConfigured()) {
    console.log('PayPal: ' + paypal.MODE + ' mode, client_id=' + paypal.CLIENT_ID.substring(0, 12) + '...');
  } else {
    console.log('PayPal: NOT CONFIGURED — set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to enable crystal purchases');
  }
});

// Graceful shutdown on Ctrl+C
function shutdown() {
  console.log('\n[server] Shutting down...');
  for (const ws of sockets) { try { ws.close(); } catch (_) {} }
  wss.close();
  server.close(() => {
    db.close();
    console.log('[server] Bye!');
    process.exit(0);
  });
  // Force exit after 3 seconds if something hangs
  setTimeout(() => { process.exit(0); }, 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
