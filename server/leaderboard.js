// server/leaderboard.js
// Three leaderboards: catches, best-IV, pokedex completion.

const { stmt } = require('./db');
const { GameData } = require('./data');

function getLeaderboards() {
  const catches = stmt.topByCatches.all().map((r, i) => ({
    rank: i + 1, userId: r.id, username: r.username, value: r.total_catches,
  }));
  const ivBest = stmt.topByIv.all().map((r, i) => ({
    rank: i + 1, userId: r.id, username: r.username,
    value: r.best_iv, pokemonId: r.pokemon_id,
    pokemonName: GameData.POKEMON_BY_ID[r.pokemon_id] ? GameData.POKEMON_BY_ID[r.pokemon_id].name : r.pokemon_id,
  }));
  const dex = stmt.topByPokedex.all().map((r, i) => ({
    rank: i + 1, userId: r.id, username: r.username, value: r.species,
  }));
  return { catches, ivBest, dex };
}

module.exports = { getLeaderboards };
