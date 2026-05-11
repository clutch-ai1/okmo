// server/security.js
// Defensive measures: rate limiting (HTTP + WS), input validation helpers.

const adminLogs = require('./admin-logs');

// ============ WS Rate limiter ============
// Sliding-window per socket. Two layers:
//   - global: max GLOBAL_LIMIT messages in GLOBAL_WINDOW ms
//   - per-type: chat is the most spam-prone, gets its own bucket
const GLOBAL_LIMIT  = 40;     // 40 msgs per 3s
const GLOBAL_WINDOW = 3000;
const CHAT_LIMIT    = 5;      // 5 chat msgs per 10s
const CHAT_WINDOW   = 10000;
const ADMIN_LIMIT   = 30;     // admin actions get a bit more headroom
const ADMIN_WINDOW  = 5000;

function makeBucket() { return { stamps: [] }; }
function checkBucket(bucket, now, limit, window) {
  // Drop stamps older than window
  while (bucket.stamps.length && bucket.stamps[0] <= now - window) bucket.stamps.shift();
  if (bucket.stamps.length >= limit) return false;
  bucket.stamps.push(now);
  return true;
}

/** Attach rate-limit buckets to a fresh WS connection. */
function initWsLimits(ws) {
  ws._rl = {
    global: makeBucket(),
    chat:   makeBucket(),
    admin:  makeBucket(),
    abuses: 0,
  };
}

/**
 * Returns { ok: true } if message allowed, otherwise { ok: false, reason }.
 * `type` is the message.type string. Used to pick the right bucket.
 */
function checkWsMessage(ws, type) {
  if (!ws._rl) initWsLimits(ws);
  const now = Date.now();
  if (!checkBucket(ws._rl.global, now, GLOBAL_LIMIT, GLOBAL_WINDOW)) {
    ws._rl.abuses++;
    return { ok: false, reason: 'Too many requests. Slow down.' };
  }
  if (type === 'chat' && !checkBucket(ws._rl.chat, now, CHAT_LIMIT, CHAT_WINDOW)) {
    ws._rl.abuses++;
    return { ok: false, reason: 'Chat rate limit reached. Wait a moment.' };
  }
  if (typeof type === 'string' && type.indexOf('admin_') === 0) {
    if (!checkBucket(ws._rl.admin, now, ADMIN_LIMIT, ADMIN_WINDOW)) {
      ws._rl.abuses++;
      return { ok: false, reason: 'Admin rate limit reached.' };
    }
  }
  return { ok: true };
}

/** True if the socket has triggered too many abuses and should be force-closed. */
function shouldKickForAbuse(ws) {
  return ws._rl && ws._rl.abuses >= 10;
}

// ============ HTTP Rate limiter (per IP) ============
// Map<ip, { stamps: number[] }>
const httpBuckets = {};
const HTTP_LOGIN_LIMIT     = 10;     // 10 login attempts per minute
const HTTP_LOGIN_WINDOW    = 60000;
const HTTP_REGISTER_LIMIT  = 5;      // 5 registrations per 5 min
const HTTP_REGISTER_WINDOW = 5 * 60 * 1000;

function _key(ip, kind) { return kind + '|' + ip; }
function _checkHttp(ip, kind, limit, window) {
  const k = _key(ip, kind);
  const now = Date.now();
  const b = httpBuckets[k] || (httpBuckets[k] = makeBucket());
  return checkBucket(b, now, limit, window);
}

function getClientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function loginRateLimit(req, res, next) {
  const ip = getClientIp(req);
  if (!_checkHttp(ip, 'login', HTTP_LOGIN_LIMIT, HTTP_LOGIN_WINDOW)) {
    adminLogs.log('rate_limit', null, ip + ' hit login rate limit');
    return res.status(429).json({ ok: false, error: 'Too many login attempts. Try again in a minute.' });
  }
  next();
}
function registerRateLimit(req, res, next) {
  const ip = getClientIp(req);
  if (!_checkHttp(ip, 'register', HTTP_REGISTER_LIMIT, HTTP_REGISTER_WINDOW)) {
    adminLogs.log('rate_limit', null, ip + ' hit register rate limit');
    return res.status(429).json({ ok: false, error: 'Too many registrations from your network. Try again later.' });
  }
  next();
}

