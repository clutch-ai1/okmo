// server/data.js
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');
const ctx = { window: {}, console };
const vm = require('vm');
vm.createContext(ctx);
vm.runInContext(code, ctx);
const GameData = ctx.window.GameData;

// ---------- IVs ----------
function rollSingleIV() {
  const v = Math.floor(Math.random() * 32);
  if (v >= 24 && Math.random() < 0.45) return Math.floor(Math.random() * 24);
  return v;
}
function rollIVs() {
  const stats = ['hp','atk','def','spAtk','spDef','spd'];
  const ivs = {};
  for (const s of stats) ivs[s] = rollSingleIV();
  return ivs;
}
function ivTotal(ivs)      { return ivs.hp + ivs.atk + ivs.def + ivs.spAtk + ivs.spDef + ivs.spd; }
function ivPercent(ivs)    { return ivTotal(ivs) / 186; }
function ivDifficulty(ivs) { return 1 + ivPercent(ivs) * 0.15; }

function pickRandomEncounter(areaId) {
  const area = GameData.AREA_BY_ID[areaId] || GameData.AREAS[0];
  const total = area.spawnPool.reduce((a, b) => a + b.weight, 0);
  let r = Math.random() * total;
  for (const sp of area.spawnPool) {
    r -= sp.weight;
    if (r <= 0) return GameData.POKEMON_BY_ID[sp.id];
  }
  return GameData.POKEMON_BY_ID[area.spawnPool[0].id];
}

// ---------- Legendary Spawns ----------
const LEGENDARY_INTERVAL = 6;
const LEGENDARY_POOL = ['mewtwo','mew','articuno','zapdos','moltres','dragonite','snorlax','lapras','aerodactyl','gyarados','dragonair','kabutops','omastar','alakazam','machamp'];
function pickLegendary() {
  const pool = LEGENDARY_POOL.filter(id => GameData.POKEMON_BY_ID[id]);
  return GameData.POKEMON_BY_ID[pool[Math.floor(Math.random() * pool.length)]];
}

// ---------- Trainer XP / Levels ----------
function xpForLevelUp(level) { return level * 100; }
function totalXpForLevel(level) { return 50 * level * (level - 1); }
function levelFromTotalXp(totalXp) {
  let lvl = 1;
  while (totalXpForLevel(lvl + 1) <= totalXp) lvl++;
  return Math.min(50, lvl);
}
function xpForCatch({ rarity = 1, ivPercent = 0.5, isShiny = false, isLegendary = false, streak = 0 }) {
  let xp = 10 + rarity * 10;
  xp += Math.floor(ivPercent * 30);
  if (isShiny) xp += 200;
  if (isLegendary) xp += 500;
  xp += Math.min(50, streak * 5);
  return xp;
}
function levelUpReward(level) {
  if (level === 3)  return { ball: 'pokeball',   count: 5  };
  if (level === 5)  return { ball: 'superball',  count: 3  };
  if (level === 8)  return { ball: 'superball',  count: 5  };
  if (level === 10) return { ball: 'hyperball',  count: 3  };
  if (level === 15) return { ball: 'hyperball',  count: 5  };
  if (level === 20) return { ball: 'masterball', count: 1  };
  if (level === 25) return { ball: 'hyperball',  count: 10 };
  if (level === 30) return { ball: 'masterball', count: 1  };
  if (level === 40) return { ball: 'masterball', count: 2  };
  if (level === 50) return { ball: 'masterball', count: 5  };
  if (level % 2 === 0) return { ball: 'pokeball', count: 3 };
  return { ball: 'superball', count: 1 };
}

