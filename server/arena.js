// server/arena.js
// Turn-based arena battle.
// - 2x3 formation grid per side (slots 0,1,2 = top row; 3,4,5 = bottom row)
// - Speed-sorted turn queue: fastest Pokemon acts first
// - Each turn one Pokemon attacks one target (basic OR skill if charges full)
// - Lane preference: attacker prefers enemy in same row, fallback to closest
// - Server runs one turn every TURN_INTERVAL_MS, broadcasting an `arena_turn` event
//   so the client can play the jump-attack animation in sync.

const { stmt } = require('./db');
const { GameData } = require('./data');
const { getSkillForSpecies } = require('./skills');

const FIELD_W = 800;
const FIELD_H = 400;
const TURN_INTERVAL_MS = 900;       // delay between turns (gives time for animation)

const activeMatches = new Map();    // userId -> match
let _nextMatchId = 1;

function effectiveness(moveType, defType) {
  const T = {
    fire:    { grass: 2, water: 0.5, ice: 2, bug: 2, rock: 0.5, fire: 0.5 },
    water:   { fire: 2, grass: 0.5, water: 0.5, rock: 2, ground: 2 },
    grass:   { water: 2, fire: 0.5, ground: 2, rock: 2, grass: 0.5, flying: 0.5, bug: 0.5 },
    electric:{ water: 2, flying: 2, ground: 0, electric: 0.5, grass: 0.5 },
    ice:     { grass: 2, ground: 2, flying: 2, dragon: 2, water: 0.5, ice: 0.5, fire: 0.5 },
    fighting:{ normal: 2, ice: 2, rock: 2, dark: 2, flying: 0.5, psychic: 0.5, ghost: 0 },
    poison:  { grass: 2, fairy: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0 },
    ground:  { fire: 2, electric: 2, poison: 2, rock: 2, steel: 2, grass: 0.5, bug: 0.5, flying: 0 },
    flying:  { grass: 2, fighting: 2, bug: 2, electric: 0.5, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, dark: 0, psychic: 0.5, steel: 0.5 },
    bug:     { grass: 2, psychic: 2, dark: 2, fire: 0.5, fighting: 0.5, flying: 0.5, ghost: 0.5, steel: 0.5, fairy: 0.5 },
    rock:    { fire: 2, ice: 2, flying: 2, bug: 2, fighting: 0.5, ground: 0.5, steel: 0.5 },
    ghost:   { ghost: 2, psychic: 2, dark: 0.5, normal: 0 },
    dragon:  { dragon: 2, steel: 0.5, fairy: 0 },
    dark:    { ghost: 2, psychic: 2, dark: 0.5, fighting: 0.5, fairy: 0.5 },
    steel:   { ice: 2, rock: 2, fairy: 2, fire: 0.5, water: 0.5, electric: 0.5, steel: 0.5 },
    fairy:   { fighting: 2, dragon: 2, dark: 2, fire: 0.5, poison: 0.5, steel: 0.5 },
    normal:  { rock: 0.5, ghost: 0, steel: 0.5 },
  };
  const row = T[moveType] || {};
  return row[defType] !== undefined ? row[defType] : 1;
}
function calcStat(base, iv, level) { return Math.floor(((2*base + (iv||0)) * level) / 100) + 5; }
function calcHp(base, iv, level)   { return Math.floor(((2*base + (iv||0)) * level) / 100) + level + 10; }
function baseStats(rarity) {
  if (rarity >= 5) return { hp: 95, atk: 100, def: 85, spd: 95 };
  if (rarity === 4) return { hp: 80, atk: 85, def: 75, spd: 75 };
  if (rarity === 3) return { hp: 65, atk: 70, def: 60, spd: 65 };
  if (rarity === 2) return { hp: 50, atk: 55, def: 50, spd: 55 };
  return                  { hp: 35, atk: 40, def: 35, spd: 45 };
}

function slotPosition(slot, side) {
  // 2x3 grid. slot 0,1,2 = top row, 3,4,5 = bottom row.
  const col = slot % 3;
  const row = Math.floor(slot / 3);
  const sideOffset = side === 'player' ? -1 : 1;
  const cx = FIELD_W / 2;
  const cy = FIELD_H / 2;
  const x = cx + sideOffset * (140 + col * 90);
  const y = cy - 90 + row * 120;   // wider vertical spacing for clarity
  return { x, y };
}
function rowOfSlot(slot) { return Math.floor(slot / 3); }

