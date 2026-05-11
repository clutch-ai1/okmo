// server/db.js
const fs = require('fs');
const path = require('path');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.json');

// Accounts that should never appear in any public listing or leaderboard.
// The admin account is hidden by default; additional test accounts can be added here
// or via the HIDDEN_USERS env var (comma-separated).
const HIDDEN_USERS = new Set(
  ['admin', 'claudetest']
    .concat((process.env.HIDDEN_USERS || '').split(',').map(s => s.trim()).filter(Boolean))
);
function isHiddenUser(username) { return HIDDEN_USERS.has(username); }

let data = {
  users: [], caughtPokemon: [], chatMessages: [], spawns: [], spawnAttempts: [],
  bugReports: [], feedback: [],
  _meta: { nextUserId: 1, nextCaughtId: 1, nextChatId: 1, nextSpawnId: 1, nextBugId: 1, nextFeedbackId: 1 },
};

if (fs.existsSync(DB_PATH)) {
  try {
    data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (!data._meta) data._meta = { nextUserId: 1, nextCaughtId: 1, nextChatId: 1, nextSpawnId: 1 };
    if (!data.users) data.users = [];
    if (!data.caughtPokemon) data.caughtPokemon = [];
    if (!data.chatMessages) data.chatMessages = [];
    if (!data.spawns) data.spawns = [];
    if (!data.spawnAttempts) data.spawnAttempts = [];
  } catch (e) { console.warn('DB file corrupt, starting fresh', e); }
}

let saveTimer = null;
let batchDepth = 0;
function save() {
  if (batchDepth > 0) return; // suppress saves during batch
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = DB_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, DB_PATH);
    } catch (e) { console.warn('save failed', e.message); }
  }, 250);
}
function beginBatch() { batchDepth++; }
function endBatch() { batchDepth = Math.max(0, batchDepth - 1); if (batchDepth === 0) save(); }

for (const u of data.users) {
  if (typeof u.ball_afkball !== 'number') u.ball_afkball = 10;
  if (typeof u.default_ball !== 'string') u.default_ball = 'afkball';
  for (const k of ['ball_pokeball','ball_superball','ball_hyperball','ball_masterball','total_throws','total_catches']) {
    if (typeof u[k] !== 'number') u[k] = 0;
  }
  if (typeof u.xp !== 'number') u.xp = 0;
  if (typeof u.level !== 'number') u.level = 1;
  if (typeof u.streak !== 'number') u.streak = 0;
  if (typeof u.best_streak !== 'number') u.best_streak = 0;
  if (typeof u.legendary_caught !== 'number') u.legendary_caught = 0;
  if (typeof u.legendary_first !== 'number') u.legendary_first = 0;
  if (!Array.isArray(u.achievements)) u.achievements = [];
  if (typeof u.title !== 'string') u.title = '';
  if (!u.daily_quests) u.daily_quests = null;
  if (typeof u.daily_quests_day !== 'string') u.daily_quests_day = '';
  if (typeof u.gold !== 'number') u.gold = 0;
  if (!Array.isArray(u.party)) u.party = [];
  if (!u.npc_cooldowns || typeof u.npc_cooldowns !== 'object') u.npc_cooldowns = {};
  if (typeof u.last_login_day !== 'string') u.last_login_day = '';
  if (typeof u.login_streak !== 'number') u.login_streak = 0;
  if (!Array.isArray(u.eggs)) u.eggs = [];
  if (!Array.isArray(u.incubators)) u.incubators = [{ tier: 1, slots: [null] }];
  if (typeof u._nextEggId !== 'number') u._nextEggId = 1;
  if (typeof u.tower_floor !== 'number') u.tower_floor = 0;
  if (typeof u.tower_best_floor !== 'number') u.tower_best_floor = 0;
  if (typeof u.gender !== 'string') u.gender = 'male';
  if (typeof u.bio !== 'string') u.bio = '';
  if (typeof u.pvp_wins !== 'number') u.pvp_wins = 0;
  if (typeof u.pvp_losses !== 'number') u.pvp_losses = 0;
  if (typeof u.crystals !== 'number') u.crystals = 0;
  if (typeof u.banned !== 'boolean') u.banned = false;
  if (typeof u.banned_reason !== 'string') u.banned_reason = '';
  if (typeof u.banned_at !== 'number') u.banned_at = 0;
  // Avatar system: id of equipped avatar + list of owned premium avatars.
  // 'default' means use the gender-based trainer image.
  if (typeof u.avatar !== 'string') u.avatar = 'default';
  if (!Array.isArray(u.owned_avatars)) u.owned_avatars = [];
  // Battle formation: 6 slots in 2x3 grid (0,1,2 = top row; 3,4,5 = bottom row).
  // Each slot is either a caughtId or null. Default to first 6 of party.
  if (!Array.isArray(u.formation) || u.formation.length !== 6) {
    u.formation = [null, null, null, null, null, null];
    const party = Array.isArray(u.party) ? u.party : [];
    for (let i = 0; i < Math.min(6, party.length); i++) u.formation[i] = party[i];
  }
}
if (!Array.isArray(data.marketListings)) data.marketListings = [];
if (typeof data._meta.nextListingId !== 'number') data._meta.nextListingId = 1;
if (!Array.isArray(data.bugReports)) data.bugReports = [];
if (!Array.isArray(data.feedback)) data.feedback = [];
if (typeof data._meta.nextBugId !== 'number') data._meta.nextBugId = 1;
if (typeof data._meta.nextFeedbackId !== 'number') data._meta.nextFeedbackId = 1;
for (const c of data.caughtPokemon) {
  if (typeof c.level !== 'number') c.level = 5;
  if (typeof c.xp !== 'number') c.xp = 0;
  if (typeof c.moves_json !== 'string') c.moves_json = '[]';
  if (typeof c.upgrades !== 'number') c.upgrades = 0;
}

