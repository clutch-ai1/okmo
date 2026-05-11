// server/worldboss.js
// World Boss Raid — a legendary damage-dummy spawns every 30 minutes.
// Players attack once per boss. Boss doesn't need to die — it's a community
// damage test. When the timer runs out, rewards are distributed and a
// leaderboard is shown.

const { GameData, EGG_TIERS, rollIVs, ivTotal } = require('./data');
const { calcStats, calcDamage, effectiveness } = require('./battle');

// ---------- Config ----------
const BOSS_INTERVAL = 30 * 60 * 1000;   // every 30 minutes
const BOSS_DURATION = 10 * 60 * 1000;   // active for 10 minutes
const BOSS_CHECK_INTERVAL = 10 * 1000;  // check every 10s
const BOSS_LEVEL = 80;

const BOSS_POOL = ['mewtwo','mew','articuno','zapdos','moltres','dragonite','snorlax','lapras','aerodactyl','gyarados'];

// ---------- State ----------
let currentBoss = null;
let lastBossEnd = 0;   // when the last boss ended (for interval spacing)
let bossTimer = null;
let lastBossName = null;       // remember last boss name for sleeping state
let lastLeaderboard = [];      // remember last leaderboard for sleeping state

// References set by init()
let _broadcast = null;
let _stmt = null;
let _data = null;
let _save = null;
let _adminLogs = null;
let _sockets = null;
let _publicUser = null;

function init(broadcastFn, stmtRef, dataRef, saveRef, adminLogsRef, socketsRef, publicUserFn) {
  _broadcast = broadcastFn;
  _stmt = stmtRef;
  _data = dataRef;
  _save = saveRef;
  _adminLogs = adminLogsRef;
  _sockets = socketsRef;
  _publicUser = publicUserFn;

  bossTimer = setInterval(checkBossSpawn, BOSS_CHECK_INTERVAL);
  // First boss spawns after 2 minutes instead of full interval
  lastBossEnd = Date.now() - BOSS_INTERVAL + 2 * 60 * 1000;
  console.log('[worldboss] Initialized. Spawns every ' + (BOSS_INTERVAL / 60000) + ' min, active for ' + (BOSS_DURATION / 60000) + ' min. First boss in ~2 min.');
}

