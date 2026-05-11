// server/anticheat.js
// Anti-cheat flag system — tracks suspicious activity per user.
// Flags accumulate and decay at 1/min. Auto-ban at 50 flags.

const adminLogs = require('./admin-logs');

// In-memory flag tracking
const _flags = {};      // userId -> { count, lastFlagAt }
const _flagLog = [];     // { userId, username, type, detail, ts }
const MAX_FLAG_LOG = 500;

// Value caps — absolute maximums for any user
const CAPS = {
  gold: 99_999_999,
  crystals: 99_999_999,
  level: 50,
  ball_pokeball: 9999,
  ball_superball: 9999,
  ball_hyperball: 9999,
  ball_masterball: 999,
  ball_afkball: 9999,
  streak: 9999,
  best_streak: 9999,
  pvp_wins: 99999,
  pvp_losses: 99999,
  tower_best_floor: 999,
};

// Rate limits — actions per time window
const RATE_LIMITS = {
  // catches per minute (server-enforced via spawn timer, but belt-and-suspenders)
  catch: { window: 60_000, max: 5 },
  // battles per minute
  battle: { window: 60_000, max: 20 },
  // market trades per minute
  trade: { window: 60_000, max: 10 },
  // crystal purchases per 5 minutes
  crystal_buy: { window: 300_000, max: 5 },
};
const _rateBuckets = {}; // userId -> { type -> [timestamps] }

/**
 * Add cheat flags to a user.
 * @param {object} user - { id, username }
 * @param {string} type - flag category
 * @param {string} detail - human-readable description
 * @param {number} weight - flag count (default 1)
 * @returns {{ flagged: boolean, totalFlags: number, banned: boolean }}
 */
function flag(user, type, detail, weight = 1) {
  const now = Date.now();
  if (!_flags[user.id]) _flags[user.id] = { count: 0, lastFlagAt: now };
  const f = _flags[user.id];

  // Decay existing flags at 1/min
  const elapsed = (now - f.lastFlagAt) / 60_000;
  f.count = Math.max(0, f.count - Math.floor(elapsed));

  f.count += weight;
  f.lastFlagAt = now;

  // Log
  _flagLog.push({ userId: user.id, username: user.username, type, detail, ts: now });
  if (_flagLog.length > MAX_FLAG_LOG) _flagLog.splice(0, _flagLog.length - MAX_FLAG_LOG);

  console.warn(`[ANTI-CHEAT] ${user.username} (id:${user.id}) +${weight} flag [${type}]: ${detail} (total: ${f.count})`);

  const banned = f.count >= 50;
  if (banned) {
    adminLogs.log('anticheat_autoban', { id: user.id, username: user.username },
      `Auto-banned after ${f.count} flags. Last: [${type}] ${detail}`);
  }

  return { flagged: true, totalFlags: f.count, banned };
}

/**
 * Get current flag count for a user (with decay).
 */
function getFlags(userId) {
  const f = _flags[userId];
  if (!f) return 0;
  const elapsed = (Date.now() - f.lastFlagAt) / 60_000;
  return Math.max(0, f.count - Math.floor(elapsed));
}

/**
 * Clear all flags for a user (admin unban).
 */
function clearFlags(userId) {
  delete _flags[userId];
}

/**
 * Get recent flag log entries (for admin panel).
 */
function getFlagLog(limit = 100) {
  return _flagLog.slice(-limit).reverse();
}

/**
 * Enforce value caps on a user object. Silently clamps and flags if over.
 * @param {object} user - user row from data.users
 * @returns {string[]} list of violations found
 */
function enforceValueCaps(user) {
  const violations = [];
  for (const [key, max] of Object.entries(CAPS)) {
    if (typeof user[key] === 'number' && user[key] > max) {
      violations.push(`${key}: ${user[key]} > ${max}`);
      user[key] = max;
    }
    // Also enforce non-negative for currencies/resources
    if (typeof user[key] === 'number' && user[key] < 0 &&
        ['gold', 'crystals', 'ball_pokeball', 'ball_superball', 'ball_hyperball', 'ball_masterball', 'ball_afkball'].includes(key)) {
      violations.push(`${key}: negative (${user[key]})`);
      user[key] = 0;
    }
  }
  if (violations.length) {
    flag(user, 'value_cap', violations.join('; '), Math.min(violations.length * 2, 10));
  }
  return violations;
}

/**
 * Check rate limit for an action.
 * @param {number} userId
 * @param {string} action - key in RATE_LIMITS
 * @returns {boolean} true if allowed, false if rate-limited
 */
function checkRate(userId, action) {
  const limit = RATE_LIMITS[action];
  if (!limit) return true;

  if (!_rateBuckets[userId]) _rateBuckets[userId] = {};
  if (!_rateBuckets[userId][action]) _rateBuckets[userId][action] = [];

  const now = Date.now();
  const bucket = _rateBuckets[userId][action];

  // Clean old entries
  while (bucket.length && bucket[0] < now - limit.window) bucket.shift();

  if (bucket.length >= limit.max) return false;

  bucket.push(now);
  return true;
}

/**
 * Validate caught Pokemon IVs — ensure they're in valid range.
 * @param {object} ivs - { hp, atk, def, spAtk, spDef, spd }
 * @returns {boolean} valid
 */
function validateIVs(ivs) {
  if (!ivs || typeof ivs !== 'object') return false;
  for (const key of ['hp', 'atk', 'def', 'spAtk', 'spDef', 'spd']) {
    const v = ivs[key];
    if (typeof v !== 'number' || v < 0 || v > 31 || v !== Math.floor(v)) return false;
  }
  return true;
}

/**
 * Validate a trade/market transaction — flag if suspiciously lopsided.
 * @param {object} seller - { id, username, level }
 * @param {object} buyer - { id, username, level }
 * @param {number} price - trade price
 * @param {string} currency - 'gold' or 'crystals'
 */
function validateTrade(seller, buyer, price, currency) {
  // Flag extremely high prices (possible RMT/wash trading)
  const maxPrice = currency === 'crystals' ? 50000 : 5_000_000;
  if (price > maxPrice) {
    flag(seller, 'suspicious_trade', `Listed for ${price} ${currency} (max: ${maxPrice})`, 2);
    flag(buyer, 'suspicious_trade', `Bought for ${price} ${currency} (max: ${maxPrice})`, 2);
  }
}

// Periodic cleanup of old rate buckets (every 5 min)
setInterval(() => {
  const cutoff = Date.now() - 600_000;
  for (const uid of Object.keys(_rateBuckets)) {
    for (const action of Object.keys(_rateBuckets[uid])) {
      _rateBuckets[uid][action] = _rateBuckets[uid][action].filter(t => t > cutoff);
      if (!_rateBuckets[uid][action].length) delete _rateBuckets[uid][action];
    }
    if (!Object.keys(_rateBuckets[uid]).length) delete _rateBuckets[uid];
  }
}, 300_000).unref();

module.exports = {
  flag, getFlags, clearFlags, getFlagLog,
  enforceValueCaps, checkRate, validateIVs, validateTrade,
  CAPS, RATE_LIMITS,
};
