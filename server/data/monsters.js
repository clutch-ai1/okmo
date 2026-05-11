// server/data/monsters.js
// Monster-Datenbank (privates Lernprojekt).
// Stats: hp, atk, def, spd. Levels und Erfahrung werden auf der Instanz gehalten.

const MONSTERS = {
  flamepup:   { id: 'flamepup',   name: 'Flamepup',   type: 'fire',     baseStats: { hp: 39, atk: 52, def: 43, spd: 65 }, learnset: ['scratch','ember','bite','flamethrower'] },
  aquafin:    { id: 'aquafin',    name: 'Aquafin',    type: 'water',    baseStats: { hp: 44, atk: 48, def: 65, spd: 43 }, learnset: ['tackle','watergun','bite','hydropump'] },
  leaflet:    { id: 'leaflet',    name: 'Leaflet',    type: 'grass',    baseStats: { hp: 45, atk: 49, def: 49, spd: 45 }, learnset: ['tackle','vinewhip','quickattack','solarbeam'] },
  sparkmouse: { id: 'sparkmouse', name: 'Sparkmouse', type: 'electric', baseStats: { hp: 35, atk: 55, def: 40, spd: 90 }, learnset: ['quickattack','thundershock','tackle','thunderbolt'] },
  shadowfox:  { id: 'shadowfox',  name: 'Shadowfox',  type: 'dark',     baseStats: { hp: 40, atk: 60, def: 30, spd: 70 }, learnset: ['scratch','bite','quickattack'] },
  rockling:   { id: 'rockling',   name: 'Rockling',   type: 'normal',   baseStats: { hp: 50, atk: 50, def: 70, spd: 25 }, learnset: ['tackle','scratch'] },
};

// Erstellt eine spielbare Instanz aus einer Monster-Vorlage.
// Stats skalieren simpel mit dem Level (Pokemon-Formel waere komplexer).
function spawnMonster(speciesId, level = 5) {
  const species = MONSTERS[speciesId];
  if (!species) throw new Error('Unbekanntes Monster: ' + speciesId);

  const scale = (base) => Math.floor(base + (base * level) / 50);
  const maxHp = scale(species.baseStats.hp) + level;

  // Welche Moves dieses Level kennt (immer die ersten N aus dem Learnset)
  const knownMoveCount = Math.min(species.learnset.length, 1 + Math.floor(level / 5));
  const moves = species.learnset.slice(0, knownMoveCount);

  return {
    speciesId,
    name: species.name,
    type: species.type,
    level,
    exp: 0,
    maxHp,
    hp: maxHp,
    atk: scale(species.baseStats.atk),
    def: scale(species.baseStats.def),
    spd: scale(species.baseStats.spd),
    moves,
  };
}

// Wilde Begegnungen: zufaellige Spezies + Level-Range
function randomWildMonster(minLevel = 2, maxLevel = 6) {
  const species = Object.keys(MONSTERS);
  const pick = species[Math.floor(Math.random() * species.length)];
  const lvl = minLevel + Math.floor(Math.random() * (maxLevel - minLevel + 1));
  return spawnMonster(pick, lvl);
}

module.exports = { MONSTERS, spawnMonster, randomWildMonster };
