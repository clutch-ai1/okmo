// js/state.js
// Game state with save/load via localStorage. Pokemon stored as instances with IVs.

const SAVE_KEY = 'pokeIdleSave_v3';

const DEFAULT_STATE = {
  caughtList: [],
  pokedex: {},
  balls: { pokeball: 20, superball: 5, hyperball: 1, masterball: 0 },
  currentAreaId: 'meadow',
  totalThrows: 0,
  totalCatches: 0,
  totalEncounters: 0,
  totalPerfectStops: 0,
  unlockedAreas: ['meadow'],
  unlockedAchievements: [],
  trainerName: 'Trainer',
  lastBallRegen: Date.now(),
};

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

function rollIVs() {
  const stats = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'spd'];
  const ivs = {};
  for (const s of stats) ivs[s] = Math.floor(Math.random() * 32);
  return ivs;
}

function ivTotal(ivs)      { return ivs.hp + ivs.atk + ivs.def + ivs.spAtk + ivs.spDef + ivs.spd; }
function ivPercent(ivs)    { return ivTotal(ivs) / 186; }
function ivDifficulty(ivs) { return 1 + ivPercent(ivs) * 0.3; }
function ivPowerLevel(ivs) { return Math.round(ivPercent(ivs) * 100); }

function ivTier(ivs) {
  const p = ivPercent(ivs);
  if (p >= 0.95) return { name: 'Perfect',   color: '#ffd166', stars: 5 };
  if (p >= 0.80) return { name: 'Excellent', color: '#ff9f43', stars: 4 };
  if (p >= 0.60) return { name: 'Great',     color: '#7bed9f', stars: 3 };
  if (p >= 0.40) return { name: 'Decent',    color: '#74b9ff', stars: 2 };
  if (p >= 0.20) return { name: 'Weak',      color: '#a4b0be', stars: 1 };
  return                 { name: 'Pathetic', color: '#636e72', stars: 0 };
}

let _uidCounter = Date.now();
function makeUid() { return (_uidCounter++).toString(36); }

function spawnInstance(pokemon) {
  return {
    uid: makeUid(),
    pokemonId: pokemon.id,
    ivs: rollIVs(),
    isShiny: Math.random() < 1/512,
    caughtAt: null,
    ball: null,
  };
}

class GameState {
  constructor() {
    this.data = this.load();
    this.listeners = [];
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return clone(DEFAULT_STATE);
      const parsed = JSON.parse(raw);
      return Object.assign(clone(DEFAULT_STATE), parsed, {
        balls: Object.assign({}, DEFAULT_STATE.balls, parsed.balls || {}),
        pokedex: parsed.pokedex || {},
        caughtList: parsed.caughtList || [],
      });
    } catch (e) {
      console.warn('Save corrupt, starting fresh', e);
      return clone(DEFAULT_STATE);
    }
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); }
    catch (e) { console.warn('Save failed', e); }
  }

  reset() {
    this.data = clone(DEFAULT_STATE);
    this.save();
    this._notify();
  }

  on(fn) { this.listeners.push(fn); }
  _notify() { this.listeners.forEach(fn => fn(this.data)); }

  recordEncounter(pokemonId) {
    this.data.totalEncounters += 1;
    this.save();
    this._notify();
  }

  recordThrow(ballId) {
    if ((this.data.balls[ballId] || 0) <= 0) return false;
    this.data.balls[ballId] -= 1;
    this.data.totalThrows += 1;
    this.save();
    this._notify();
    return true;
  }

  recordCatch(instance, ballId) {
    instance.caughtAt = Date.now();
    instance.ball = ballId;
    this.data.caughtList.push(instance);
    this.data.pokedex[instance.pokemonId] = (this.data.pokedex[instance.pokemonId] || 0) + 1;
    this.data.totalCatches += 1;
    this._unlockProgress();
    this.save();
    this._notify();
  }

  recordPerfectStop() {
    this.data.totalPerfectStops += 1;
    this.save();
  }

  // Progressive area unlocks for 151 Pokemon
  _unlockProgress() {
    const u = this.data.unlockedAreas;
    const c = this.data.totalCatches;
    if (c >= 5   && !u.includes('forest'))     u.push('forest');
    if (c >= 15  && !u.includes('lake'))       u.push('lake');
    if (c >= 30  && !u.includes('mountain'))   u.push('mountain');
    if (c >= 50  && !u.includes('powerplant')) u.push('powerplant');
    if (c >= 75  && !u.includes('tower'))      u.push('tower');
    if (c >= 100 && !u.includes('volcano'))    u.push('volcano');
    if (c >= 130 && !u.includes('safari'))     u.push('safari');
  }

  setArea(id) {
    if (this.data.unlockedAreas.includes(id)) {
      this.data.currentAreaId = id;
      this.save();
      this._notify();
    }
  }

  tickBallRegen(now) {
    if (now === undefined) now = Date.now();
    const elapsed = now - this.data.lastBallRegen;
    const interval = 60000;
    if (elapsed >= interval) {
      const amount = Math.floor(elapsed / interval);
      const cap = 30;
      const before = this.data.balls.pokeball || 0;
      if (before < cap) {
        this.data.balls.pokeball = Math.min(cap, before + amount);
        this.data.lastBallRegen = now;
        this.save();
        this._notify();
        return true;
      } else {
        this.data.lastBallRegen = now;
        this.save();
      }
    }
    return false;
  }

  awardCatchBonus() {
    const r = Math.random();
    if (r < 0.002) { this.data.balls.masterball = (this.data.balls.masterball || 0) + 1; this.save(); this._notify(); return 'masterball'; }
    if (r < 0.017) { this.data.balls.hyperball  = (this.data.balls.hyperball  || 0) + 1; this.save(); this._notify(); return 'hyperball'; }
    if (r < 0.097) { this.data.balls.superball  = (this.data.balls.superball  || 0) + 1; this.save(); this._notify(); return 'superball'; }
    return null;
  }

  checkAchievements() {
    const newly = [];
    for (const a of GameData.ACHIEVEMENTS) {
      if (!this.data.unlockedAchievements.includes(a.id) && a.check(this.data)) {
        this.data.unlockedAchievements.push(a.id);
        newly.push(a);
      }
    }
    if (newly.length) { this.save(); this._notify(); }
    return newly;
  }

  pickRandomEncounter() {
    const area = GameData.AREA_BY_ID[this.data.currentAreaId];
    const total = area.spawnPool.reduce((a, b) => a + b.weight, 0);
    let r = Math.random() * total;
    for (const sp of area.spawnPool) {
      r -= sp.weight;
      if (r <= 0) return GameData.POKEMON_BY_ID[sp.id];
    }
    return GameData.POKEMON_BY_ID[area.spawnPool[0].id];
  }
}

window.IVUtils = { rollIVs, ivTotal, ivPercent, ivDifficulty, ivPowerLevel, ivTier };
window.spawnInstance = spawnInstance;
window.gameState = new GameState();
