// server/data/moves.js
// Attacken-Datenbank. Jede Attacke hat Typ, Power und PP (Verwendungen).
// Erweitere hier nach Belieben mit neuen Moves.

const MOVES = {
  tackle:      { name: 'Tackle',      type: 'normal',   power: 40, pp: 35, accuracy: 100 },
  scratch:     { name: 'Scratch',     type: 'normal',   power: 40, pp: 35, accuracy: 100 },
  ember:       { name: 'Ember',       type: 'fire',     power: 40, pp: 25, accuracy: 100 },
  flamethrower:{ name: 'Flamethrower',type: 'fire',     power: 90, pp: 15, accuracy: 100 },
  watergun:    { name: 'Water Gun',   type: 'water',    power: 40, pp: 25, accuracy: 100 },
  hydropump:   { name: 'Hydro Pump',  type: 'water',    power: 110,pp: 5,  accuracy: 80  },
  vinewhip:    { name: 'Vine Whip',   type: 'grass',    power: 45, pp: 25, accuracy: 100 },
  solarbeam:   { name: 'Solar Beam',  type: 'grass',    power: 120,pp: 10, accuracy: 100 },
  thundershock:{ name: 'Thundershock',type: 'electric', power: 40, pp: 30, accuracy: 100 },
  thunderbolt: { name: 'Thunderbolt', type: 'electric', power: 90, pp: 15, accuracy: 100 },
  bite:        { name: 'Bite',        type: 'dark',     power: 60, pp: 25, accuracy: 100 },
  quickattack: { name: 'Quick Attack',type: 'normal',   power: 40, pp: 30, accuracy: 100 },
};

// Typen-Effektivitaet (Angreifertyp -> Verteidigertyp -> Multiplikator).
// Vereinfacht; vollstaendige Tabelle koenntest du spaeter erweitern.
const TYPE_CHART = {
  fire:     { grass: 2.0, water: 0.5, fire: 0.5, electric: 1.0, normal: 1.0, dark: 1.0 },
  water:    { fire: 2.0,  grass: 0.5, water: 0.5,electric: 1.0, normal: 1.0, dark: 1.0 },
  grass:    { water: 2.0, fire: 0.5,  grass: 0.5,electric: 1.0, normal: 1.0, dark: 1.0 },
  electric: { water: 2.0, grass: 0.5, electric:0.5,fire: 1.0,   normal: 1.0, dark: 1.0 },
  normal:   { fire: 1.0,  water: 1.0, grass: 1.0,electric: 1.0, normal: 1.0, dark: 1.0 },
  dark:     { fire: 1.0,  water: 1.0, grass: 1.0,electric: 1.0, normal: 1.0, dark: 0.5 },
};

function typeMultiplier(attackType, defenderType) {
  return (TYPE_CHART[attackType] && TYPE_CHART[attackType][defenderType]) || 1.0;
}

module.exports = { MOVES, TYPE_CHART, typeMultiplier };
