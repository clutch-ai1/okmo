// server/skills.js
// One signature skill per Pokemon type. Skills auto-fire when charged.
// charges: 2 = weak/basic skill, 3 = strong/legendary skill.

const SKILLS_BY_TYPE = {
  normal:   { id:'hyper_beam',    name:'Hyper Beam',    power: 65, charges: 2, color:'#a8a878', range: 110, aoe: false },
  fire:     { id:'flamethrower',  name:'Flamethrower',  power: 70, charges: 3, color:'#f08030', range: 110, aoe: false, dot: 'burn' },
  water:    { id:'hydro_pump',    name:'Hydro Pump',    power: 75, charges: 3, color:'#6890f0', range: 130, aoe: false },
  electric: { id:'thunderbolt',   name:'Thunderbolt',   power: 70, charges: 3, color:'#f8d030', range: 130, aoe: false, dot: 'paralysis' },
  grass:    { id:'razor_leaf',    name:'Razor Leaf',    power: 55, charges: 2, color:'#78c850', range: 110, aoe: true  },
  ice:      { id:'ice_beam',      name:'Ice Beam',      power: 65, charges: 3, color:'#98d8d8', range: 130, aoe: false, dot: 'freeze' },
  fighting: { id:'cross_chop',    name:'Cross Chop',    power: 70, charges: 2, color:'#c03028', range: 50,  aoe: false },
  poison:   { id:'sludge_bomb',   name:'Sludge Bomb',   power: 60, charges: 2, color:'#a040a0', range: 100, aoe: false, dot: 'poisoned' },
  ground:   { id:'earthquake',    name:'Earthquake',    power: 70, charges: 3, color:'#e0c068', range: 90,  aoe: true  },
  flying:   { id:'aerial_ace',    name:'Aerial Ace',    power: 55, charges: 2, color:'#a890f0', range: 100, aoe: false },
  psychic:  { id:'psychic',       name:'Psychic',       power: 65, charges: 3, color:'#f85888', range: 120, aoe: false },
  bug:      { id:'megahorn',      name:'Megahorn',      power: 60, charges: 2, color:'#a8b820', range: 60,  aoe: false },
  rock:     { id:'rock_slide',    name:'Rock Slide',    power: 60, charges: 2, color:'#b8a038', range: 100, aoe: true  },
  ghost:    { id:'shadow_ball',   name:'Shadow Ball',   power: 65, charges: 3, color:'#705898', range: 120, aoe: false },
  dragon:   { id:'dragon_pulse',  name:'Dragon Pulse',  power: 80, charges: 3, color:'#7038f8', range: 130, aoe: false },
  dark:     { id:'dark_pulse',    name:'Dark Pulse',    power: 65, charges: 3, color:'#705848', range: 120, aoe: false },
  steel:    { id:'flash_cannon',  name:'Flash Cannon',  power: 65, charges: 3, color:'#b8b8d0', range: 120, aoe: false },
  fairy:    { id:'moonblast',     name:'Moonblast',     power: 65, charges: 3, color:'#ee99ac', range: 120, aoe: false },
};

const DEFAULT_SKILL = SKILLS_BY_TYPE.normal;

function getSkillForSpecies(species) {
  if (!species) return DEFAULT_SKILL;
  const s = SKILLS_BY_TYPE[species.type] || DEFAULT_SKILL;
  // Legendaries (rarity 5) get +1 charge but +25% power
  if ((species.rarity || 1) >= 5) {
    return Object.assign({}, s, {
      power: Math.round(s.power * 1.25),
      charges: 3,
      aoe: true,
      legendary: true,
    });
  }
  return s;
}

module.exports = { SKILLS_BY_TYPE, DEFAULT_SKILL, getSkillForSpecies };