function pickBoss() {
  const pool = BOSS_POOL.filter(id => GameData.POKEMON_BY_ID[id]);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function spawnBoss(forcedSpeciesId) {
  if (currentBoss) return currentBoss; // already active

  const speciesId = forcedSpeciesId || pickBoss();
  if (!speciesId) return null;
  const species = GameData.POKEMON_BY_ID[speciesId];
  if (!species) return null;

  // Boss IVs maxed
  const ivs = { hp: 31, atk: 31, def: 31, spAtk: 31, spDef: 31, spd: 31 };
  const stats = calcStats(species, BOSS_LEVEL, ivs);

  const now = Date.now();
  currentBoss = {
    id: 'boss_' + now,
    pokemonId: speciesId,
    name: species.name,
    emoji: species.emoji || '',
    type: species.type,
    spriteUrl: species.spriteUrl,
    level: BOSS_LEVEL,
    stats: stats,
    ivs: ivs,
    participants: new Map(), // userId -> { username, damage, attackedAt }
    spawnedAt: now,
    endsAt: now + BOSS_DURATION,
  };

  if (_adminLogs) _adminLogs.log('boss_spawn', null, species.name + ' spawned (Lv' + BOSS_LEVEL + ')');

  if (_broadcast) {
    _broadcast({ type: 'boss_spawn', boss: Object.assign({ active: true }, getPublicState()) });
  }

  return currentBoss;
}

function checkBossSpawn() {
  const now = Date.now();

  // Current boss timer expired — end it and distribute rewards
  if (currentBoss && now >= currentBoss.endsAt) {
    endBoss();
    return;
  }

  // Time to spawn a new boss?
  if (!currentBoss && now - lastBossEnd >= BOSS_INTERVAL) {
    spawnBoss();
  }
}

function endBoss() {
  if (!currentBoss) return;

  const bossName = currentBoss.name;
  const totalDmg = getTotalDamage();
  const participantCount = currentBoss.participants.size;

  // Save leaderboard before clearing boss
  lastBossName = bossName;
  lastLeaderboard = getLeaderboard(20);

  // Distribute rewards to all participants
  const rewards = distributeRewards();

  if (_adminLogs) _adminLogs.log('boss_ended', null, bossName + ' raid ended — ' + participantCount + ' participants, ' + totalDmg + ' total damage');

  currentBoss = null;
  lastBossEnd = Date.now();
  const nextSpawnAt = lastBossEnd + BOSS_INTERVAL;

  if (_broadcast) {
    _broadcast({
      type: 'boss_ended',
      bossName: bossName,
      totalDamage: totalDmg,
      participantCount: participantCount,
      leaderboard: lastLeaderboard,
      rewards: rewards,
      nextSpawnAt: nextSpawnAt,
    });
  }
}

function getTotalDamage() {
  if (!currentBoss) return 0;
  let total = 0;
  for (const [_, p] of currentBoss.participants) total += p.damage;
  return total;
}

function getLeaderboard(limit) {
  if (!currentBoss) return [];
  const { isHiddenUser } = require('./db');
  const list = [];
  for (const [userId, p] of currentBoss.participants) {
    if (isHiddenUser(p.username)) continue;
    list.push({ userId, username: p.username, damage: p.damage });
  }
  list.sort((a, b) => b.damage - a.damage);
  return list.slice(0, limit || 20);
}

function getPublicState() {
  if (!currentBoss) return null;
  return {
    id: currentBoss.id,
    pokemonId: currentBoss.pokemonId,
    name: currentBoss.name,
    type: currentBoss.type,
    spriteUrl: currentBoss.spriteUrl,
    level: currentBoss.level,
    spawnedAt: currentBoss.spawnedAt,
    endsAt: currentBoss.endsAt,
    totalDamage: getTotalDamage(),
    participantCount: currentBoss.participants.size,
    leaderboard: getLeaderboard(20),
  };
}

function pickBestMove(attacker, defenderType) {
  let bestMove = null;
  let bestScore = -1;
  for (const moveId of attacker.moves) {
    const move = GameData.MOVE_BY_ID[moveId];
    if (!move || move.cat === 'status' || move.power === 0) continue;
    const stab = move.type === attacker.type ? 1.5 : 1;
    const eff = effectiveness(move.type, defenderType);
    const score = move.power * stab * eff * (move.acc / 100);
    if (score > bestScore) { bestScore = score; bestMove = move; }
  }
  if (!bestMove) bestMove = GameData.MOVE_BY_ID['tackle'];
  return bestMove;
}

function attack(userId, partyIds) {
  if (!currentBoss) return { ok: false, reason: 'No active World Boss' };
  if (Date.now() >= currentBoss.endsAt) return { ok: false, reason: 'Boss raid has ended' };
  if (currentBoss.participants.has(userId)) return { ok: false, reason: 'You already attacked this boss' };

  const user = _stmt.getUserById.get(userId);
  if (!user) return { ok: false, reason: 'User not found' };
  if (!Array.isArray(partyIds) || partyIds.length === 0) return { ok: false, reason: 'No party Pokemon' };

  const bossSpecies = GameData.POKEMON_BY_ID[currentBoss.pokemonId];
  if (!bossSpecies) return { ok: false, reason: 'Boss species not found' };
  const bossDefender = {
    speciesId: currentBoss.pokemonId,
    name: currentBoss.name,
    type: currentBoss.type,
    level: currentBoss.level,
    stats: currentBoss.stats,
    ivs: currentBoss.ivs,
  };

  // Each party Pokemon attacks once
  const attackResults = [];
  let totalDamage = 0;

  for (const caughtId of partyIds) {
    const caught = _stmt.getOneCaught.get(caughtId, userId);
    if (!caught) continue;
    const species = GameData.POKEMON_BY_ID[caught.pokemon_id];
    if (!species) continue;

    const ivs = JSON.parse(caught.ivs_json);
    const level = caught.level || 5;
    const stats = calcStats(species, level, ivs);
    const moves = caught.moves_json ? JSON.parse(caught.moves_json) : ['tackle'];

    const attacker = {
      speciesId: species.id,
      name: species.name,
      type: species.type,
      level: level,
      stats: stats,
      moves: moves,
      isShiny: !!caught.is_shiny,
    };

    const move = pickBestMove(attacker, currentBoss.type);
    if (!move) continue;

    const result = calcDamage(attacker, bossDefender, move);
    let dmg = result.dmg;
    if (attacker.isShiny) dmg = Math.floor(dmg * 1.1);

    totalDamage += dmg;

    attackResults.push({
      pokemonId: species.id,
      pokemonName: species.name,
      level: level,
      moveName: move.name,
      moveType: move.type,
      damage: dmg,
      effectiveness: result.eff,
      crit: result.crit,
      isShiny: attacker.isShiny,
    });
  }

  if (attackResults.length === 0) return { ok: false, reason: 'No valid party Pokemon' };

  // Record participation
  currentBoss.participants.set(userId, {
    username: user.username,
    damage: totalDamage,
    attackedAt: Date.now(),
  });

  if (_adminLogs) _adminLogs.log('boss_attack', user, user.username + ' dealt ' + totalDamage + ' dmg to ' + currentBoss.name);

  // Broadcast updated state
  if (_broadcast) {
    _broadcast({ type: 'boss_update', boss: Object.assign({ active: true }, getPublicState()) });
  }

  return {
    ok: true,
    totalDamage: totalDamage,
    attacks: attackResults,
  };
}

function distributeRewards() {
  if (!currentBoss) return [];

  const sorted = getLeaderboard(999);
  if (sorted.length === 0) return [];

  const rewards = [];

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const rank = i + 1;

    // Flat rewards: 20 gold, 5 XP per party pokemon
    const gold = 20;
    const xpPerPokemon = 5;

    if (_stmt) _stmt.addGold.run(gold, p.userId);

    // XP to party pokemon
    const user = _stmt ? _stmt.getUserById.get(p.userId) : null;
    if (user && Array.isArray(user.party)) {
      for (const cid of user.party) {
        const c = _stmt.getOneCaught.get(cid, p.userId);
        if (!c) continue;
        let lvl = c.level || 5;
        let xpLeft = (c.xp || 0) + xpPerPokemon;
        while (xpLeft >= lvl * 5 && lvl < 100) { xpLeft -= lvl * 5; lvl++; }
        _stmt.updateCaughtLevel.run(lvl, xpLeft, c.id, p.userId);
      }
    }

    const reward = {
      userId: p.userId,
      username: p.username,
      damage: p.damage,
      rank: rank,
      gold: gold,
      xp: xpPerPokemon,
      bonusBalls: null,
      eggDrop: null,
    };

    // Top 3 bonus balls
    if (rank === 1) {
      reward.bonusBalls = { ball: 'hyperball', count: 3 };
      if (_stmt) _stmt.awardBall.run('hyperball', 3, p.userId);
    } else if (rank === 2) {
      reward.bonusBalls = { ball: 'superball', count: 3 };
      if (_stmt) _stmt.awardBall.run('superball', 3, p.userId);
    } else if (rank === 3) {
      reward.bonusBalls = { ball: 'pokeball', count: 3 };
      if (_stmt) _stmt.awardBall.run('pokeball', 3, p.userId);
    }

    // 10% epic egg drop
    if (Math.random() < 0.10) {
      reward.eggDrop = { tier: 'epic', name: EGG_TIERS.epic.name };
      if (_stmt) _stmt.addEgg.run('epic', p.userId);
    }

    rewards.push(reward);

    if (_adminLogs && user) {
      _adminLogs.log('boss_reward', user, 'Boss reward: +' + gold + 'g, +' + xpPerPokemon + 'xp/mon, rank #' + rank +
        (reward.bonusBalls ? ', +' + reward.bonusBalls.count + 'x ' + reward.bonusBalls.ball : '') +
        (reward.eggDrop ? ', +' + reward.eggDrop.name : ''));
    }
  }

  // Send user_update to each participant
  if (_sockets && _stmt && _publicUser) {
    for (const r of rewards) {
      for (const ws of _sockets) {
        if (ws.user && ws.user.id === r.userId && ws.readyState === 1) {
          const refreshed = _stmt.getUserById.get(r.userId);
          if (refreshed) {
            ws.send(JSON.stringify({ type: 'user_update', user: _publicUser(refreshed) }));
          }
        }
      }
    }
  }

  return rewards;
}

function forceSpawn(speciesId) {
  if (currentBoss) currentBoss = null; // end current boss
  return spawnBoss(speciesId || null);
}

function getState() {
  if (currentBoss) {
    return Object.assign({ active: true }, getPublicState());
  }
  return {
    active: false,
    nextSpawnAt: lastBossEnd + BOSS_INTERVAL,
    lastBossName: lastBossName || null,
    lastLeaderboard: lastLeaderboard || [],
  };
}
function hasAttacked(userId) {
  if (!currentBoss) return false;
  return currentBoss.participants.has(userId);
}

module.exports = {
  init, getState, attack, hasAttacked, forceSpawn,
  BOSS_INTERVAL, BOSS_DURATION,
};
