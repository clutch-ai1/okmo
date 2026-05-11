// server/paypal.js
// PayPal Orders API v2 integration. Sandbox or Live mode via env vars.
//
// Setup (do this once):
//   1. Sign up at https://developer.paypal.com (free)
//   2. Create a "Sandbox" app first to test, then a "Live" app for production
//   3. Copy the Client ID and Secret
//   4. Set env vars before starting the server:
//        PAYPAL_MODE=sandbox        (or "live" for production)
//        PAYPAL_CLIENT_ID=...
//        PAYPAL_CLIENT_SECRET=...
//        PAYPAL_CLIENT_ID_PUBLIC=...   (same as CLIENT_ID — exposed to browser)
//
// In sandbox mode you can use a test buyer account (also created in PayPal Dev Dashboard)
// to simulate purchases without real money.

const MODE = process.env.PAYPAL_MODE || 'sandbox';
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';

const BASE_URL = MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

let cachedToken = null;
let tokenExpiresAt = 0;

function isConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;
  if (!isConfigured()) throw new Error('PayPal not configured (set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET)');

  const auth = Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64');
  const res = await fetch(BASE_URL + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('PayPal token failed: ' + res.status + ' ' + txt);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function createOrder({ amountUsd, packageId, userId }) {
  const token = await getAccessToken();
  const body = {
    intent: 'CAPTURE',
    purchase_units: [{
      amount: {
        currency_code: 'USD',
        value: amountUsd.toFixed(2),
      },
      description: 'Pokemon MMO — ' + packageId,
      custom_id: 'user_' + userId + '_' + packageId,
    }],
    application_context: {
      brand_name: 'Poke Online MMORPG',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
    },
  };
  const res = await fetch(BASE_URL + '/v2/checkout/orders', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('PayPal createOrder failed: ' + res.status + ' ' + txt);
  }
  return await res.json();
}

async function captureOrder(orderId) {
  const token = await getAccessToken();
  const res = await fetch(BASE_URL + '/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error('PayPal captureOrder failed: ' + res.status + ' ' + text);
  }
  return data;
}

async function getOrder(orderId) {
  const token = await getAccessToken();
  const res = await fetch(BASE_URL + '/v2/checkout/orders/' + encodeURIComponent(orderId), {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('PayPal getOrder failed: ' + res.status + ' ' + txt);
  }
  return await res.json();
}

module.exports = {
  MODE, CLIENT_ID, isConfigured,
  getAccessToken, createOrder, captureOrder, getOrder,
};