// ---------- Daily Quests ----------
const DAILY_QUEST_DEFS = [
  { id: 'catch_5',   label: 'Catch 5 Pokemon',   target: 5,
    onCatch: () => 1, reward: { ball: 'superball', count: 2 } },
  { id: 'catch_10',  label: 'Catch 10 Pokemon',  target: 10,
    onCatch: () => 1, reward: { ball: 'superball', count: 4 } },
  { id: 'iv_140',    label: 'Catch a Pokemon with 140+ IV total', target: 1,
    onCatch: (ctx) => ctx.ivTotal >= 140 ? 1 : 0, reward: { ball: 'hyperball', count: 2 } },
  { id: 'iv_160',    label: 'Catch a Pokemon with 160+ IV total', target: 1,
    onCatch: (ctx) => ctx.ivTotal >= 160 ? 1 : 0, reward: { ball: 'hyperball', count: 3 } },
  { id: 'use_great', label: 'Catch with a Great Ball',  target: 1,
    onCatch: (ctx) => ctx.ball === 'superball' ? 1 : 0, reward: { ball: 'superball', count: 3 } },
  { id: 'use_ultra', label: 'Catch with an Ultra Ball', target: 1,
    onCatch: (ctx) => ctx.ball === 'hyperball' ? 1 : 0, reward: { ball: 'hyperball', count: 2 } },
  { id: 'fire',      label: 'Catch a Fire-type Pokemon',     target: 1,
    onCatch: (ctx) => ctx.type === 'fire' ? 1 : 0, reward: { ball: 'superball', count: 3 } },
  { id: 'water',     label: 'Catch a Water-type Pokemon',    target: 1,
    onCatch: (ctx) => ctx.type === 'water' ? 1 : 0, reward: { ball: 'superball', count: 3 } },
  { id: 'grass',     label: 'Catch a Grass-type Pokemon',    target: 1,
    onCatch: (ctx) => ctx.type === 'grass' ? 1 : 0, reward: { ball: 'superball', count: 3 } },
  { id: 'electric',  label: 'Catch an Electric-type Pokemon', target: 1,
    onCatch: (ctx) => ctx.type === 'electric' ? 1 : 0, reward: { ball: 'hyperball', count: 1 } },
  { id: 'streak_3',  label: 'Reach a catch streak of 3',     target: 3,
    onCatch: (ctx) => ctx.streak, mode: 'max', reward: { ball: 'superball', count: 3 } },
  { id: 'streak_5',  label: 'Reach a catch streak of 5',     target: 5,
    onCatch: (ctx) => ctx.streak, mode: 'max', reward: { ball: 'hyperball', count: 2 } },
  { id: 'rare',      label: 'Catch a rare (4+ star) Pokemon', target: 1,
    onCatch: (ctx) => ctx.rarity >= 4 ? 1 : 0, reward: { ball: 'hyperball', count: 2 } },
  { id: 'legendary', label: 'Catch a Legendary',             target: 1,
    onCatch: (ctx) => ctx.isLegendary ? 1 : 0, reward: { ball: 'masterball', count: 1 } },
  { id: 'new_dex',   label: 'Catch a new species for your Pokedex', target: 1,
    onCatch: (ctx) => ctx.isNewSpecies ? 1 : 0, reward: { ball: 'hyperball', count: 1 } },
];
function pickDailyQuests() {
  const pool = [...DAILY_QUEST_DEFS];
  const out = [];
  while (out.length < 3 && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    out.push({ id: pool[i].id, progress: 0 });
    pool.splice(i, 1);
  }
  return out;
}
function questDef(id) { return DAILY_QUEST_DEFS.find(q => q.id === id); }

