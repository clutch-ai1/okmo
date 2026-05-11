// server/game.js
const { stmt, db, beginBatch, endBatch } = require('./db');
const {
  GameData, rollIVs, ivTotal, ivPercent, ivDifficulty, pickRandomEncounter,
  LEGENDARY_INTERVAL, pickLegendary,
  xpForLevelUp, totalXpForLevel, levelFromTotalXp, xpForCatch, levelUpReward,
  pickDailyQuests, questDef, DAILY_QUEST_DEFS, ACHIEVEMENT_DEFS,
  rollMoveset,
  pokemonXpFromCatch, applyXpToPokemon, pokemonXpForLevelUp, POKEMON_MAX_LEVEL,
  getEvolution,
  rollEggDropFromCatch, EGG_TIERS,
} = require('./data');

const SPAWN_INTERVAL_MS = 60_000;
const CATCH_WINDOW_MS = 45_000;
const LEGENDARY_CATCH_WINDOW_MS = 90_000;

const AREA_ROTATION = [
  'meadow','forest','meadow','lake','meadow',
  'forest','mountain','forest','powerplant',
  'lake','tower','meadow','volcano','safari',
];
let rotationIndex = 0;
let activeUsers = new Map();
let currentSpawn = null;
let spawnCounter = 0;
let firstCatcherForCurrent = null;

let broadcastFn = null;
let resolveCb = null;

function registerActiveUser(userId, ws) { activeUsers.set(userId, ws); }
function unregisterActiveUser(userId) { activeUsers.delete(userId); }

function getCurrentSpawnState() {
  if (!currentSpawn) return null;
  return {
    spawnId: currentSpawn.id, pokemonId: currentSpawn.pokemonId, areaId: currentSpawn.areaId,
    spawnedAt: currentSpawn.spawnedAt, resolvesAt: currentSpawn.resolvesAt,
    isLegendary: !!currentSpawn.isLegendary,
    pokemon: GameData.POKEMON_BY_ID[currentSpawn.pokemonId],
    area: GameData.AREA_BY_ID[currentSpawn.areaId],
  };
}

function getMyAttempt(userId) {
  if (!currentSpawn) return null;
  const a = currentSpawn.perUser.get(userId);
  if (!a) return null;
  return { ball: a.ball, ballLocked: a.ballLocked, ballSpent: a.ballSpent, ivs: a.ivs, moves: a.moves };
}

const VALID_BALL_IDS = ['afkball', 'pokeball', 'superball', 'hyperball', 'masterball'];
function tryDecrementBall(userId, ballId) {
  // Strict whitelist — never trust client-supplied ball strings beyond this set.
  if (!VALID_BALL_IDS.includes(ballId)) return false;
  const user = stmt.getUserById.get(userId);
  if (!user) return false;
  const col = 'ball_' + ballId;
  if ((user[col] || 0) <= 0) return false;
  stmt.decrementBall.run(ballId, ballId, ballId, ballId, ballId, userId);
  return true;
}

function awardCatchBonus(userId) {
  const r = Math.random();
  let bonus = null;
  if (r < 0.002) bonus = 'masterball';
  else if (r < 0.017) bonus = 'hyperball';
  else if (r < 0.097) bonus = 'superball';
  if (bonus) stmt.awardBall.run(bonus, 1, userId);
  return bonus;
}

function rollCatchSuccess(pokemon, ivs, ballId) {
  const ball = GameData.BALL_BY_ID[ballId] || GameData.BALL_BY_ID.pokeball;
  const ivMod = 1 / ivDifficulty(ivs);
  const baseRate = pokemon.catchRate * ball.catchMult * ivMod;
  const finalRate = Math.min(0.99, baseRate);
  if (ball.catchMult >= 99) return true;
  let shakes = 0;
  for (let i = 0; i < 2; i++) {
    if (Math.random() < finalRate) shakes++;
    else break;
  }
  return shakes >= 2;
}