// Periodic cleanup so the IP buckets don't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const k of Object.keys(httpBuckets)) {
    const b = httpBuckets[k];
    while (b.stamps.length && b.stamps[0] <= now - HTTP_REGISTER_WINDOW) b.stamps.shift();
    if (b.stamps.length === 0) delete httpBuckets[k];
  }
}, 60000).unref();

// ============ Input validation helpers ============
function isSafeInt(v, min, max) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  if (min != null && n < min) return null;
  if (max != null && n > max) return null;
  return Math.trunc(n);
}
function isSafeString(v, maxLen) {
  if (typeof v !== 'string') return null;
  if (maxLen != null && v.length > maxLen) return v.slice(0, maxLen);
  return v;
}

// ============ Per-user action quotas ============
// Stops a single account from spamming a specific action even if the global rate
// limit is OK. Map<"action|userId", { stamps: number[] }>.
const userQuotas = {};
const QUOTAS = {
  // action          : { limit, windowMs }
  chat              : { limit: 10,  windowMs: 30 * 1000 },
  list_pokemon      : { limit: 5,   windowMs: 60 * 1000 },
  buy_listing       : { limit: 8,   windowMs: 60 * 1000 },
  buy_item          : { limit: 30,  windowMs: 60 * 1000 },
  buy_egg           : { limit: 20,  windowMs: 60 * 1000 },
  buy_incubator     : { limit: 5,   windowMs: 60 * 1000 },
  buy_crystals_demo : { limit: 5,   windowMs: 60 * 1000 },
  set_party         : { limit: 30,  windowMs: 60 * 1000 },
  upgrade_pokemon   : { limit: 10,  windowMs: 60 * 1000 },
  sell_pokemon      : { limit: 20,  windowMs: 60 * 1000 },
  set_bio           : { limit: 5,   windowMs: 60 * 1000 },
  set_gender        : { limit: 5,   windowMs: 60 * 1000 },
  set_formation     : { limit: 30,  windowMs: 60 * 1000 },
  start_tower       : { limit: 20,  windowMs: 60 * 1000 },
  start_pvp         : { limit: 10,  windowMs: 60 * 1000 },
  boss_attack        : { limit: 3,   windowMs: 60 * 1000 },
  boss_state         : { limit: 10,  windowMs: 60 * 1000 },
  start_battle      : { limit: 30,  windowMs: 60 * 1000 },
  request_profile   : { limit: 60,  windowMs: 60 * 1000 },
  request_market    : { limit: 30,  windowMs: 60 * 1000 },
  request_battle_preview : { limit: 30, windowMs: 60 * 1000 },
  request_shop          : { limit: 30,  windowMs: 60 * 1000 },
  request_egg_data      : { limit: 30,  windowMs: 60 * 1000 },
  leaderboards          : { limit: 15,  windowMs: 60 * 1000 },
  request_avatars       : { limit: 15,  windowMs: 60 * 1000 },
};

function checkUserActionQuota(userId, action) {
  const q = QUOTAS[action];
  if (!q) return { ok: true };
  const key = action + '|' + userId;
  const bucket = userQuotas[key] || (userQuotas[key] = { stamps: [] });
  const now = Date.now();
  while (bucket.stamps.length && bucket.stamps[0] <= now - q.windowMs) bucket.stamps.shift();
  if (bucket.stamps.length >= q.limit) {
    return { ok: false, reason: 'Action quota exceeded for ' + action };
  }
  bucket.stamps.push(now);
  return { ok: true };
}

setInterval(() => {
  const now = Date.now();
  for (const k of Object.keys(userQuotas)) {
    const b = userQuotas[k];
    while (b.stamps.length && b.stamps[0] < now - 60 * 60 * 1000) b.stamps.shift();
    if (b.stamps.length === 0) delete userQuotas[k];
  }
}, 5 * 60 * 1000).unref();

