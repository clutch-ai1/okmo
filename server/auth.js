// server/auth.js
// Username/password auth with bcrypt + JWT. OAuth (Discord/Google) stubbed.

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { stmt } = require('./db');

// SECURITY: in production set this via env. For local dev, fallback to a fixed string.
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-please';
const TOKEN_TTL = '30d';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

async function register(username, password, gender) {
  if (!USERNAME_RE.test(username)) throw new Error('Username must be 3-16 chars, letters/numbers/underscore only');
  if (typeof password !== 'string' || password.length < 6) throw new Error('Password must be at least 6 characters');
  if (stmt.getUserByName.get(username)) throw new Error('Username already taken');
  const hash = await bcrypt.hash(password, 10);
  const now = Date.now();
  const result = stmt.insertUser.run(username, hash, null, null, now, now);
  const user = stmt.getUserById.get(result.lastInsertRowid);
  if (gender === 'male' || gender === 'female') stmt.setGender.run(gender, user.id);
  return { user: stmt.getUserById.get(user.id), token: makeToken(user) };
}

async function login(username, password) {
  const user = stmt.getUserByName.get(username);
  if (!user || !user.password_hash) throw new Error('Invalid username or password');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new Error('Invalid username or password');
  if (user.banned) {
    const reason = user.banned_reason ? (' Reason: ' + user.banned_reason) : '';
    throw new Error('You are banned from this server.' + reason);
  }
  stmt.updateLastSeen.run(Date.now(), user.id);
  return { user, token: makeToken(user) };
}

// ---------- OAuth stubs ----------
// To enable Discord OAuth:
//   1. Go to https://discord.com/developers/applications and create an app.
//   2. Add redirect URI: <your-server-url>/auth/discord/callback
//   3. Set env vars DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.
// Same for Google: https://console.cloud.google.com/
const OAUTH_CONFIG = {
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID || '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    userInfo: 'https://discord.com/api/users/@me',
    scope: 'identify',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    userInfo: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scope: 'openid profile email',
  },
};

function oauthRedirectUrl(provider, redirectUri) {
  const cfg = OAUTH_CONFIG[provider];
  if (!cfg || !cfg.clientId) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scope,
  });
  return `${cfg.authorize}?${params}`;
}

async function exchangeOAuthCode(provider, code, redirectUri) {
  const cfg = OAUTH_CONFIG[provider];
  if (!cfg || !cfg.clientId) throw new Error(provider + ' OAuth not configured');
  const tokenRes = await fetch(cfg.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId, client_secret: cfg.clientSecret,
      grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new Error(provider + ' token exchange failed');
  const tokenData = await tokenRes.json();
  const userRes = await fetch(cfg.userInfo, {
    headers: { Authorization: 'Bearer ' + tokenData.access_token },
  });
  if (!userRes.ok) throw new Error(provider + ' user info failed');
  const profile = await userRes.json();
  // Find or create user
  const oauthId = profile.id || profile.sub;
  let user = stmt.getUserByOAuth.get(provider, oauthId);
  if (!user) {
    let baseName = (profile.username || profile.name || ('user' + oauthId.slice(-6))).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 14) || 'user';
    let username = baseName;
    let n = 1;
    while (stmt.getUserByName.get(username)) { username = baseName.slice(0, 14) + n; n++; }
    const now = Date.now();
    const result = stmt.insertUser.run(username, null, provider, oauthId, now, now);
    user = stmt.getUserById.get(result.lastInsertRowid);
    stmt.updateLastSeen.run(Date.now(), user.id);
  }
  return { user, token: makeToken(user) };
}

module.exports = { register, login, makeToken, verifyToken, oauthRedirectUrl, exchangeOAuthCode };