function startNewSpawn() {
  spawnCounter++;
  const isLegendary = spawnCounter % LEGENDARY_INTERVAL === 0;
  let pokemon, areaId;
  if (isLegendary) {
    pokemon = pickLegendary();
    areaId = 'meadow';
  } else {
    areaId = AREA_ROTATION[rotationIndex % AREA_ROTATION.length];
    rotationIndex++;
    pokemon = pickRandomEncounter(areaId);
  }
  const now = Date.now();
  const window = isLegendary ? LEGENDARY_CATCH_WINDOW_MS : CATCH_WINDOW_MS;
  const resolvesAt = now + window;
  const result = stmt.insertSpawn.run(pokemon.id, areaId, now, resolvesAt);
  firstCatcherForCurrent = null;
  currentSpawn = {
    id: result.lastInsertRowid, pokemonId: pokemon.id, areaId,
    spawnedAt: now, resolvesAt, isLegendary, perUser: new Map(),
  };
  for (const [userId] of activeUsers) initUserAttempt(userId);
  if (broadcastFn) broadcastFn({ type: 'spawn_start', spawn: getCurrentSpawnState() });
  if (isLegendary && broadcastFn) {
    broadcastFn({
      type: 'legendary_alert',
      pokemonId: pokemon.id, pokemonName: pokemon.name,
      message: 'LEGENDARY: A wild ' + pokemon.name + ' has appeared!',
    });
  }
  for (const [userId, ws] of activeUsers) {
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'attempt_update', attempt: getMyAttempt(userId) }));
    }
  }
  setTimeout(resolveCurrentSpawn, window);
}

function initUserAttempt(userId) {
  if (!currentSpawn) return;
  if (currentSpawn.perUser.has(userId)) return;
  const user = stmt.getUserById.get(userId);
  if (!user) return;
  const ivs = rollIVs();
  const isShiny = Math.random() < 1 / 512;
  const pokemon = GameData.POKEMON_BY_ID[currentSpawn.pokemonId];
  const moves = rollMoveset(pokemon);
  const ball = 'afkball';
  const attempt = { userId, ivs, isShiny, ball, ballLocked: false, ballSpent: true, moves };
  tryDecrementBall(userId, ball);
  currentSpawn.perUser.set(userId, attempt);
  stmt.insertAttempt.run(currentSpawn.id, userId, attempt.ball, JSON.stringify(ivs), isShiny ? 1 : 0, null, null);
}

function chooseBall(userId, ballId) {
  if (!currentSpawn) return { ok: false, reason: 'No active spawn' };
  if (Date.now() >= currentSpawn.resolvesAt) return { ok: false, reason: 'Catch window closed' };
  const attempt = currentSpawn.perUser.get(userId);
  if (!attempt) return { ok: false, reason: 'No attempt for this user' };
  if (attempt.ballLocked) return { ok: false, reason: 'Ball already locked in' };
  if (attempt.ball && attempt.ballSpent) {
    stmt.awardBall.run(attempt.ball, 1, userId);
    attempt.ballSpent = false;
  }
  if (!tryDecrementBall(userId, ballId)) return { ok: false, reason: 'No ' + ballId + ' available' };
  attempt.ball = ballId; attempt.ballSpent = true; attempt.ballLocked = true;
  stmt.insertAttempt.run(currentSpawn.id, userId, ballId, JSON.stringify(attempt.ivs), attempt.isShiny ? 1 : 0, null, null);
  return { ok: true };
}