const stmt = {
  insertUser: { run: (username, password_hash, oauth_provider, oauth_id, created_at, last_seen) => {
    const id = data._meta.nextUserId++;
    const user = {
      id, username, password_hash, oauth_provider, oauth_id, created_at, last_seen,
      default_ball: 'afkball',
      ball_afkball: 10, ball_pokeball: 5, ball_superball: 2, ball_hyperball: 0, ball_masterball: 0,
      total_throws: 0, total_catches: 0,
      xp: 0, level: 1, streak: 0, best_streak: 0,
      legendary_caught: 0, legendary_first: 0,
      achievements: [], title: '',
      daily_quests: null, daily_quests_day: '',
      gold: 0, party: [], npc_cooldowns: {},
      last_login_day: '', login_streak: 0,
      eggs: [], incubators: [{ tier: 1, slots: [null] }], _nextEggId: 1,
      tower_floor: 0, tower_best_floor: 0,
      gender: 'male', bio: '',
    };
    data.users.push(user); save();
    return { lastInsertRowid: id };
  }},
  getUserByName:  { get: (name) => data.users.find(u => u.username === name) },
  getUserById:    { get: (id) => data.users.find(u => u.id === id) },
  getUserByOAuth: { get: (p, oid) => data.users.find(u => u.oauth_provider === p && u.oauth_id === oid) },
  updateLastSeen: { run: (ts, id) => { const u = data.users.find(u=>u.id===id); if (u) { u.last_seen = ts; save(); } } },
  updateDefaultBall: { run: (ball, id) => { const u = data.users.find(u=>u.id===id); if (u) { u.default_ball = ball; save(); } } },
  decrementBall: { run: (b1,b2,b3,b4,b5,userId) => {
    const u = data.users.find(u => u.id === userId);
    if (!u) return;
    const col = 'ball_' + b1;
    if ((u[col] || 0) > 0) u[col] -= 1;
    u.total_throws = (u.total_throws || 0) + 1;
    save();
  }},
  awardBall: { run: (ball, count, userId) => {
    const u = data.users.find(u => u.id === userId);
    if (!u) return;
    const col = 'ball_' + ball;
    if (col in u) u[col] = (u[col] || 0) + count;
    save();
  }},
  incrementCatches: { run: (id) => { const u = data.users.find(u=>u.id===id); if (u) { u.total_catches = (u.total_catches||0) + 1; save(); } } },
  setLevelXp: { run: (level, xp, id) => { const u = data.users.find(u=>u.id===id); if (u) { u.level = level; u.xp = xp; save(); } } },
  setStreak:  { run: (s, b, id) => { const u = data.users.find(u=>u.id===id); if (u) { u.streak = s; if (b!=null) u.best_streak = b; save(); } } },
  setDailyQuests: { run: (qj, day, id) => { const u = data.users.find(u=>u.id===id); if (u) { u.daily_quests = qj; u.daily_quests_day = day; save(); } } },
  addAchievement: { run: (achId, title, id) => { const u = data.users.find(u=>u.id===id); if (u) { if (!u.achievements.includes(achId)) u.achievements.push(achId); if (title) u.title = title; save(); } } },
  setTitle: { run: (title, id) => { const u = data.users.find(u=>u.id===id); if (u) { u.title = title; save(); } } },
  incrementLegendary: { run: (id, isFirst) => { const u = data.users.find(u=>u.id===id); if (u) { u.legendary_caught = (u.legendary_caught||0)+1; if (isFirst) u.legendary_first = (u.legendary_first||0)+1; save(); } } },
  addGold:    { run: (n, id) => { const u = data.users.find(u=>u.id===id); if (u) { u.gold = (u.gold||0)+n; save(); } } },
  spendGold:  { run: (n, id) => { const u = data.users.find(u=>u.id===id); if (!u) return false; if ((u.gold||0)<n) return false; u.gold-=n; save(); return true; } },
  insertCaught: { run: (user_id, pokemon_id, ivs_json, iv_total, is_shiny, ball, caught_at, moves_json) => {
    const id = data._meta.nextCaughtId++;
    data.caughtPokemon.push({ id, user_id, pokemon_id, ivs_json, iv_total, is_shiny, ball, caught_at, moves_json: moves_json||'[]', level: 5, xp: 0, upgrades: 0 });
    save();
    return { lastInsertRowid: id };
  }},
  updateCaughtLevel: { run: (level, xp, id, userId) => {
    const c = data.caughtPokemon.find(c => c.id === id && c.user_id === userId);
    if (c) { c.level = level; c.xp = xp; save(); }
  }},
  setUserParty: { run: (arr, userId) => { const u = data.users.find(u=>u.id===userId); if (u) { u.party = arr.slice(0,6); save(); } } },
  setAvatar: { run: (avatarId, userId) => {
    const u = data.users.find(u => u.id === userId); if (!u) return false;
    u.avatar = String(avatarId || 'default');
    save(); return true;
  }},
  addOwnedAvatar: { run: (avatarId, userId) => {
    const u = data.users.find(u => u.id === userId); if (!u) return false;
    if (!Array.isArray(u.owned_avatars)) u.owned_avatars = [];
    if (!u.owned_avatars.includes(avatarId)) u.owned_avatars.push(avatarId);
    save(); return true;
  }},
  setFormation: { run: (slots, userId) => {
    const u = data.users.find(u=>u.id===userId); if (!u) return false;
    if (!Array.isArray(slots) || slots.length !== 6) return false;
    u.formation = slots.slice(0, 6).map(s => Number.isFinite(s) ? s : null);
    save(); return true;
  }},
  setGender: { run: (gender, userId) => { const u = data.users.find(u=>u.id===userId); if (u) { u.gender = gender; save(); } } },
  setBio: { run: (bio, userId) => { const u = data.users.find(u=>u.id===userId); if (u) { u.bio = String(bio||'').slice(0, 200); save(); } } },
  recordPvp: { run: (userId, result) => {
    const u = data.users.find(u=>u.id===userId); if (!u) return;
    if (result === 'win') u.pvp_wins = (u.pvp_wins||0) + 1;
    else if (result === 'loss') u.pvp_losses = (u.pvp_losses||0) + 1;
    save();
  }},
  // Crystals (premium currency)
  addCrystals: { run: (n, userId) => { const u = data.users.find(u=>u.id===userId); if (u) { u.crystals = (u.crystals||0) + n; save(); } } },
  spendCrystals: { run: (n, userId) => { const u = data.users.find(u=>u.id===userId); if (!u) return false; if ((u.crystals||0) < n) return false; u.crystals -= n; save(); return true; } },
  // Market listings
  addListing: { run: (sellerId, caughtId, currency, price) => {
    if (!Array.isArray(data.marketListings)) data.marketListings = [];
    if (typeof data._meta.nextListingId !== 'number') data._meta.nextListingId = 1;
    const id = data._meta.nextListingId++;
    const listing = { id, sellerId, caughtId, currency, price, listedAt: Date.now() };
    data.marketListings.push(listing);
    save();
    return listing;
  }},
  removeListing: { run: (listingId) => {
    if (!Array.isArray(data.marketListings)) return;
    data.marketListings = data.marketListings.filter(l => l.id !== listingId);
    save();
  }},
  getListing: { get: (listingId) => (data.marketListings || []).find(l => l.id === listingId) },
  getAllListings: { all: () => (data.marketListings || []).slice() },
  isCaughtListed: { get: (caughtId) => (data.marketListings || []).find(l => l.caughtId === caughtId) },
  transferCaught: { run: (caughtId, expectedOwnerId, newOwnerId) => {
    const c = data.caughtPokemon.find(c => c.id === caughtId);
    if (!c) return false;
    if (expectedOwnerId != null && c.user_id !== expectedOwnerId) return false;
    c.user_id = newOwnerId;
    save();
    return true;
  }},
  getAllUsers: { all: () => data.users.filter(u => !isHiddenUser(u.username)).map(u => ({ id: u.id, username: u.username, level: u.level, title: u.title, gender: u.gender, totalCatches: u.total_catches, towerBestFloor: u.tower_best_floor })) },
  // Admin: full user listing with stats, balls, currencies, ban state
  getAllUsersAdmin: { all: () => data.users.map(u => ({
    id: u.id, username: u.username, level: u.level || 1, gender: u.gender || 'male',
    title: u.title || '', totalCatches: u.total_catches || 0, totalThrows: u.total_throws || 0,
    gold: u.gold || 0, crystals: u.crystals || 0,
    balls: { afkball: u.ball_afkball||0, pokeball: u.ball_pokeball||0, superball: u.ball_superball||0, hyperball: u.ball_hyperball||0, masterball: u.ball_masterball||0 },
    towerBestFloor: u.tower_best_floor || 0, pvpWins: u.pvp_wins||0, pvpLosses: u.pvp_losses||0,
    legendaryCaught: u.legendary_caught || 0,
    lastSeen: u.last_seen || 0, createdAt: u.created_at || 0,
    banned: !!u.banned, bannedReason: u.banned_reason || '', bannedAt: u.banned_at || 0,
  })) },
  setBanned: { run: (banned, reason, userId) => {
    const u = data.users.find(u => u.id === userId); if (!u) return false;
    u.banned = !!banned;
    u.banned_reason = banned ? String(reason || '').slice(0, 200) : '';
    u.banned_at = banned ? Date.now() : 0;
    save(); return true;
  }},
  // Admin: grant any item/currency. Type: 'gold' | 'crystals' | 'pokeball' | 'superball' | 'hyperball' | 'masterball' | 'afkball'
  adminGrant: { run: (type, amount, userId) => {
    const u = data.users.find(u => u.id === userId); if (!u) return false;
    const n = parseInt(amount, 10); if (!Number.isFinite(n) || n < 1) return false;
    if (type === 'gold') u.gold = (u.gold||0) + n;
    else if (type === 'crystals') u.crystals = (u.crystals||0) + n;
    else if (['afkball','pokeball','superball','hyperball','masterball'].includes(type)) {
      const col = 'ball_' + type;
      u[col] = (u[col]||0) + n;
    } else return false;
    save(); return true;
  }},
  setNpcCooldown: { run: (npcId, untilTs, userId) => {
    const u = data.users.find(u => u.id === userId); if (!u) return;
    if (!u.npc_cooldowns || typeof u.npc_cooldowns !== 'object') u.npc_cooldowns = {};
    u.npc_cooldowns[npcId] = untilTs; save();
  }},
  evolveCaught: { run: (newSpecies, caughtId, userId) => {
    const c = data.caughtPokemon.find(c => c.id === caughtId && c.user_id === userId);
    if (c) { c.pokemon_id = newSpecies; save(); }
  }},
  setLoginStreak: { run: (day, streak, userId) => {
    const u = data.users.find(u => u.id === userId);
    if (u) { u.last_login_day = day; u.login_streak = streak; save(); }
  }},
  addEgg: { run: (tier, userId) => {
    const u = data.users.find(u => u.id === userId); if (!u) return;
    if (!Array.isArray(u.eggs)) u.eggs = [];
    if (typeof u._nextEggId !== 'number') u._nextEggId = 1;
    const egg = { id: u._nextEggId++, tier, gainedAt: Date.now() };
    u.eggs.push(egg); save();
    return egg;
  }},
  removeEgg: { run: (eggId, userId) => {
    const u = data.users.find(u => u.id === userId); if (!u || !Array.isArray(u.eggs)) return;
    u.eggs = u.eggs.filter(e => e.id !== eggId); save();
  }},
  setIncubators: { run: (incs, userId) => { const u = data.users.find(u=>u.id===userId); if (u) { u.incubators = incs; save(); } } },
  buyIncubator: { run: (tier, slotsCount, userId) => {
    const u = data.users.find(u => u.id === userId); if (!u) return false;
    if (!Array.isArray(u.incubators)) u.incubators = [];
    if (u.incubators.find(i => i.tier === tier)) return false;
    u.incubators.push({ tier, slots: new Array(slotsCount).fill(null) });
    u.incubators.sort((a, b) => a.tier - b.tier); save();
    return true;
  }},
  insertChat: { run: (user_id, username, content, type, payload, sent_at) => {
    const id = data._meta.nextChatId++;
    data.chatMessages.push({ id, user_id, username, content, type, payload, sent_at });
    if (data.chatMessages.length > 500) data.chatMessages = data.chatMessages.slice(-500);
    save(); return { lastInsertRowid: id };
  }},
  getRecentChat: { all: () => [...data.chatMessages].sort((a,b) => b.sent_at - a.sent_at).slice(0, 50) },
  insertSpawn: { run: (pokemon_id, area_id, spawned_at, resolves_at) => {
    const id = data._meta.nextSpawnId++;
    data.spawns.push({ id, pokemon_id, area_id, spawned_at, resolves_at });
    if (data.spawns.length > 500) data.spawns = data.spawns.slice(-500);
    save(); return { lastInsertRowid: id };
  }},
  getCurrentSpawn: { get: () => data.spawns.length ? data.spawns[data.spawns.length-1] : undefined },
  getSpawnsAfter: { all: (sinceTs) => data.spawns.filter(s => s.spawned_at > sinceTs).sort((a,b) => a.spawned_at - b.spawned_at) },
  insertAttempt: { run: (spawn_id, user_id, ball, ivs_json, is_shiny, caught, resolved_at) => {
    const idx = data.spawnAttempts.findIndex(a => a.spawn_id === spawn_id && a.user_id === user_id);
    const row = { spawn_id, user_id, ball, ivs_json, is_shiny, caught, resolved_at };
    if (idx >= 0) data.spawnAttempts[idx] = row; else data.spawnAttempts.push(row);
    save();
  }},
  getAttempt: { get: (sid, uid) => data.spawnAttempts.find(a => a.spawn_id === sid && a.user_id === uid) },
  resolveAttempt: { run: (caught, resolved_at, sid, uid) => {
    const a = data.spawnAttempts.find(a => a.spawn_id === sid && a.user_id === uid);
    if (a) { a.caught = caught; a.resolved_at = resolved_at; save(); }
  }},
  getCaughtCount: { get: () => data.caughtPokemon.length },
  getCaughtByUser: { all: (userId) => data.caughtPokemon.filter(c => c.user_id === userId).sort((a,b) => b.caught_at - a.caught_at).slice(0, 500) },
  getOneCaught: { get: (id, userId) => data.caughtPokemon.find(c => c.id === id && c.user_id === userId) },
  getPokedexCounts: { all: (userId) => {
    const counts = {};
    for (const c of data.caughtPokemon) {
      if (c.user_id !== userId) continue;
      counts[c.pokemon_id] = (counts[c.pokemon_id] || 0) + 1;
    }
    return Object.entries(counts).map(([pokemon_id, cnt]) => ({ pokemon_id, cnt }));
  }},
  topByCatches: { all: () => data.users.filter(u => (u.total_catches||0) > 0 && !isHiddenUser(u.username)).sort((a,b) => b.total_catches-a.total_catches).slice(0,50).map(u => ({ id:u.id, username:u.username, total_catches:u.total_catches })) },
  topByIv: { all: () => {
    const best = new Map();
    const hiddenIds = new Set(data.users.filter(u => isHiddenUser(u.username)).map(u => u.id));
    for (const c of data.caughtPokemon) {
      if (hiddenIds.has(c.user_id)) continue;
      const cur = best.get(c.user_id);
      if (!cur || c.iv_total > cur.iv) best.set(c.user_id, { iv: c.iv_total, pokemon_id: c.pokemon_id });
    }
    return Array.from(best.entries()).map(([uid, v]) => {
      const u = data.users.find(u => u.id === uid);
      return u ? { id: u.id, username: u.username, best_iv: v.iv, pokemon_id: v.pokemon_id } : null;
    }).filter(Boolean).sort((a,b) => b.best_iv - a.best_iv).slice(0,50);
  }},
  deleteCaught: { run: (caughtId, userId) => {
    const idx = data.caughtPokemon.findIndex(c => c.id === caughtId && c.user_id === userId);
    if (idx === -1) return false;
    data.caughtPokemon.splice(idx, 1);
    save();
    return true;
  }},
  upgradePokemon: { run: (targetId, userId, materialId) => {
    const target = data.caughtPokemon.find(c => c.id === targetId && c.user_id === userId);
    if (!target) return false;
    const material = data.caughtPokemon.find(c => c.id === materialId && c.user_id === userId);
    if (!material) return false;
    if (target.pokemon_id !== material.pokemon_id) return false;
    if ((target.upgrades || 0) >= 5) return false;
    // Increment upgrades
    target.upgrades = (target.upgrades || 0) + 1;
    // Boost IVs by +2 each
    const ivs = JSON.parse(target.ivs_json);
    for (const stat of ['hp', 'atk', 'def', 'spAtk', 'spDef', 'spd']) {
      ivs[stat] = (ivs[stat] || 0) + 2;
    }
    target.ivs_json = JSON.stringify(ivs);
    target.iv_total = ivs.hp + ivs.atk + ivs.def + ivs.spAtk + ivs.spDef + ivs.spd;
    // Delete material Pokemon
    data.caughtPokemon = data.caughtPokemon.filter(c => c.id !== materialId);
    save();
    return true;
  }},
  topByPokedex: { all: () => {
    const species = new Map();
    const hiddenIds = new Set(data.users.filter(u => isHiddenUser(u.username)).map(u => u.id));
    for (const c of data.caughtPokemon) {
      if (hiddenIds.has(c.user_id)) continue;
      if (!species.has(c.user_id)) species.set(c.user_id, new Set());
      species.get(c.user_id).add(c.pokemon_id);
    }
    return Array.from(species.entries()).map(([uid, set]) => {
      const u = data.users.find(u => u.id === uid);
      return u ? { id: u.id, username: u.username, species: set.size } : null;
    }).filter(Boolean).sort((a,b) => b.species - a.species).slice(0,50);
  }},
};

module.exports = { db: { close: () => save() }, stmt, data, save, beginBatch, endBatch, isHiddenUser };
