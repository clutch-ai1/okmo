// server/admin-logs.js
// Persistent + in-memory logging system.
// All logs are written to logs/ directory as JSON-line files (one per day).
// Financial/crystal logs get a separate audit trail file for dispute proof.

const fs = require('fs');
const path = require('path');

const LOGS_DIR = process.env.LOGS_DIR || path.join(__dirname, '..', 'logs');
const MAX_MEMORY = 1000;    // in-memory ring buffer for admin panel
const buffer = [];
let nextId = 1;

// Ensure logs directory exists
try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (_) {}

// Financial log types — these get extra detail and go to the audit file
const FINANCIAL_TYPES = new Set([
  'crystals_buy', 'crystals_spend', 'shop_buy', 'avatar_buy',
  'paypal_order_created', 'paypal_capture_fail', 'paypal_amount_mismatch', 'paypal_error',
  'market_buy', 'market_list', 'market_cancel',
  'admin_gift',
]);

/**
 * Push a log entry.
 *  type:    short slug, e.g. 'login', 'register', 'catch', 'crystals_buy'
 *  user:    { id, username } OR null for system events
 *  details: free-form string OR object
 *  extra:   optional object with additional structured data (balances, amounts, etc.)
 */
function log(type, user, details, extra) {
  const entry = {
    id: nextId++,
    t: Date.now(),
    type: String(type || 'event'),
    userId: user ? user.id : null,
    username: user ? user.username : null,
    details: typeof details === 'string' ? details : (details ? JSON.stringify(details) : ''),
  };
  if (extra && typeof extra === 'object') {
    entry.extra = extra;
  }

  // In-memory buffer for admin panel
  buffer.push(entry);
  if (buffer.length > MAX_MEMORY) buffer.shift();

  // Persist to daily log file
  _writeToDisk(entry);

  // Financial entries also go to the audit trail
  if (FINANCIAL_TYPES.has(type)) {
    _writeToAudit(entry);
  }

  return entry;
}

/**
 * Append a log entry to the daily log file.
 */
function _writeToDisk(entry) {
  try {
    const date = new Date(entry.t);
    const day = date.toISOString().slice(0, 10); // YYYY-MM-DD
    const file = path.join(LOGS_DIR, day + '.jsonl');
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (e) {
    // Don't crash if logging fails
    if (!_writeToDisk._warned) {
      console.warn('[logs] Failed to write log file:', e.message);
      _writeToDisk._warned = true;
    }
  }
}

/**
 * Append financial/crystal entries to a separate audit trail file.
 * This file is your proof that crystals were delivered.
 */
function _writeToAudit(entry) {
  try {
    const file = path.join(LOGS_DIR, 'crystal-audit.jsonl');
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (_) {}
}

/**
 * Get in-memory log entries (for admin panel real-time view).
 */
function getAll(limit) {
  const lim = Math.max(1, Math.min(MAX_MEMORY, limit || MAX_MEMORY));
  return buffer.slice(-lim);
}

/**
 * Get entries by type from in-memory buffer.
 */
function getByType(type, limit) {
  const lim = limit || 200;
  const result = [];
  for (let i = buffer.length - 1; i >= 0 && result.length < lim; i--) {
    if (buffer[i].type === type) result.push(buffer[i]);
  }
  return result;
}

/**
 * Get entries for a specific user from in-memory buffer.
 */
function getByUser(userId, limit) {
  const lim = limit || 200;
  const result = [];
  for (let i = buffer.length - 1; i >= 0 && result.length < lim; i--) {
    if (buffer[i].userId === userId) result.push(buffer[i]);
  }
  return result;
}

/**
 * Read persistent logs from disk for a specific date.
 * @param {string} date - YYYY-MM-DD
 * @param {string} [filterType] - optional type filter
 * @returns {object[]}
 */
function readDayLogs(date, filterType) {
  try {
    const file = path.join(LOGS_DIR, date + '.jsonl');
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    let entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (filterType) entries = entries.filter(e => e.type === filterType);
    return entries;
  } catch (_) { return []; }
}

/**
 * Read the full crystal audit trail (all time).
 * @param {number} limit
 * @returns {object[]}
 */
function readAuditTrail(limit) {
  try {
    const file = path.join(LOGS_DIR, 'crystal-audit.jsonl');
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return limit ? entries.slice(-limit) : entries;
  } catch (_) { return []; }
}

/**
 * Load today's logs into memory on startup (so admin panel shows recent history).
 */
function loadTodayIntoMemory() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const entries = readDayLogs(today);
    for (const e of entries) {
      e.id = nextId++;
      buffer.push(e);
    }
    if (buffer.length > MAX_MEMORY) buffer.splice(0, buffer.length - MAX_MEMORY);
    if (entries.length) console.log('[logs] Loaded ' + entries.length + ' entries from today\'s log');
  } catch (_) {}
}

function clear() {
  buffer.length = 0;
}

// Load today's logs on module init
loadTodayIntoMemory();

module.exports = {
  log, getAll, getByType, getByUser,
  readDayLogs, readAuditTrail,
  clear, MAX_MEMORY, FINANCIAL_TYPES,
};