function buildArenaPokemon(species, level, ivs, side, slot, isShiny) {
  const base = baseStats(species.rarity || 1);
  const lvl = Math.max(1, level || 1);
  const ivObj = ivs || {};
  const hp   = calcHp(base.hp, ivObj.hp || 0, lvl);
  const atk  = calcStat(base.atk, ivObj.atk || 0, lvl);
  const def  = calcStat(base.def, ivObj.def || 0, lvl);
  const spd  = calcStat(base.spd, ivObj.spd || 0, lvl);
  const skill = getSkillForSpecies(species);
  const pos = slotPosition(slot, side);
  return {
    uid: side + '_' + slot,
    side,
    slot,
    row: rowOfSlot(slot),
    speciesId: species.id,
    name: species.name,
    type: species.type,
    spriteUrl: isShiny ? species.spriteShinyUrl : species.spriteUrl,
    isShiny: !!isShiny,
    level: lvl,
    hp, maxHp: hp,
    atk, def, spd,
    homeX: pos.x, homeY: pos.y,
    charges: 0,
    skill,
    fainted: false,
  };
}

// Choose target with lane preference: same row first, then any alive enemy.
function chooseTarget(attacker, all) {
  const enemies = all.filter(p => !p.fainted && p.side !== attacker.side);
  if (!enemies.length) return null;
  const sameRow = enemies.filter(p => p.row === attacker.row);
  const pool = sameRow.length ? sameRow : enemies;
  // Prefer the one closest by column (so 'middle' attacker prefers middle target)
  pool.sort((a, b) => {
    const ca = a.slot % 3, cb = b.slot % 3;
    return Math.abs(ca - (attacker.slot % 3)) - Math.abs(cb - (attacker.slot % 3));
  });
  return pool[0];
}

function calcDamage(attacker, defender, power, isSkill) {
  const eff = effectiveness(attacker.type, defender.type);
  const crit = Math.random() < 0.0625;
  const random = 0.85 + Math.random() * 0.15;
  const stab = 1.5;   // attack uses attacker's type → STAB always
  const raw = ((((2 * attacker.level / 5 + 2) * power * attacker.atk / Math.max(1, defender.def)) / 50) + 2);
  const dmg = Math.max(1, Math.floor(raw * stab * eff * (crit ? 1.5 : 1) * random));
  return { dmg, eff, crit };
}

function pushLog(match, msg) {
  match.log.push({ t: match.turnIndex, msg });
  if (match.log.length > 100) match.log.shift();
}

// Execute one turn of the active Pokemon. Returns the turn event.
function runOneTurn(match) {
  if (match.over) return null;
  // Find next alive Pokemon in queue
  let attacker = null;
  while (match.queueIdx < match.queue.length) {
    const uid = match.queue[match.queueIdx++];
    const p = match.pokemon.find(x => x.uid === uid);
    if (p && !p.fainted) { attacker = p; break; }
  }
  // If queue exhausted, resort by speed and start new round
  if (!attacker) {
    rebuildQueue(match);
    while (match.queueIdx < match.queue.length) {
      const uid = match.queue[match.queueIdx++];
      const p = match.pokemon.find(x => x.uid === uid);
      if (p && !p.fainted) { attacker = p; break; }
    }
  }
  if (!attacker) {
    // No one alive
    finishMatch(match);
    return null;
  }

  const target = chooseTarget(attacker, match.pokemon);
  if (!target) { finishMatch(match); return null; }

  // Decide: skill if charged (and skill exists), otherwise basic
  const useSkill = attacker.charges >= attacker.skill.charges;
  const power = useSkill ? attacker.skill.power : 30;

  // Compute damage
  const result = calcDamage(attacker, target, power, useSkill);

  // AoE for skill: hit additional same-row enemies
  const additionalHits = [];
  if (useSkill && attacker.skill.aoe) {
    const others = match.pokemon.filter(p =>
      !p.fainted && p.side !== attacker.side && p.uid !== target.uid && p.row === target.row
    );
    for (const o of others) {
      const r = calcDamage(attacker, o, Math.floor(power * 0.6), true);
      additionalHits.push({ uid: o.uid, dmg: r.dmg, eff: r.eff });
      o.hp = Math.max(0, o.hp - r.dmg);
      if (o.hp === 0) o.fainted = true;
    }
  }

  // Apply main hit
  target.hp = Math.max(0, target.hp - result.dmg);
  if (target.hp === 0) target.fainted = true;

  // Charge bookkeeping
  if (useSkill) {
    attacker.charges = 0;
    pushLog(match, attacker.name + ' used ' + attacker.skill.name + '!');
  } else {
    if (attacker.charges < attacker.skill.charges) attacker.charges++;
    pushLog(match, attacker.name + ' attacks ' + target.name + ' (-' + result.dmg + ')');
  }
  if (target.fainted) pushLog(match, target.name + ' fainted!');

  match.turnIndex++;

  // Win condition
  const playersAlive = match.pokemon.some(p => p.side === 'player' && !p.fainted);
  const enemiesAlive = match.pokemon.some(p => p.side === 'enemy'  && !p.fainted);
  if (!playersAlive || !enemiesAlive) {
    match.over = true;
    match.winner = playersAlive ? 'player' : 'enemy';
    pushLog(match, match.winner === 'player' ? 'VICTORY!' : 'DEFEAT...');
  }

  // Build turn event
  return {
    turnIndex: match.turnIndex,
    attackerUid: attacker.uid,
    targetUid: target.uid,
    isSkill: useSkill,
    skillName: useSkill ? attacker.skill.name : null,
    skillColor: useSkill ? attacker.skill.color : null,
    dmg: result.dmg,
    eff: result.eff,
    crit: result.crit,
    attackerCharges: attacker.charges,
    additionalHits,
    targetHp: target.hp,
    targetFainted: target.fainted,
    over: match.over,
    winner: match.winner,
  };
}