const MSG_SCHEMAS = {
  auth: { token: { type: 'string', maxLen: 1024 } },
  choose_ball:        { ballId: { type: 'string', maxLen: 32 } },
  chat:               { text:   { type: 'string', maxLen: 300 } },
  set_party:          { party:  { type: 'array', maxLen: 6 } },
  set_gender:         { gender: { type: 'enum', values: ['male','female'] } },
  set_bio:            { bio:    { type: 'string', maxLen: 200 } },
  set_formation:      { formation: { type: 'array', maxLen: 6 } },
  start_battle:       { npcId: { type: 'string', maxLen: 32 } },
  start_pvp:          { targetUserId: { type: 'int', min: 1, max: 99999999 }, formation: { type: 'array', maxLen: 6, optional: true } },
  start_tower:        { formation: { type: 'array', maxLen: 6, optional: true } },
  battle_move:        { moveId: { type: 'string', maxLen: 32 } },
  request_battle_preview: { kind: { type: 'enum', values: ['tower','pvp'] }, targetUserId: { type: 'int', min: 1, max: 99999999, optional: true } },
  place_egg:          { eggId: { type: 'int', min: 1 }, incubatorTier: { type: 'int', min: 1, max: 10 }, slotIdx: { type: 'int', min: 0, max: 10 } },
  hatch_egg:          { incubatorTier: { type: 'int', min: 1, max: 10 }, slotIdx: { type: 'int', min: 0, max: 10 } },
  buy_egg:            { tier: { type: 'int', min: 1, max: 10 } },
  buy_incubator:      { tier: { type: 'int', min: 1, max: 10 } },
  buy_item:           { itemId: { type: 'string', maxLen: 32 } },
  request_profile:    { userId: { type: 'int', min: 1, max: 99999999, optional: true }, username: { type: 'string', maxLen: 16, optional: true } },
  list_pokemon:       { caughtId: { type: 'int', min: 1 }, currency: { type: 'enum', values: ['gold','crystal'] }, price: { type: 'int', min: 1, max: 9999999 } },
  cancel_listing:     { listingId: { type: 'int', min: 1 } },
  buy_listing:        { listingId: { type: 'int', min: 1 } },
  buy_crystals_demo:  { packageId: { type: 'string', maxLen: 32 } },
  buy_avatar:         { avatarId: { type: 'string', maxLen: 32 } },
  equip_avatar:       { avatarId: { type: 'string', maxLen: 32 } },
  // Read-only / no-param requests
  leaderboards:       {},
  request_daily_quests: {},
  request_shop:       {},
  request_npcs:       {},
  request_avatars:    {},
  request_crystal_packages: {},
  request_egg_data:   {},
  request_market:     {},
  list_players:       {},
  arena_get:          {},
  arena_forfeit:      {},
  battle_get:         {},
  battle_forfeit:     {},
  ping:               {},
  admin_get_logs:     { limit: { type: 'int', min: 1, max: 1000, optional: true } },
  admin_ban_user:     { userId: { type: 'int', min: 1, max: 99999999 }, reason: { type: 'string', maxLen: 200, optional: true } },
  admin_unban_user:   { userId: { type: 'int', min: 1, max: 99999999 } },
  admin_send_gift:    { userId: { type: 'int', min: 1, max: 99999999 }, giftType: { type: 'string', maxLen: 32 }, amount: { type: 'int', min: 1, max: 9999999 } },
  upgrade_pokemon:    { targetId: { type: 'int', min: 1, max: 99999999 }, materialId: { type: 'int', min: 1, max: 99999999 } },
  sell_pokemon:       { caughtId: { type: 'int', min: 1, max: 99999999 } },
  submit_bug_report:  { message: { type: 'string', maxLen: 1000 } },
  submit_feedback:    { message: { type: 'string', maxLen: 1000 }, rating: { type: 'int', min: 1, max: 5 } },
  boss_attack:        {},
  boss_state:         {},
  admin_spawn_boss:   { speciesId: { type: 'string', maxLen: 32, optional: true } },
  admin_get_bugs:     {},
  admin_get_feedback: {},
  admin_get_crystal_audit: {},
  admin_get_user_logs: { userId: { type: 'int', min: 1, max: 99999999 } },
  admin_get_cheat_flags: {},
  admin_get_players:  {},
  admin_get_player_detail: { userId: { type: 'int', min: 1, max: 99999999 } },
  admin_maintenance:  { enabled: { type: 'bool' }, message: { type: 'string', maxLen: 200, optional: true } },
  admin_force_update: { reason: { type: 'string', maxLen: 200, optional: true } },
  admin_get_stats:    {},
  admin_get_online:   {},
  admin_reset_player: { userId: { type: 'int', min: 1, max: 99999999 } },
  admin_set_level:    { userId: { type: 'int', min: 1, max: 99999999 }, level: { type: 'int', min: 1, max: 50 } },
  admin_delete_chat:  { chatId: { type: 'int', min: 1, max: 99999999 } },
  admin_wipe_leaderboard: { userId: { type: 'int', min: 1, max: 99999999 } },
};

