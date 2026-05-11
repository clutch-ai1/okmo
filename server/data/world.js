// server/data/world.js
// Welt-Definition: eine einfache Tile-Map.
// Tile-Codes:
//   0 = Gras (begehbar)
//   1 = Hohes Gras (begehbar, kann Wild-Encounter ausloesen)
//   2 = Wasser (nicht begehbar)
//   3 = Baum / Felsen (nicht begehbar)
//   4 = Weg (begehbar)
//   5 = Sand (begehbar)
//
// Erweitere die Map einfach durch laengere Reihen oder neue Tile-Typen.

const TILES = {
  GRASS: 0,
  TALL_GRASS: 1,
  WATER: 2,
  TREE: 3,
  PATH: 4,
  SAND: 5,
};

// 30 x 20 Map. Spielerstart ist (5, 5).
const WORLD_MAP = [
  [3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3],
  [3,0,0,0,0,4,4,4,4,0,0,1,1,1,0,0,0,0,0,3,3,3,2,2,2,2,2,2,2,3],
  [3,0,1,1,0,4,0,0,4,0,1,1,1,1,1,0,0,0,3,3,2,2,2,2,2,2,2,2,2,3],
  [3,0,1,1,0,4,0,0,4,0,0,1,1,1,0,0,0,3,3,5,5,2,2,2,2,2,2,2,2,3],
  [3,0,0,0,0,4,0,0,4,4,4,4,4,4,4,4,4,4,5,5,5,5,2,2,2,2,2,2,2,3],
  [3,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,4,4,5,5,5,5,2,2,2,2,2,2,3],
  [3,0,0,0,0,4,0,3,3,3,3,3,3,3,0,0,0,0,4,4,5,5,5,2,2,2,2,2,2,3],
  [3,0,1,1,0,4,0,3,0,0,0,0,3,3,0,0,1,0,0,4,4,5,5,5,2,2,2,2,2,3],
  [3,0,1,1,0,4,0,3,0,0,0,0,0,3,0,1,1,1,0,0,4,4,5,5,5,2,2,2,2,3],
  [3,0,0,0,0,4,4,4,4,4,4,4,0,3,0,1,1,1,0,0,0,4,4,5,5,5,5,5,5,3],
  [3,0,0,0,0,0,0,0,0,0,0,4,0,3,3,0,1,0,0,0,0,0,4,4,5,5,5,5,5,3],
  [3,0,3,3,3,3,3,3,3,3,0,4,0,0,3,0,0,0,0,3,3,3,3,4,4,5,5,5,5,3],
  [3,0,3,0,0,0,0,0,0,3,0,4,0,0,0,0,0,3,3,3,0,0,3,3,4,4,5,5,5,3],
  [3,0,3,0,1,1,1,1,0,3,0,4,4,4,4,4,4,4,0,0,0,0,0,3,3,4,4,5,5,3],
  [3,0,3,0,1,1,1,1,0,3,0,0,0,0,0,0,0,4,4,0,0,0,0,0,3,3,4,4,5,3],
  [3,0,3,0,1,1,1,1,0,3,0,1,1,1,1,1,0,0,4,4,4,4,4,4,4,4,4,4,4,3],
  [3,0,3,0,0,0,0,0,0,3,0,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,3],
  [3,0,3,3,3,3,3,3,3,3,0,1,1,1,1,1,0,0,0,1,1,1,1,1,1,1,0,0,0,3],
  [3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3],
  [3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3],
];

const MAP_WIDTH = WORLD_MAP[0].length;
const MAP_HEIGHT = WORLD_MAP.length;

const WALKABLE = new Set([TILES.GRASS, TILES.TALL_GRASS, TILES.PATH, TILES.SAND]);

function getTile(x, y) {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return TILES.TREE;
  return WORLD_MAP[y][x];
}

function isWalkable(x, y) {
  return WALKABLE.has(getTile(x, y));
}

function isEncounterTile(x, y) {
  return getTile(x, y) === TILES.TALL_GRASS;
}

const SPAWN_POINT = { x: 5, y: 5 };

module.exports = { WORLD_MAP, MAP_WIDTH, MAP_HEIGHT, TILES, getTile, isWalkable, isEncounterTile, SPAWN_POINT };