function rebuildQueue(match) {
  // Sort all alive Pokemon by speed descending. Tie-break by random for fairness.
  const alive = match.pokemon.filter(p => !p.fainted);
  alive.sort((a, b) => (b.spd - a.spd) + (Math.random() - 0.5) * 0.5);
  match.queue = alive.map(p => p.uid);
  match.queueIdx = 0;
  match.round = (match.round || 0) + 1;
}

function publicMatch(match) {
  return {
    id: match.id,
    fieldW: FIELD_W, fieldH: FIELD_H,
    over: match.over, winner: match.winner,
    isTower: !!match.isTower, towerFloor: match.towerFloor || 0,
    isPvp: !!match.isPvp,
    round: match.round,
    pokemon: match.pokemon.map(p => ({
      uid: p.uid, side: p.side, slot: p.slot, row: p.row,
      name: p.name, speciesId: p.speciesId,
      spriteUrl: p.spriteUrl, isShiny: p.isShiny, type: p.type, level: p.level,
      hp: p.hp, maxHp: p.maxHp,
      x: p.homeX, y: p.homeY,
      charges: p.charges, skillCharges: p.skill.charges,
      skillName: p.skill.name, skillColor: p.skill.color,
      fainted: p.fainted,
    })),
    log: match.log.slice(-15),
    reward: match.reward || null,
  };
}

function startMatch(opts) {
  // opts: { userId, playerTeam: [{species, level, ivs, isShiny, slot}], enemyTeam: same, ... }
  const { userId, playerTeam, enemyTeam } = opts;
  const pokemon = [];
  // Pack into slots 0..5 contiguously per side (use provided slot if set, else iteration index)
  let pIdx = 0;
  for (const m of playerTeam) {
    if (!m || !m.species) continue;
    const slot = (Number.isFinite(m.slot) ? m.slot : pIdx);
    pokemon.push(buildArenaPokemon(m.species, m.level, m.ivs, 'player', slot, m.isShiny));
    pIdx++;
  }
  let eIdx = 0;
  for (const m of enemyTeam) {
    if (!m || !m.species) continue;
    const slot = (Number.isFinite(m.slot) ? m.slot : eIdx);
    pokemon.push(buildArenaPokemon(m.species, m.level, m.ivs, 'enemy', slot, m.isShiny));
    eIdx++;
  }
  const match = {
    id: _nextMatchId++,
    userId,
    isTower: !!opts.isTower, towerFloor: opts.towerFloor || 0,
    isPvp: !!opts.isPvp, targetUserId: opts.targetUserId || null,
    pokemon,
    log: [],
    queue: [], queueIdx: 0,
    turnIndex: 0, round: 0,
    over: false, winner: null,
    reward: opts.reward || { gold: 0, xp: 0, bonus: null },
    onFinish: opts.onFinish || null,
    nextTurnAt: Date.now() + 1200,    // delay before first turn
  };
  rebuildQueue(match);
  pushLog(match, 'Battle start!');
  activeMatches.set(userId, match);
  return match;
}

function finishMatch(match) {
  if (match.over) return;
  match.over = true;
  match.winner = match.pokemon.some(p => p.side === 'player' && !p.fainted) ? 'player' : 'enemy';
}

