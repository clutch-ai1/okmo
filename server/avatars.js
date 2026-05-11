// server/avatars.js
// Premium avatar catalog. Each avatar has an id, display name, sprite URL, and crystal price.
// 'default' is special — it falls back to the user's gender-based trainer image (free).

// Avatar sprites are loaded from local files in assets/avatars/.
// Drop your own PNGs there with the matching filename to replace any avatar.
const AVATARS = [
  // Free / default — gender-based trainer (no sprite override)
  { id: 'default',     name: 'Default Trainer',  priceCrystals: 0,    rarity: 'free',   sprite: null,
    description: 'The default trainer based on your gender selection.' },
  // Premium avatars — drop matching PNGs into assets/avatars/
  { id: 'geckot',      name: 'Geckot',           priceCrystals: 200,  rarity: 'rare',
    sprite: 'assets/avatars/geckot.png',
    description: 'A bold gecko-themed trainer.' },
  { id: 'lucario',     name: 'Lucario',          priceCrystals: 200,  rarity: 'rare',
    sprite: 'assets/avatars/lucario.png',
    description: 'Channel your inner aura.' },
  { id: 'skepoke',     name: 'Skepoke',          priceCrystals: 200,  rarity: 'rare',
    sprite: 'assets/avatars/skepoke.png',
    description: 'Mysterious skeleton vibe.' },
  { id: 'spacechu',    name: 'Spacechu',         priceCrystals: 200,  rarity: 'rare',
    sprite: 'assets/avatars/spacechu.png',
    description: 'Pikachu, but cosmic.' },
  { id: 'goldmew',     name: 'Gold Mew',         priceCrystals: 250,  rarity: 'epic',
    sprite: 'assets/avatars/goldmew.png',
    description: 'A shimmering golden mythical.' },
  { id: 'goldt',       name: 'Gold T',           priceCrystals: 500,  rarity: 'legendary',
    sprite: 'assets/avatars/goldt.png',
    description: 'The prestige gold avatar.' },
];

const AVATAR_BY_ID = Object.fromEntries(AVATARS.map(a => [a.id, a]));

function getAvatar(id) {
  return AVATAR_BY_ID[id] || AVATAR_BY_ID.default;
}

function publicCatalog() {
  return AVATARS.map(a => ({
    id: a.id, name: a.name, priceCrystals: a.priceCrystals, rarity: a.rarity,
    sprite: a.sprite, description: a.description,
  }));
}

// Resolve which sprite URL the user's effective avatar shows.
// Returns null for 'default' so the client falls back to gender-based trainer image.
function resolveSpriteForUser(user) {
  const id = user.avatar || 'default';
  if (id === 'default') return null;
  const av = AVATAR_BY_ID[id];
  return av ? av.sprite : null;
}

module.exports = { AVATARS, AVATAR_BY_ID, getAvatar, publicCatalog, resolveSpriteForUser };
