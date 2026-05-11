// server/chat.js
const { stmt } = require('./db');

const RATE_LIMIT_MS = 1000;
const DUPE_WINDOW_MS = 15000;        // block same exact message for 15s
const FLOOD_THRESHOLD = 8;           // 8 messages
const FLOOD_WINDOW_MS = 12000;       // in 12s = treat as flood
const MAX_LEN = 240;
const lastSent = new Map();
const lastText = new Map();          // userId -> { text, at }
const recentStamps = new Map();      // userId -> [timestamps]

function getRecent() {
  const rows = stmt.getRecentChat.all().reverse();
  return rows.map(r => {
    const u = r.user_id ? stmt.getUserById.get(r.user_id) : null;
    return {
      id: r.id, userId: r.user_id, username: r.username,
      title: u ? (u.title || '') : '',
      content: r.content, type: r.type,
      payload: r.payload ? JSON.parse(r.payload) : null,
      sentAt: r.sent_at,
    };
  });
}

function postMessage(user, text) {
  const now = Date.now();
  const last = lastSent.get(user.id) || 0;
  if (now - last < RATE_LIMIT_MS) return { ok: false, reason: 'Slow down' };
  if (typeof text !== 'string') return { ok: false, reason: 'Invalid' };
  text = text.trim();
  if (!text) return { ok: false, reason: 'Empty' };
  if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);

  // Anti-spam: block exact duplicates within 15s
  const prev = lastText.get(user.id);
  if (prev && prev.text === text && now - prev.at < DUPE_WINDOW_MS) {
    return { ok: false, reason: 'Stop repeating yourself' };
  }
  // Anti-flood: more than FLOOD_THRESHOLD messages in FLOOD_WINDOW_MS
  let stamps = recentStamps.get(user.id) || [];
  stamps = stamps.filter(t => now - t < FLOOD_WINDOW_MS);
  if (stamps.length >= FLOOD_THRESHOLD) {
    recentStamps.set(user.id, stamps);
    return { ok: false, reason: 'Too many messages, slow down' };
  }
  stamps.push(now);
  recentStamps.set(user.id, stamps);
  lastText.set(user.id, { text, at: now });

  if (text.startsWith('/show ')) {
    const arg = text.slice(6).trim();
    const caughtId = parseInt(arg, 10);
    if (!Number.isFinite(caughtId)) return { ok: false, reason: 'Usage: /show <pokemon-id>' };
    const cp = stmt.getOneCaught.get(caughtId, user.id);
    if (!cp) return { ok: false, reason: 'You do not own that Pokemon' };
    const payload = {
      caughtId: cp.id, pokemonId: cp.pokemon_id,
      ivs: JSON.parse(cp.ivs_json), ivTotal: cp.iv_total,
      isShiny: !!cp.is_shiny, ball: cp.ball, caughtAt: cp.caught_at,
    };
    const result = stmt.insertChat.run(user.id, user.username, '', 'show', JSON.stringify(payload), now);
    const refreshed = stmt.getUserById.get(user.id);
    return { ok: true, message: { id: result.lastInsertRowid, userId: user.id, username: user.username, title: refreshed ? (refreshed.title || '') : '', content: '', type: 'show', payload, sentAt: now } };
  }

  const result = stmt.insertChat.run(user.id, user.username, text, 'msg', null, now);
  lastSent.set(user.id, now);
  const refreshed = stmt.getUserById.get(user.id);
  return { ok: true, message: { id: result.lastInsertRowid, userId: user.id, username: user.username, title: refreshed ? (refreshed.title || '') : '', content: text, type: 'msg', payload: null, sentAt: now } };
}

function postSystem(text) {
  const now = Date.now();
  const result = stmt.insertChat.run(null, 'System', text, 'system', null, now);
  return { id: result.lastInsertRowid, userId: 0, username: 'System', content: text, type: 'system', payload: null, sentAt: now };
}

module.exports = { getRecent, postMessage, postSystem };