// Expose lookup / control
function getMatch(userId)    { return activeMatches.get(userId) || null; }
function endMatch(userId)    { activeMatches.delete(userId); }
function forfeitMatch(userId) {
  const m = activeMatches.get(userId);
  if (!m || m.over) return null;
  for (const p of m.pokemon) if (p.side === 'player') { p.fainted = true; p.hp = 0; }
  m.over = true; m.winner = 'enemy';
  pushLog(m, 'Forfeit.');
  if (m.onFinish) { try { m.onFinish(m); } catch (_) {} }
  return m;
}

// Tick driver: every interval, advance any ready match by one turn.
let _intervalHandle = null;
function startTicking(onTurnEvent, onMatchUpdate) {
  if (_intervalHandle) return;
  _intervalHandle = setInterval(() => {
    const now = Date.now();
    for (const [uid, match] of activeMatches) {
      if (match.over) continue;
      if (match.nextTurnAt && now < match.nextTurnAt) continue;
      const turn = runOneTurn(match);
      if (turn && onTurnEvent) onTurnEvent(match, turn);
      if (match.over) {
        if (match.onFinish) { try { match.onFinish(match); } catch (e) { console.warn('onFinish err', e); } }
        if (onMatchUpdate) onMatchUpdate(match);
      } else {
        match.nextTurnAt = now + TURN_INTERVAL_MS;
      }
    }
  }, 200);
  _intervalHandle.unref && _intervalHandle.unref();
}

// ---------- Tower / PvP helpers ----------
function _generateTowerTeam(floor) {
  const baseLevel = Math.min(95, Math.floor(5 + floor * 0.8));
  let teamSize;
  if (floor <= 10)      teamSize = 1 + Math.floor(floor / 5);
  else if (floor <= 30) teamSize = 2 + Math.floor((floor - 10) / 10);
  else if (floor <= 60) teamSize = 3 + Math.floor((floor - 30) / 15);
  else                  teamSize = Math.min(6, 4 + Math.floor((floor - 60) / 20));
  const minRarity = Math.min(5, 1 + Math.floor(floor / 12));
  const pool = GameData.POKEDEX.filter(p => (p.rarity || 1) >= Math.max(1, minRarity - 1));
  const team = [];
  for (let i = 0; i < teamSize; i++) {
    const sp = pool[Math.floor(Math.random() * pool.length)];
    const lvl = baseLevel + Math.floor(Math.random() * 5) - 2;
    const ivs = { hp: 15+Math.floor(Math.random()*16), atk: 15+Math.floor(Math.random()*16), def: 15+Math.floor(Math.random()*16), spd: 15+Math.floor(Math.random()*16) };
    team.push({ species: sp, level: Math.max(2, lvl), ivs, slot: i });
  }
  return team;
}

function towerRewardForFloor(floor) {
  let gold = 8 + Math.floor(floor * 1.2);
  let xp   = 12 + Math.floor(floor * 1.8);
  let bonus = null;
  if (floor % 10 === 0) {
    gold = Math.floor(gold * 1.6);
    xp   = Math.floor(xp * 1.4);
    if (floor >= 100)      bonus = { ball: 'masterball', count: 1 };
    else if (floor >= 50)  bonus = { ball: 'hyperball',  count: 2 };
    else if (floor >= 30)  bonus = { ball: 'hyperball',  count: 1 };
    else if (floor >= 20)  bonus = { ball: 'superball',  count: 2 };
    else                   bonus = { ball: 'pokeball',   count: 3 };
  }
  return { gold, xp, bonus };
}

// Build the player team from a formation (array of caughtIds, length 6, nullable).
// Validates ownership and removes invalid entries.
function buildTeamFromFormation(user, formation) {
  if (!Array.isArray(formation) || formation.length !== 6) {
    formation = Array.isArray(user.formation) ? user.formation : (user.party || []).slice(0, 6).concat([null,null,null,null,null,null]).slice(0,6);
  }
  const team = [];
  for (let slot = 0; slot < 6; slot++) {
    const cid = formation[slot];
    if (!Number.isFinite(cid)) continue;
    const c = stmt.getOneCaught.get(cid, user.id);
    if (!c) continue;
    const sp = GameData.POKEMON_BY_ID[c.pokemon_id];
    if (!sp) continue;
    let ivs;
    try { ivs = JSON.parse(c.ivs_json); } catch { ivs = {}; }
    team.push({ species: sp, level: c.level || 5, ivs, isShiny: !!c.is_shiny, slot, caughtId: c.id });
  }
  return team;
}