function resolveCurrentSpawn() {
  if (!currentSpawn) return;
  beginBatch(); // suppress intermediate DB writes until resolve completes
  const spawn = currentSpawn;
  currentSpawn = null;
  const pokemon = GameData.POKEMON_BY_ID[spawn.pokemonId];
  const now = Date.now();
  const results = [];
  const entries = Array.from(spawn.perUser.entries());
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  let firstCatcherUserId = null;
  for (const [userId, attempt] of entries) {
    let caught = false; let bonus = null; let caughtId = null;
    if (attempt.ball) {
      caught = rollCatchSuccess(pokemon, attempt.ivs, attempt.ball);
      if (caught) {
        const ivT = ivTotal(attempt.ivs);
        const ins = stmt.insertCaught.run(userId, pokemon.id, JSON.stringify(attempt.ivs), ivT, attempt.isShiny ? 1 : 0, attempt.ball, now, JSON.stringify(attempt.moves || []));
        caughtId = ins && ins.lastInsertRowid != null ? ins.lastInsertRowid : null;
        stmt.incrementCatches.run(userId);
        bonus = awardCatchBonus(userId);
        if (firstCatcherUserId === null) firstCatcherUserId = userId;
      }
    }
    let gold = 1;
    if (caught) gold += 2;
    if (caught && spawn.isLegendary) gold += 20;
    stmt.addGold.run(gold, userId);
    let eggDrop = null;
    const eggTierId = rollEggDropFromCatch(caught, !!spawn.isLegendary);
    if (eggTierId && EGG_TIERS[eggTierId]) {
      const newEgg = stmt.addEgg.run(eggTierId, userId);
      eggDrop = { tier: eggTierId, name: EGG_TIERS[eggTierId].name, eggId: newEgg ? newEgg.id : null };
    }
    stmt.resolveAttempt.run(caught ? 1 : 0, now, spawn.id, userId);
    results.push({ userId, caught, caughtId, ball: attempt.ball, ivs: attempt.ivs, isShiny: attempt.isShiny, bonus, gold, moves: attempt.moves, eggDrop });
  }
  const progressionByUser = {};
  for (const r of results) {
    const isFirstCatch = (r.userId === firstCatcherUserId);
    progressionByUser[r.userId] = applyProgression(r.userId, {
      caught: r.caught, isShiny: r.isShiny, isLegendary: !!spawn.isLegendary,
      ball: r.ball, ivs: r.ivs, ivTotal: ivTotal(r.ivs),
      pokemon, isFirstCatch,
    });
    const partyXp = distributePartyXp(r.userId);
    if (partyXp.length) progressionByUser[r.userId].partyXp = partyXp;
  }
  if (spawn.isLegendary && firstCatcherUserId && broadcastFn) {
    const u = stmt.getUserById.get(firstCatcherUserId);
    if (u) {
      broadcastFn({
        type: 'legendary_first_catch',
        pokemonId: pokemon.id, pokemonName: pokemon.name, username: u.username,
        message: u.username + ' caught the legendary ' + pokemon.name + ' first!',
      });
    }
  }
  endBatch(); // flush all DB changes in one write
  if (resolveCb) resolveCb(spawn, results, progressionByUser);
  scheduleNextSpawn();
}

function applyProgression(userId, ctx) {
  const user = stmt.getUserById.get(userId);
  if (!user) return null;
  const out = { levelUps: [], achievements: [], questsCompleted: [], xpGained: 0, newStreak: user.streak, oldLevel: user.level };
  let streak = user.streak || 0;
  if (ctx.caught) streak++; else streak = 0;
  let bestStreak = Math.max(user.best_streak || 0, streak);
  stmt.setStreak.run(streak, bestStreak, userId);
  out.newStreak = streak;
  if (ctx.caught) {
    const xpAwarded = xpForCatch({
      rarity: ctx.pokemon.rarity || 1,
      ivPercent: ctx.ivs ? (ctx.ivTotal / 186) : 0.5,
      isShiny: ctx.isShiny, isLegendary: ctx.isLegendary, streak: streak,
    }) + (ctx.isFirstCatch && ctx.isLegendary ? 250 : 0);
    out.xpGained = xpAwarded;
    let newXp = (user.xp || 0) + xpAwarded;
    let newLevel = user.level || 1;
    while (newLevel < 50 && newXp >= xpForLevelUp(newLevel)) {
      newXp -= xpForLevelUp(newLevel);
      newLevel++;
      const reward = levelUpReward(newLevel);
      if (reward) stmt.awardBall.run(reward.ball, reward.count, userId);
      out.levelUps.push({ level: newLevel, reward });
    }
    if (newLevel >= 50) newXp = 0;
    stmt.setLevelXp.run(newLevel, newXp, userId);
  }
  if (ctx.caught && ctx.isLegendary) stmt.incrementLegendary.run(userId, ctx.isFirstCatch ? 1 : 0);
  if (ctx.caught) {
    const refreshed = stmt.getUserById.get(userId);
    let quests = ensureDailyQuests(refreshed);
    let changed = false;
    const dexCounts = stmt.getPokedexCounts.all(userId);
    const thisSpeciesCount = (dexCounts.find(c => c.pokemon_id === ctx.pokemon.id) || {}).cnt || 0;
    const isNewSpecies = thisSpeciesCount === 1;
    for (const q of quests) {
      const def = questDef(q.id); if (!def) continue;
      if (q.completed) continue;
      const inc = def.onCatch({
        ivTotal: ctx.ivTotal, ball: ctx.ball, type: ctx.pokemon.type,
        rarity: ctx.pokemon.rarity || 1, isLegendary: ctx.isLegendary,
        isShiny: ctx.isShiny, streak: streak, isNewSpecies,
      });
      if (def.mode === 'max') {
        if (inc > q.progress) { q.progress = inc; changed = true; }
      } else if (inc) {
        q.progress = (q.progress || 0) + inc;
        changed = true;
      }
      if (q.progress >= def.target && !q.completed) {
        q.completed = true;
        if (def.reward) stmt.awardBall.run(def.reward.ball, def.reward.count, userId);
        out.questsCompleted.push({ id: q.id, label: def.label, reward: def.reward });
      }
    }
    if (changed) stmt.setDailyQuests.run(JSON.stringify(quests), refreshed.daily_quests_day, userId);
  }
  const refreshedUser = stmt.getUserById.get(userId);
  const dex = stmt.getPokedexCounts.all(userId).length;
  for (const ach of ACHIEVEMENT_DEFS) {
    if ((refreshedUser.achievements || []).includes(ach.id)) continue;
    if (ach.check(refreshedUser, ctx, dex)) {
      stmt.addAchievement.run(ach.id, ach.title || refreshedUser.title, userId);
      out.achievements.push({ id: ach.id, name: ach.name, title: ach.title });
    }
  }
  return out;
}