function validateMessage(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    return { ok: false, reason: 'Bad message structure' };
  }
  const schema = MSG_SCHEMAS[msg.type];
  if (!schema) return { ok: false, reason: 'Unknown message type: ' + msg.type };
  for (const key of Object.keys(schema)) {
    const rule = schema[key];
    const v = msg[key];
    if (v === undefined || v === null) {
      if (rule.optional) continue;
      return { ok: false, reason: 'Missing field: ' + key };
    }
    if (rule.type === 'int') {
      const n = typeof v === 'number' ? v : parseInt(v, 10);
      if (!Number.isFinite(n)) return { ok: false, reason: 'Bad int: ' + key };
      if (rule.min != null && n < rule.min) return { ok: false, reason: key + ' below min' };
      if (rule.max != null && n > rule.max) return { ok: false, reason: key + ' above max' };
    } else if (rule.type === 'string') {
      if (typeof v !== 'string') return { ok: false, reason: 'Bad string: ' + key };
      if (rule.maxLen != null && v.length > rule.maxLen) return { ok: false, reason: key + ' too long' };
    } else if (rule.type === 'bool') {
      if (typeof v !== 'boolean') return { ok: false, reason: 'Bad bool: ' + key };
    } else if (rule.type === 'array') {
      if (!Array.isArray(v)) return { ok: false, reason: 'Bad array: ' + key };
      if (rule.maxLen != null && v.length > rule.maxLen) return { ok: false, reason: key + ' array too big' };
    } else if (rule.type === 'enum') {
      if (!rule.values.includes(v)) return { ok: false, reason: key + ' not in enum' };
    }
  }
  return { ok: true };
}

function checkJwtSecret() {
  const sec = process.env.JWT_SECRET;
  if (!sec || sec === 'change-me-in-production-please') {
    console.warn('!!  WARNING: Using default JWT_SECRET. Set JWT_SECRET env variable for production.');
  }
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com https://*.paypal.com https://*.paypalobjects.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.paypal.com https://*.paypalobjects.com",
    "img-src 'self' data: https: blob:",
    "media-src 'self' https://www.youtube.com",
    "connect-src 'self' ws: wss: https://*.paypal.com https://*.paypalobjects.com",
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://*.paypal.com",
    "font-src 'self' data: https://fonts.gstatic.com https://*.paypalobjects.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://*.paypal.com",
  ].join('; '));
  next();
}

module.exports = {
  initWsLimits,
  checkWsMessage,
  shouldKickForAbuse,
  validateMessage,
  checkUserActionQuota,
  loginRateLimit,
  registerRateLimit,
  securityHeaders,
  isSafeInt,
  isSafeString,
  checkJwtSecret,
  getClientIp,
};
