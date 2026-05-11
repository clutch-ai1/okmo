// server/battle.js
const { stmt } = require('./db');
const { GameData, applyXpToPokemon, getEvolution, rollEggDropFromBattle, EGG_TIERS } = require('./data');

const TYPE_CHART = {
  normal:   { rock: 0.5, ghost: 0, steel: 0.5 },
  fire:     { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water:    { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass:    { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice:      { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison:   { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground:   { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying:   { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic:  { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug:      { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock:     { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost:    { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon:   { dragon: 2, steel: 0.5, fairy: 0 },
  dark:     { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel:    { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy:    { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};
function effectiveness(moveType, defType) {
  const row = TYPE_CHART[moveType] || {};
  return row[defType] !== undefined ? row[defType] : 1;
}
function effectivenessText(mult) {
  if (mult === 0) return 'It had no effect...';
  if (mult >= 2)  return "It's super effective!";
  if (mult > 0 && mult <= 0.5) return "It's not very effective...";
  return '';
}

function rollStatusFromMove(move, defender) {
  if (!move) return null;
  if (defender.status) return null;
  const r = Math.random();
  if (move.id === 'thunder_wave' || (move.type === 'electric' && move.cat === 'special' && r < 0.10)) return 'paralysis';
  if (move.id === 'toxic') return 'badly_poisoned';
  if (move.type === 'poison' && move.cat === 'physical' && r < 0.30) return 'poisoned';
  if (move.type === 'fire' && move.power > 0 && r < 0.10) return 'burn';
  if (move.id === 'hypnosis' || move.id === 'sweet_kiss') return r < 0.6 ? 'sleep' : null;
  if (move.type === 'ice' && move.power > 0 && r < 0.10) return 'freeze';
  return null;
}
function statusName(s) {
  if (s === 'paralysis') return 'paralyzed';
  if (s === 'poisoned')  return 'poisoned';
  if (s === 'badly_poisoned') return 'badly poisoned';
  if (s === 'burn') return 'burned';
  if (s === 'sleep') return 'asleep';
  if (s === 'freeze') return 'frozen';
  return '';
}
function preMoveStatusCheck(mon) {
  if (!mon.status) return { skip: false };
  if (mon.status === 'sleep') {
    mon.statusCounter = (mon.statusCounter || 0) - 1;
    if (mon.statusCounter <= 0) {
      mon.status = null; mon.statusCounter = 0;
      return { skip: false, log: mon.name + ' woke up!' };
    }
    return { skip: true, log: mon.name + ' is fast asleep!' };
  }
  if (mon.status === 'freeze') {
    if (Math.random() < 0.20) {
      mon.status = null;
      return { skip: false, log: mon.name + ' thawed out!' };
    }
    return { skip: true, log: mon.name + ' is frozen solid!' };
  }
  if (mon.status === 'paralysis') {
    if (Math.random() < 0.25) return { skip: true, log: mon.name + ' is paralyzed!' };
  }
  return { skip: false };
}
function endOfTurnStatus(mon) {
  if (!mon.status || mon.fainted) return null;
  if (mon.status === 'poisoned') {
    const dmg = Math.max(1, Math.floor(mon.maxHp / 8));
    mon.hp = Math.max(0, mon.hp - dmg);
    if (mon.hp === 0) mon.fainted = true;
    return { dmg, log: mon.name + ' is hurt by poison! (-' + dmg + ')' };
  }
  if (mon.status === 'badly_poisoned') {
    mon.toxicCounter = (mon.toxicCounter || 0) + 1;
    const dmg = Math.max(1, Math.floor(mon.maxHp * mon.toxicCounter / 16));
    mon.hp = Math.max(0, mon.hp - dmg);
    if (mon.hp === 0) mon.fainted = true;
    return { dmg, log: mon.name + ' is badly poisoned! (-' + dmg + ')' };
  }
  if (mon.status === 'burn') {
    const dmg = Math.max(1, Math.floor(mon.maxHp / 16));
    mon.hp = Math.max(0, mon.hp - dmg);
    if (mon.hp === 0) mon.fainted = true;
    return { dmg, log: mon.name + ' is hurt by its burn! (-' + dmg + ')' };
  }
  return null;
}

function baseStatsForRarity(rarity) {
  if (rarity >= 5) return { hp: 95, atk: 100, def: 85, spAtk: 95, spDef: 85, spd: 95 };
  if (rarity === 4) return { hp: 80, atk: 85, def: 75, spAtk: 80, spDef: 75, spd: 75 };
  if (rarity === 3) return { hp: 65, atk: 70, def: 60, spAtk: 65, spDef: 60, spd: 65 };
  if (rarity === 2) return { hp: 50, atk: 55, def: 50, spAtk: 50, spDef: 50, spd: 55 };
  return                  { hp: 35, atk: 40, def: 35, spAtk: 35, spDef: 35, spd: 45 };
}
function calcStats(species, level, ivs) {
  const base = baseStatsForRarity(species.rarity || 1);
  const lvl = Math.max(1, level || 1);
  const calc = (b, iv) => Math.floor(((2 * b + (iv||0)) * lvl) / 100) + 5;
  return {
    hp: Math.floor(((2 * base.hp + (ivs.hp || 0)) * lvl) / 100) + lvl + 10,
    atk: calc(base.atk, ivs.atk), def: calc(base.def, ivs.def),
    spAtk: calc(base.spAtk, ivs.spAtk), spDef: calc(base.spDef, ivs.spDef),
    spd: calc(base.spd, ivs.spd),
  };
}
function calcDamage(attacker, defender, move) {
  if (!move || move.cat === 'status' || move.power === 0) return { dmg: 0, eff: 1, crit: false };
  const isPhysical = move.cat === 'physical';
  const atk = isPhysical ? attacker.stats.atk : attacker.stats.spAtk;
  const def = isPhysical ? defender.stats.def : defender.stats.spDef;
  const stab = move.type === attacker.type ? 1.5 : 1;
  const eff = effectiveness(move.type, defender.type);
  const crit = Math.random() < 0.0625;
  const critMult = crit ? 1.5 : 1;
  const random = 0.85 + Math.random() * 0.15;
  const dmg = ((((2 * attacker.level / 5 + 2) * move.power * atk / def) / 50) + 2) * stab * eff * critMult * random;
  return { dmg: Math.max(eff > 0 ? 1 : 0, Math.floor(dmg)), eff, crit };
}
function moveHits(move) {
  if (!move || move.acc >= 100) return true;
  return Math.random() * 100 < move.acc;
}

const NPCS = [
  { id: 'youngster_jim', name: 'Youngster Jim', emoji: 'YJ', desc: 'A new trainer eager for his first win.',
    team: [
      { species: 'rattata',  level: 6, moves: ['tackle', 'tail_whip'] },
      { species: 'pidgey',   level: 7, moves: ['tackle', 'gust'] },
    ], reward: { gold: 30, xp: 30 } },
  { id: 'bug_catcher_sam', name: 'Bug Catcher Sam', emoji: 'BC', desc: 'Loves bugs. Annoyingly persistent.',
    team: [
      { species: 'caterpie', level: 8,  moves: ['tackle', 'string_shot'] },
      { species: 'weedle',   level: 8,  moves: ['poison_sting', 'string_shot'] },
      { species: 'metapod',  level: 10, moves: ['tackle'] },
    ], reward: { gold: 60, xp: 50 } },
  { id: 'hiker_don', name: 'Hiker Don', emoji: 'HK', desc: 'Mountain veteran. Rocks ahead.',
    team: [
      { species: 'geodude',   level: 12, moves: ['tackle', 'rock_throw'] },
      { species: 'sandshrew', level: 13, moves: ['scratch', 'sand_attack'] },
      { species: 'graveler',  level: 14, moves: ['rock_throw', 'tackle'] },
    ], reward: { gold: 110, xp: 90 } },
  { id: 'gym_brock', name: 'Gym Leader Brock', emoji: 'GL', desc: 'The Pewter Gym Leader. Rock-solid trainer.',
    team: [
      { species: 'geodude',  level: 18, moves: ['tackle', 'rock_throw', 'dig'] },
      { species: 'onix',     level: 22, moves: ['rock_throw', 'tackle', 'dig'] },
      { species: 'graveler', level: 24, moves: ['rock_slide', 'tackle'] },
    ], reward: { gold: 250, xp: 200 } },
];
const NPC_COOLDOWN_MS = 30 * 60 * 1000;
function getNpcs(userId) {
  const user = userId ? stmt.getUserById.get(userId) : null;
  const cds = (user && user.npc_cooldowns) || {};
  const now = Date.now();
  return NPCS.map(n => {
    const until = cds[n.id] || 0;
    return {
      id: n.id, name: n.name, emoji: n.emoji, desc: n.desc, partySize: n.team.length, reward: n.reward,
      cooldownUntil: until, cooldownMs: Math.max(0, until - now),
    };
  });
}

function buildPlayerPokemon(c) {
  const species = GameData.POKEMON_BY_ID[c.pokemon_id];
  if (!species) return null;
  const ivs = JSON.parse(c.ivs_json);
  const moves = c.moves_json ? JSON.parse(c.moves_json) : [];
  const level = c.level || 5;
  const stats = calcStats(species, level, ivs);
  return {
    instanceId: c.id, side: 'player',
    speciesId: species.id, name: species.name, type: species.type, color: species.color,
    spriteUrl: species.spriteUrl, spriteShinyUrl: species.spriteShinyUrl, isShiny: !!c.is_shiny,
    level, ivs, moves: moves.length ? moves : ['tackle'],
    stats, hp: stats.hp, maxHp: stats.hp, fainted: false,
  };
}
function buildNpcPokemon(t) {
  const species = GameData.POKEMON_BY_ID[t.species];
  if (!species) return null;
  const ivs = { hp: 12+Math.floor(Math.random()*12), atk: 12+Math.floor(Math.random()*12), def: 12+Math.floor(Math.random()*12),
                spAtk: 12+Math.floor(Math.random()*12), spDef: 12+Math.floor(Math.random()*12), spd: 12+Math.floor(Math.random()*12) };
  const moves = (t.moves || ['tackle']).filter(m => GameData.MOVE_BY_ID[m]);
  if (!moves.length) moves.push('tackle');
  const stats = calcStats(species, t.level, ivs);
  return {
    side: 'npc',
    speciesId: species.id, name: species.name, type: species.type, color: species.color,
    spriteUrl: species.spriteUrl, spriteShinyUrl: species.spriteShinyUrl, isShiny: false,
    level: t.level, ivs, moves,
    stats, hp: stats.hp, maxHp: stats.hp, fainted: false,
  };
}

function publicMon(m) {
  return {
    speciesId: m.speciesId, name: m.name, type: m.type, color: m.color,
    spriteUrl: m.spriteUrl, spriteShinyUrl: m.spriteShinyUrl, isShiny: m.isShiny,
    level: m.level, hp: m.hp, maxHp: m.maxHp, fainted: m.fainted,
    moves: m.moves, instanceId: m.instanceId,
    status: m.status || null,
  };
}
function publicBattle(b) {
  return {
    npcId: b.npcId, npcName: b.npcName, npcEmoji: b.npcEmoji, npcDesc: b.npcDesc,
    playerTeam: b.playerTeam.map(publicMon), npcTeam: b.npcTeam.map(publicMon),
    playerActive: b.playerActive, npcActive: b.npcActive,
    turn: b.turn, log: b.log.slice(-12),
    over: b.over, winner: b.winner, reward: b.reward,
    partyProgression: b.partyProgression || null,
    cooldownUntil: b.cooldownUntil || null,
    eggDrop: b.eggDrop || null,
  };
}

const activeBattles = new Map();

function startBattle(userId, npcId) {
  const npc = NPCS.find(n => n.id === npcId);
  if (!npc) return { ok: false, reason: 'No such trainer' };
  const user = stmt.getUserById.get(userId);
  if (!user) return { ok: false, reason: 'No user' };
  if (!Array.isArray(user.party) || user.party.length === 0) return { ok: false, reason: 'Build a Party first' };
  const existing = activeBattles.get(userId);
  if (existing) {
    if (!existing.over) return { ok: false, reason: 'Already in battle', battle: publicBattle(existing) };
    activeBattles.delete(userId);
  }
  const cds = (user.npc_cooldowns) || {};
  const until = cds[npcId] || 0;
  const now = Date.now();
  if (until > now) {
    const mins = Math.ceil((until - now) / 60000);
    return { ok: false, reason: 'On cooldown - try again in ~' + mins + ' min', cooldownMs: until - now };
  }
  const playerTeam = user.party.map(id => {
    const c = stmt.getOneCaught.get(id, userId);
    return c ? buildPlayerPokemon(c) : null;
  }).filter(Boolean);
  if (playerTeam.length === 0) return { ok: false, reason: 'Party is empty' };
  const npcTeam = npc.team.map(t => buildNpcPokemon(t)).filter(Boolean);
  if (npcTeam.length === 0) return { ok: false, reason: 'NPC team build error' };
  const battle = {
    userId, npcId: npc.id, npcName: npc.name, npcEmoji: npc.emoji, npcDesc: npc.desc,
    playerTeam, npcTeam, playerActive: 0, npcActive: 0, turn: 'player',
    log: [npc.name + ' wants to battle!',
          npc.name + ' sent out ' + npcTeam[0].name + '!',
          'Go, ' + playerTeam[0].name + '!'],
    over: false, winner: null, reward: npc.reward,
  };
  activeBattles.set(userId, battle);
  return { ok: true, battle: publicBattle(battle) };
}

function pickNpcMove(npcMon, target) {
  let best = npcMon.moves[0];
  let bestScore = -1;
  for (const id of npcMon.moves) {
    const m = GameData.MOVE_BY_ID[id]; if (!m) continue;
    let score = 0;
    if (m.power > 0) {
      const stab = m.type === npcMon.type ? 1.5 : 1;
      const eff = effectiveness(m.type, target.type);
      score = m.power * stab * eff * (m.acc / 100);
    } else { score = 5; }
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

function executeMove(battle, attacker, defender, moveId) {
  const move = GameData.MOVE_BY_ID[moveId];
  if (!move) return;
  const pre = preMoveStatusCheck(attacker);
  if (pre.log) battle.log.push(pre.log);
  if (pre.skip) return;
  battle.log.push(attacker.name + ' used ' + move.name + '!');
  if (!moveHits(move)) { battle.log.push('It missed!'); return; }
  if (move.power > 0 && move.cat !== 'status') {
    const r = calcDamage(attacker, defender, move);
    let finalDmg = r.dmg;
    if (attacker.status === 'burn' && move.cat === 'physical') finalDmg = Math.max(1, Math.floor(finalDmg / 2));
    defender.hp = Math.max(0, defender.hp - finalDmg);
    let line = 'Dealt ' + finalDmg + ' damage';
    if (r.crit) line += ' - CRIT!';
    battle.log.push(line);
    const eft = effectivenessText(r.eff);
    if (eft) battle.log.push(eft);
    if (defender.hp === 0) defender.fainted = true;
  }
  const newStatus = rollStatusFromMove(move, defender);
  if (newStatus && !defender.fainted) {
    defender.status = newStatus;
    if (newStatus === 'sleep') defender.statusCounter = 1 + Math.floor(Math.random() * 3);
    if (newStatus === 'badly_poisoned') defender.toxicCounter = 0;
    battle.log.push(defender.name + ' is now ' + statusName(newStatus) + '!');
  }
}

function resolveTurn(battle, playerMoveId) {
  const player = battle.playerTeam[battle.playerActive];
  const npc = battle.npcTeam[battle.npcActive];
  const npcMoveId = pickNpcMove(npc, player);
  const pSpd = player.status === 'paralysis' ? player.stats.spd * 0.5 : player.stats.spd;
  const nSpd = npc.status === 'paralysis' ? npc.stats.spd * 0.5 : npc.stats.spd;
  const order = pSpd >= nSpd ? ['player','npc'] : ['npc','player'];
  for (const turn of order) {
    if (battle.over) break;
    if (player.fainted || npc.fainted) break;
    if (turn === 'player') executeMove(battle, player, npc, playerMoveId);
    else executeMove(battle, npc, player, npcMoveId);
  }
  const pStat = endOfTurnStatus(player);
  if (pStat) battle.log.push(pStat.log);
  const nStat = endOfTurnStatus(npc);
  if (nStat) battle.log.push(nStat.log);
  if (player.fainted) {
    battle.log.push(player.name + ' fainted!');
    const next = battle.playerTeam.findIndex((p, i) => i > battle.playerActive && !p.fainted);
    if (next >= 0) { battle.playerActive = next; battle.log.push('Go, ' + battle.playerTeam[next].name + '!'); }
    else { battle.over = true; battle.winner = 'npc'; battle.log.push('You have no Pokemon left! ' + battle.npcName + ' wins!'); finishBattle(battle); return; }
  }
  if (npc.fainted) {
    battle.log.push(battle.npcName + "'s " + npc.name + ' fainted!');
    const next = battle.npcTeam.findIndex((p, i) => i > battle.npcActive && !p.fainted);
    if (next >= 0) { battle.npcActive = next; battle.log.push(battle.npcName + ' sent out ' + battle.npcTeam[next].name + '!'); }
    else { battle.over = true; battle.winner = 'player'; battle.log.push('You defeated ' + battle.npcName + '!'); finishBattle(battle); return; }
  }
  battle.turn = 'player';
}

function chooseMove(userId, moveId) {
  const battle = activeBattles.get(userId);
  if (!battle) return { ok: false, reason: 'No active battle' };
  if (battle.over) return { ok: false, reason: 'Battle is over' };
  if (battle.turn !== 'player') return { ok: false, reason: 'Not your turn' };
  const player = battle.playerTeam[battle.playerActive];
  if (!player.moves.includes(moveId)) return { ok: false, reason: 'You do not know that move' };
  resolveTurn(battle, moveId);
  return { ok: true, battle: publicBattle(battle) };
}

function finishBattle(battle) {
  const userId = battle.userId;
  const win = battle.winner === 'player';
  if (!battle.isTower && !battle.isPvp) {
    const cdUntil = Date.now() + NPC_COOLDOWN_MS;
    stmt.setNpcCooldown.run(battle.npcId, cdUntil, userId);
    battle.cooldownUntil = cdUntil;
  }
  // PvP: track wins/losses for both players
  if (battle.isPvp && stmt.recordPvp) {
    stmt.recordPvp.run(userId, win ? 'win' : 'loss');
    if (battle.targetUserId) stmt.recordPvp.run(battle.targetUserId, win ? 'loss' : 'win');
  }
  if (battle.isTower && win) {
    const user = stmt.getUserById.get(userId);
    if (user) {
      user.tower_floor = battle.towerFloor;
      if (battle.towerFloor > (user.tower_best_floor || 0)) user.tower_best_floor = battle.towerFloor;
      stmt.addGold.run(0, userId);
      battle.log.push('Climbed to Floor ' + battle.towerFloor + '!');
      if (battle.reward.bonus) {
        const b = battle.reward.bonus;
        stmt.awardBall.run(b.ball, b.count, userId);
        const ballName = (GameData.BALL_BY_ID[b.ball] && GameData.BALL_BY_ID[b.ball].name) || b.ball;
        battle.log.push('Floor bonus: ' + b.count + 'x ' + ballName);
      }
    }
  }
  if (win) {
    if (battle.reward.gold) stmt.addGold.run(battle.reward.gold, userId);
    const xpEach = battle.reward.xp || 50;
    battle.partyProgression = [];
    for (const p of battle.playerTeam) {
      const c = stmt.getOneCaught.get(p.instanceId, userId);
      if (!c) continue;
      const r = applyXpToPokemon(c.level || 1, c.xp || 0, xpEach);
      stmt.updateCaughtLevel.run(r.newLevel, r.newXp, c.id, userId);
      const entry = { instanceId: c.id, pokemonName: p.name, pokemonId: p.speciesId,
        xpGained: xpEach, newLevel: r.newLevel, newXp: r.newXp, levelUps: r.levelUps };
      if (r.levelUps.length) {
        const evo = getEvolution(c.pokemon_id, r.newLevel);
        if (evo && GameData.POKEMON_BY_ID[evo.to]) {
          stmt.evolveCaught.run(evo.to, c.id, userId);
          const newSp = GameData.POKEMON_BY_ID[evo.to];
          entry.evolved = { fromId: c.pokemon_id, toId: evo.to,
            fromName: GameData.POKEMON_BY_ID[c.pokemon_id].name, toName: newSp.name,
            fromSprite: GameData.POKEMON_BY_ID[c.pokemon_id].spriteUrl, toSprite: newSp.spriteUrl };
          entry.pokemonId = evo.to; entry.pokemonName = newSp.name;
        }
      }
      battle.partyProgression.push(entry);
    }
    battle.log.push('Earned ' + battle.reward.gold + ' gold');
    battle.log.push('Each party Pokemon gained ' + xpEach + ' XP');
    if (!battle.isTower) {
      const eggTierId = rollEggDropFromBattle();
      if (eggTierId && EGG_TIERS[eggTierId]) {
        const newEgg = stmt.addEgg.run(eggTierId, userId);
        battle.eggDrop = { tier: eggTierId, name: EGG_TIERS[eggTierId].name, eggId: newEgg ? newEgg.id : null };
        battle.log.push('You found a ' + EGG_TIERS[eggTierId].name + '!');
      }
    }
  } else {
    battle.log.push('You earned 5 gold for trying.');
    stmt.addGold.run(5, userId);
  }
  setTimeout(() => activeBattles.delete(userId), 3000);
}

function forfeit(userId) {
  const battle = activeBattles.get(userId);
  if (!battle) return { ok: false };
  battle.over = true; battle.winner = 'npc';
  battle.log.push('You ran from the battle.');
  activeBattles.delete(userId);
  return { ok: true, battle: publicBattle(battle) };
}

function getBattle(userId) {
  const b = activeBattles.get(userId);
  return b ? publicBattle(b) : null;
}

function _generateTowerTeam(floor) {
  const baseLevel = Math.min(95, Math.floor(5 + floor * 0.8));
  let teamSize;
  if (floor <= 10) teamSize = 1 + Math.floor(floor / 5);
  else if (floor <= 30) teamSize = 2 + Math.floor((floor - 10) / 10);
  else if (floor <= 60) teamSize = 3 + Math.floor((floor - 30) / 15);
  else teamSize = Math.min(6, 4 + Math.floor((floor - 60) / 20));
  const minRarity = Math.min(5, 1 + Math.floor(floor / 12));
  const pool = GameData.POKEDEX.filter(p => (p.rarity || 1) >= Math.max(1, minRarity - 1));
  const team = [];
  for (let i = 0; i < teamSize; i++) {
    const sp = pool[Math.floor(Math.random() * pool.length)];
    const lvl = baseLevel + Math.floor(Math.random() * 5) - 2;
    const universal = ['tackle','quick_attack','body_slam','hyper_beam'];
    const typed = GameData.MOVES.filter(m => m.type === sp.type && m.power > 0).map(m => m.id);
    const movePool = [...new Set([...universal, ...typed])];
    const moves = [];
    while (moves.length < Math.min(4, movePool.length)) {
      const m = movePool[Math.floor(Math.random() * movePool.length)];
      if (!moves.includes(m)) moves.push(m);
    }
    team.push({ species: sp.id, level: Math.max(2, lvl), moves });
  }
  return team;
}
function towerRewardForFloor(floor) {
  // NERFED — tower is the only reliable battle income, but progress should feel earned.
  let gold = 8 + Math.floor(floor * 1.2);
  let xp  = 12 + Math.floor(floor * 1.8);
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
function startTowerBattle(userId) {
  const user = stmt.getUserById.get(userId);
  if (!user) return { ok: false, reason: 'No user' };
  if (!Array.isArray(user.party) || user.party.length === 0) return { ok: false, reason: 'Build a party first' };
  const existing = activeBattles.get(userId);
  if (existing) {
    if (!existing.over) return { ok: false, reason: 'Already in battle', battle: publicBattle(existing) };
    activeBattles.delete(userId);
  }
  const floor = (user.tower_floor || 0) + 1;
  const team = _generateTowerTeam(floor);
  const reward = towerRewardForFloor(floor);
  const playerTeam = user.party.map(id => {
    const c = stmt.getOneCaught.get(id, userId);
    return c ? buildPlayerPokemon(c) : null;
  }).filter(Boolean);
  if (!playerTeam.length) return { ok: false, reason: 'Party is empty' };
  const npcTeam = team.map(t => buildNpcPokemon(t)).filter(Boolean);
  if (!npcTeam.length) return { ok: false, reason: 'Tower team build error' };
  const battle = {
    userId, npcId: 'tower_' + floor, npcName: 'Tower Floor ' + floor, npcEmoji: 'TW',
    npcDesc: 'Battle Tower endless mode',
    playerTeam, npcTeam, playerActive: 0, npcActive: 0, turn: 'player',
    log: ['Battle Tower - Floor ' + floor,
          'A challenger has ' + npcTeam.length + ' Pokemon!',
          'Go, ' + playerTeam[0].name + '!'],
    over: false, winner: null,
    reward: { gold: reward.gold, xp: reward.xp, bonus: reward.bonus },
    isTower: true, towerFloor: floor,
  };
  activeBattles.set(userId, battle);
  return { ok: true, battle: publicBattle(battle) };
}

// ---------- PvP Battles ----------
function startPvpBattle(challengerId, targetUserId) {
  const challenger = stmt.getUserById.get(challengerId);
  const target = stmt.getUserById.get(targetUserId);
  if (!challenger || !target) return { ok: false, reason: 'No such player' };
  if (challenger.id === target.id) return { ok: false, reason: "Can't challenge yourself" };
  if (!Array.isArray(challenger.party) || !challenger.party.length) return { ok: false, reason: 'Build a party first' };
  if (!Array.isArray(target.party) || !target.party.length) return { ok: false, reason: target.username + ' has no party' };
  const existing = activeBattles.get(challengerId);
  if (existing) {
    if (!existing.over) return { ok: false, reason: 'Already in battle', battle: publicBattle(existing) };
    activeBattles.delete(challengerId);
  }
  const playerTeam = challenger.party.map(id => {
    const c = stmt.getOneCaught.get(id, challengerId);
    return c ? buildPlayerPokemon(c) : null;
  }).filter(Boolean);
  const enemyTeam = target.party.map(id => {
    const c = stmt.getOneCaught.get(id, targetUserId);
    if (!c) return null;
    const built = buildPlayerPokemon(c);
    if (built) built.side = 'npc';
    return built;
  }).filter(Boolean);
  if (!playerTeam.length || !enemyTeam.length) return { ok: false, reason: 'Team build error' };
  const battle = {
    userId: challengerId,
    npcId: 'pvp_' + target.id,
    npcName: target.username,
    npcEmoji: 'PvP',
    npcDesc: 'PvP duel vs ' + target.username,
    playerTeam, npcTeam: enemyTeam,
    playerActive: 0, npcActive: 0, turn: 'player',
    log: ['PvP DUEL: ' + challenger.username + ' VS ' + target.username,
          target.username + "'s " + enemyTeam[0].name + ' is out!',
          'Go, ' + playerTeam[0].name + '!'],
    over: false, winner: null,
    reward: { gold: 50 + (target.level || 1) * 5, xp: 30 + (target.level || 1) * 3 },
    targetUserId: target.id,
  };
  activeBattles.set(challengerId, battle);
  return { ok: true, battle: publicBattle(battle) };
}

module.exports = { getNpcs, startBattle, startTowerBattle, startPvpBattle, chooseMove, getBattle, forfeit, calcStats, calcDamage, effectiveness };