function distributePartyXp(userId) {
  const user = stmt.getUserById.get(userId);
  if (!user || !Array.isArray(user.party) || user.party.length === 0) return [];
  const xp = pokemonXpFromCatch();
  const out = [];
  for (const caughtId of user.party) {
    const c = stmt.getOneCaught.get(caughtId, userId);
    if (!c) continue;
    const before = { lvl: c.level || 1, xp: c.xp || 0 };
    const r = applyXpToPokemon(before.lvl, before.xp, xp);
    if (r.newLevel !== before.lvl || r.newXp !== before.xp) {
      stmt.updateCaughtLevel.run(r.newLevel, r.newXp, caughtId, userId);
    }
    const entry = {
      caughtId, pokemonId: c.pokemon_id,
      pokemonName: GameData.POKEMON_BY_ID[c.pokemon_id] ? GameData.POKEMON_BY_ID[c.pokemon_id].name : c.pokemon_id,
      xpGained: xp, newLevel: r.newLevel, newXp: r.newXp, levelUps: r.levelUps,
    };
    if (r.levelUps.length) {
      const evo = getEvolution(c.pokemon_id, r.newLevel);
      if (evo && GameData.POKEMON_BY_ID[evo.to]) {
        stmt.evolveCaught.run(evo.to, caughtId, userId);
        const newSp = GameData.POKEMON_BY_ID[evo.to];
        entry.evolved = {
          fromId: c.pokemon_id, toId: evo.to,
          fromName: GameData.POKEMON_BY_ID[c.pokemon_id].name, toName: newSp.name,
          fromSprite: GameData.POKEMON_BY_ID[c.pokemon_id].spriteUrl,
          toSprite: newSp.spriteUrl,
        };
        entry.pokemonId = evo.to; entry.pokemonName = newSp.name;
      }
    }
    out.push(entry);
  }
  return out;
}

function ensureDailyQuests(user) {
  const today = new Date().toISOString().slice(0, 10);
  if (user.daily_quests_day === today && user.daily_quests) {
    try { return JSON.parse(user.daily_quests); } catch {}
  }
  const fresh = pickDailyQuests();
  stmt.setDailyQuests.run(JSON.stringify(fresh), today, user.id);
  return fresh;
}
function getDailyQuestsForUser(userId) {
  const user = stmt.getUserById.get(userId);
  if (!user) return [];
  const quests = ensureDailyQuests(user);
  return quests.map(q => {
    const def = questDef(q.id);
    return {
      id: q.id, label: def ? def.label : q.id,
      target: def ? def.target : 1, progress: q.progress || 0,
      completed: !!q.completed, reward: def ? def.reward : null,
    };
  });
}

function startSpawnLoop(broadcast, onResolve) {
  broadcastFn = broadcast;
  resolveCb = onResolve;
  // Start first spawn after 5s, then schedule next spawns only after
  // the current catch window has been resolved (see resolveCurrentSpawn).
  setTimeout(startNewSpawn, 5000);
}

// Called internally after a spawn resolves to queue the next one.
function scheduleNextSpawn() {
  const gap = SPAWN_INTERVAL_MS - (currentSpawn ? (currentSpawn.resolvesAt - currentSpawn.spawnedAt) : 0);
  const delay = Math.max(5000, gap);
  setTimeout(startNewSpawn, delay);
}

module.exports = {
  SPAWN_INTERVAL_MS, CATCH_WINDOW_MS,
  startSpawnLoop, registerActiveUser, unregisterActiveUser,
  getCurrentSpawnState, getMyAttempt, chooseBall, initUserAttempt,
  getDailyQuestsForUser,
};