// ---------- Achievements ----------
const ACHIEVEMENT_DEFS = [
  { id: 'first_catch',     name: 'First Catch',         title: 'Newbie',           check: (u) => u.total_catches >= 1 },
  { id: 'catches_10',      name: '10 Catches',          title: 'Trainee',          check: (u) => u.total_catches >= 10 },
  { id: 'catches_50',      name: '50 Catches',          title: 'Hunter',           check: (u) => u.total_catches >= 50 },
  { id: 'catches_100',     name: '100 Catches',         title: 'Veteran',          check: (u) => u.total_catches >= 100 },
  { id: 'catches_500',     name: '500 Catches',         title: 'Pokemon Master',   check: (u) => u.total_catches >= 500 },
  { id: 'first_shiny',     name: 'First Shiny',         title: 'Sparkle',          check: (u, ctx) => ctx && ctx.isShiny },
  { id: 'first_legendary', name: 'Legend Caught',       title: 'Legendary Hunter', check: (u, ctx) => ctx && ctx.isLegendary && ctx.caught },
  { id: 'streak_5',        name: 'On Fire (5x streak)', title: 'On Fire',          check: (u) => (u.best_streak || 0) >= 5 },
  { id: 'streak_10',       name: 'Inferno (10x streak)',title: 'Inferno',          check: (u) => (u.best_streak || 0) >= 10 },
  { id: 'streak_20',       name: 'Unstoppable (20x)',   title: 'Unstoppable',      check: (u) => (u.best_streak || 0) >= 20 },
  { id: 'iv_perfect',      name: '180+ IV Pokemon',     title: 'Geneticist',       check: (u, ctx) => ctx && ctx.ivTotal >= 180 },
  { id: 'level_10',        name: 'Reached Level 10',    title: 'Rising Star',      check: (u) => (u.level || 1) >= 10 },
  { id: 'level_25',        name: 'Reached Level 25',    title: 'Champion',         check: (u) => (u.level || 1) >= 25 },
  { id: 'level_50',        name: 'Reached Level 50',    title: 'Grand Master',     check: (u) => (u.level || 1) >= 50 },
  { id: 'pokedex_25',      name: 'Pokedex 25/151',      title: 'Collector',        check: (u, ctx, dex) => dex >= 25 },
  { id: 'pokedex_75',      name: 'Pokedex 75/151',      title: 'Cataloguer',       check: (u, ctx, dex) => dex >= 75 },
  { id: 'pokedex_151',     name: 'Pokedex Complete',    title: 'Pokedex Master',   check: (u, ctx, dex) => dex >= 151 },
];

// ---------- Pokemon Levels (1-100) ----------
const POKEMON_MAX_LEVEL = 100;
function pokemonXpForLevelUp(level) { return level * 5; }
function pokemonXpFromCatch() { return 1; }
function applyXpToPokemon(currentLevel, currentXp, addedXp) {
  let lvl = currentLevel || 1;
  let xp = (currentXp || 0) + addedXp;
  const levelUps = [];
  while (lvl < POKEMON_MAX_LEVEL && xp >= pokemonXpForLevelUp(lvl)) {
    xp -= pokemonXpForLevelUp(lvl);
    lvl++;
    levelUps.push(lvl);
  }
  if (lvl >= POKEMON_MAX_LEVEL) xp = 0;
  return { newLevel: lvl, newXp: xp, levelUps };
}