// Cache enemy teams between preview and battle-start so the user sees the same
// team they previewed.
const previewedEnemies = new Map();
function _previewKey(userId) { return userId; }
function _consumePreview(userId, kind, targetUserId) {
  const p = previewedEnemies.get(userId);
  if (!p) return null;
  if (Date.now() > p.expiresAt) { previewedEnemies.delete(userId); return null; }
  if (p.kind !== kind) return null;
  if (kind === 'pvp' && p.targetUserId !== targetUserId) return null;
  return p;
}
function _enemyPublic(enemyTeam) {
  return enemyTeam.map((m, i) => ({
    slot: (m.slot != null) ? m.slot : i,
    speciesId: m.species.id,
    name: m.species.name,
    spriteUrl: m.isShiny ? m.species.spriteShinyUrl : m.species.spriteUrl,
    type: m.species.type,
    level: m.level,
    isShiny: !!m.isShiny,
  }));
}

function previewBattle(userId, kind, targetUserId) {
  const user = stmt.getUserById.get(userId);
  if (!user) return { ok: false, reason: 'No user' };
  let enemyTeam, towerFloor = 0;
  if (kind === 'tower') {
    towerFloor = (user.tower_floor || 0) + 1;
    enemyTeam = _generateTowerTeam(towerFloor);
  } else if (kind === 'pvp') {
    if (!Number.isFinite(targetUserId)) return { ok: false, reason: 'Invalid target' };
    if (targetUserId === userId) return { ok: false, reason: 'Cannot fight yourself' };
    const target = stmt.getUserById.get(targetUserId);
    if (!target) return { ok: false, reason: 'User not found' };
    enemyTeam = buildTeamFromFormation(target, target.formation);
    if (!enemyTeam.length) return { ok: false, reason: 'Opponent has no formation set' };
  } else return { ok: false, reason: 'Invalid kind' };
  previewedEnemies.set(_previewKey(userId), {
    kind, team: enemyTeam, towerFloor, targetUserId: targetUserId || null,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return { ok: true, preview: { kind, towerFloor, enemyTeam: _enemyPublic(enemyTeam) } };
}

function startTowerArena(userId, formation, onFinish) {
  const user = stmt.getUserById.get(userId);
  if (!user) return { ok: false, reason: 'No user' };
  const playerTeam = buildTeamFromFormation(user, formation);
  if (!playerTeam.length) return { ok: false, reason: 'Place at least one Pokemon in the formation' };
  if (formation && Array.isArray(formation)) stmt.setFormation.run(formation, userId);
  const existing = activeMatches.get(userId);
  if (existing && !existing.over) return { ok: false, reason: 'Already in battle' };
  const cached = _consumePreview(userId, 'tower');
  const floor = cached ? cached.towerFloor : ((user.tower_floor || 0) + 1);
  const enemyDef = cached ? cached.team : _generateTowerTeam(floor);
  if (cached) previewedEnemies.delete(_previewKey(userId));
  const reward = towerRewardForFloor(floor);
  const match = startMatch({
    userId, playerTeam, enemyTeam: enemyDef,
    isTower: true, towerFloor: floor, reward, onFinish,
  });
  return { ok: true, match };
}

function startPvpArena(userId, targetUserId, formation, onFinish) {
  if (userId === targetUserId) return { ok: false, reason: 'Cannot fight yourself' };
  const user   = stmt.getUserById.get(userId);
  const target = stmt.getUserById.get(targetUserId);
  if (!user || !target) return { ok: false, reason: 'User not found' };
  const playerTeam = buildTeamFromFormation(user, formation);
  if (!playerTeam.length) return { ok: false, reason: 'Place at least one Pokemon in the formation' };
  if (formation && Array.isArray(formation)) stmt.setFormation.run(formation, userId);
  const cached = _consumePreview(userId, 'pvp', targetUserId);
  const enemyTeam = cached ? cached.team : buildTeamFromFormation(target, target.formation);
  if (cached) previewedEnemies.delete(_previewKey(userId));
  if (!enemyTeam.length) return { ok: false, reason: 'Opponent has no formation set' };
  const existing = activeMatches.get(userId);
  if (existing && !existing.over) return { ok: false, reason: 'Already in battle' };
  const match = startMatch({
    userId, playerTeam, enemyTeam,
    reward: { gold: 60, xp: 40, bonus: null }, onFinish,
  });
  return { ok: true, match };
}

module.exports = {
  startMatch, getMatch, endMatch, forfeitMatch, startTicking, publicMatch,
  buildArenaPokemon, FIELD_W, FIELD_H, TURN_INTERVAL_MS,
  startTowerArena, startPvpArena, towerRewardForFloor,
  previewBattle,
};