// ---------- Evolution ----------
const EVOLUTIONS = {
  bulbasaur:{to:'ivysaur',atLevel:16},   ivysaur:{to:'venusaur',atLevel:32},
  charmander:{to:'charmeleon',atLevel:16}, charmeleon:{to:'charizard',atLevel:36},
  squirtle:{to:'wartortle',atLevel:16},  wartortle:{to:'blastoise',atLevel:36},
  caterpie:{to:'metapod',atLevel:7},     metapod:{to:'butterfree',atLevel:10},
  weedle:{to:'kakuna',atLevel:7},        kakuna:{to:'beedrill',atLevel:10},
  pidgey:{to:'pidgeotto',atLevel:18},    pidgeotto:{to:'pidgeot',atLevel:36},
  rattata:{to:'raticate',atLevel:20},    spearow:{to:'fearow',atLevel:20},
  ekans:{to:'arbok',atLevel:22},         pikachu:{to:'raichu',atLevel:30},
  sandshrew:{to:'sandslash',atLevel:22}, nidoranf:{to:'nidorina',atLevel:16},
  nidorina:{to:'nidoqueen',atLevel:30},  nidoranm:{to:'nidorino',atLevel:16},
  nidorino:{to:'nidoking',atLevel:30},   clefairy:{to:'clefable',atLevel:30},
  vulpix:{to:'ninetales',atLevel:30},    jigglypuff:{to:'wigglytuff',atLevel:30},
  zubat:{to:'golbat',atLevel:22},        oddish:{to:'gloom',atLevel:21},
  gloom:{to:'vileplume',atLevel:35},     paras:{to:'parasect',atLevel:24},
  venonat:{to:'venomoth',atLevel:31},    diglett:{to:'dugtrio',atLevel:26},
  meowth:{to:'persian',atLevel:28},      psyduck:{to:'golduck',atLevel:33},
  mankey:{to:'primeape',atLevel:28},     growlithe:{to:'arcanine',atLevel:30},
  poliwag:{to:'poliwhirl',atLevel:25},   poliwhirl:{to:'poliwrath',atLevel:35},
  abra:{to:'kadabra',atLevel:16},        kadabra:{to:'alakazam',atLevel:35},
  machop:{to:'machoke',atLevel:28},      machoke:{to:'machamp',atLevel:35},
  bellsprout:{to:'weepinbell',atLevel:21}, weepinbell:{to:'victreebel',atLevel:35},
  tentacool:{to:'tentacruel',atLevel:30}, geodude:{to:'graveler',atLevel:25},
  graveler:{to:'golem',atLevel:35},      ponyta:{to:'rapidash',atLevel:40},
  slowpoke:{to:'slowbro',atLevel:37},    magnemite:{to:'magneton',atLevel:30},
  doduo:{to:'dodrio',atLevel:31},        seel:{to:'dewgong',atLevel:34},
  grimer:{to:'muk',atLevel:38},          shellder:{to:'cloyster',atLevel:25},
  gastly:{to:'haunter',atLevel:25},      haunter:{to:'gengar',atLevel:35},
  drowzee:{to:'hypno',atLevel:26},       krabby:{to:'kingler',atLevel:28},
  voltorb:{to:'electrode',atLevel:30},   exeggcute:{to:'exeggutor',atLevel:30},
  cubone:{to:'marowak',atLevel:28},      koffing:{to:'weezing',atLevel:35},
  rhyhorn:{to:'rhydon',atLevel:42},      horsea:{to:'seadra',atLevel:32},
  goldeen:{to:'seaking',atLevel:33},     staryu:{to:'starmie',atLevel:25},
  magikarp:{to:'gyarados',atLevel:20},   omanyte:{to:'omastar',atLevel:40},
  kabuto:{to:'kabutops',atLevel:40},     dratini:{to:'dragonair',atLevel:30},
  dragonair:{to:'dragonite',atLevel:55},
};
function getEvolution(speciesId, level) {
  const e = EVOLUTIONS[speciesId];
  if (!e) return null;
  // Defensive: never evolve to the same species (prevents Raichu→Raichu glitches)
  if (e.to === speciesId) return null;
  if (level >= e.atLevel) return e;
  return null;
}

// ---------- Eggs & Incubators ----------
const EGG_TIERS = {
  common:    { id:'common',    name:'Common Egg',    emoji:'\u{1F95A}', color:'#cbd5f0', stars:1, hatchMs: 5*60*1000,  pokemonRarities:[1,2], ivBonus:0,  shopPrice:200 },
  rare:      { id:'rare',      name:'Rare Egg',      emoji:'\u{1F95A}', color:'#74b9ff', stars:2, hatchMs:15*60*1000,  pokemonRarities:[2,3], ivBonus:3,  shopPrice:800 },
  epic:      { id:'epic',      name:'Epic Egg',      emoji:'\u{1F95A}', color:'#a040d8', stars:3, hatchMs:30*60*1000,  pokemonRarities:[3,4], ivBonus:8,  shopPrice:3000 },
  legendary: { id:'legendary', name:'Legendary Egg', emoji:'\u{1F95A}', color:'#ffd166', stars:5, hatchMs:60*60*1000,  pokemonRarities:[4,5], ivBonus:15, shopPrice:15000 },
};
const INCUBATOR_TIERS = [
  { tier:1, name:'Wood Incubator',    stars:1, slots:1, speedMult:1.0, gold:0,     color:'#a07060', emoji:'\u{1F4E6}', desc:'Basic incubator. Comes with every trainer.' },
  { tier:2, name:'Stone Incubator',   stars:2, slots:2, speedMult:1.2, gold:500,   color:'#999999', emoji:'\u{1FAA8}', desc:'2 slots, 1.2x speed.' },
  { tier:3, name:'Iron Incubator',    stars:3, slots:3, speedMult:1.5, gold:2500,  color:'#c0c0d0', emoji:'\u{2699}',  desc:'3 slots, 1.5x speed.' },
  { tier:4, name:'Crystal Incubator', stars:4, slots:4, speedMult:2.0, gold:7500,  color:'#74b9ff', emoji:'\u{1F48E}', desc:'4 slots, 2x speed.' },
  { tier:5, name:'Master Incubator',  stars:5, slots:6, speedMult:3.0, gold:25000, color:'#ffd166', emoji:'\u{1F451}', desc:'6 slots, 3x speed.' },
];
function rollEggHatch(eggTierId) {
  const tier = EGG_TIERS[eggTierId];
  if (!tier) return null;
  const candidates = GameData.POKEDEX.filter(p => tier.pokemonRarities.includes(p.rarity));
  if (!candidates.length) return null;
  const species = candidates[Math.floor(Math.random() * candidates.length)];
  const stats = ['hp','atk','def','spAtk','spDef','spd'];
  const ivs = {};
  for (const s of stats) {
    let v = Math.floor(Math.random() * 32) + tier.ivBonus;
    if (v > 31) v = 31;
    ivs[s] = v;
  }
  const isShiny = Math.random() < 4 / 512;
  return { species, ivs, isShiny };
}
function rollEggDropFromCatch(caught, isLegendary) {
  if (isLegendary && caught) {
    if (Math.random() < 0.3) return 'epic';
    return 'rare';
  }
  if (!caught) {
    if (Math.random() < 0.04) return 'common';
    return null;
  }
  const r = Math.random();
  if (r < 0.01) return 'epic';
  if (r < 0.05) return 'rare';
  if (r < 0.20) return 'common';
  return null;
}
function rollEggDropFromBattle() {
  const r = Math.random();
  if (r < 0.02) return 'epic';
  if (r < 0.10) return 'rare';
  if (r < 0.35) return 'common';
  return null;
}

// ---------- Moves (re-export from client data) ----------
const MOVES = GameData.MOVES;
const MOVE_BY_ID = GameData.MOVE_BY_ID;
const rollMoveset = GameData.rollMoveset;

module.exports = {
  GameData, rollIVs, ivTotal, ivPercent, ivDifficulty, pickRandomEncounter,
  LEGENDARY_INTERVAL, LEGENDARY_POOL, pickLegendary,
  xpForLevelUp, totalXpForLevel, levelFromTotalXp, xpForCatch, levelUpReward,
  DAILY_QUEST_DEFS, pickDailyQuests, questDef, ACHIEVEMENT_DEFS,
  POKEMON_MAX_LEVEL, pokemonXpForLevelUp, pokemonXpFromCatch, applyXpToPokemon,
  EGG_TIERS, INCUBATOR_TIERS, rollEggHatch, rollEggDropFromCatch, rollEggDropFromBattle,
  rollMoveset, MOVES,
};
