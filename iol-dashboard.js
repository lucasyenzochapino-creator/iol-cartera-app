const https = require('https');
const { URLSearchParams } = require('url');
const crypto = require('crypto');

const IOL_BASE = process.env.IOL_BASE_URL || 'https://api.invertironline.com';
const DEFAULT_MARKET = process.env.IOL_DEFAULT_MARKET || 'BCBA';
const ALLOW_ORDERS = String(process.env.ALLOW_ORDERS || 'false').toLowerCase() === 'true';
const DEFAULT_WATCHLIST = 'BCBA:AL30,BCBA:GD35,BCBA:GGAL,BCBA:YPFD,BCBA:PAMP,BCBA:VIST,BCBA:TX26,BCBA:KO,BCBA:NU,BCBA:NVDA,BCBA:SPY';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff'
    },
    body: JSON.stringify(body)
  };
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function fetchText(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(parsed, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout: opts.timeout || 18000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('timeout', () => { req.destroy(new Error('Timeout consultando servicio externo')); });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function parseJsonMaybe(text) {
  try { return JSON.parse(text); } catch (_) { return { raw: text }; }
}

async function getToken() {
  const username = process.env.IOL_USERNAME;
  const password = process.env.IOL_PASSWORD;
  if (!username || !password) {
    const err = new Error('Faltan variables privadas IOL_USERNAME o IOL_PASSWORD en Netlify.');
    err.code = 'MISSING_ENV';
    throw err;
  }
  const body = new URLSearchParams({ username, password, grant_type: 'password' }).toString();
  const res = await fetchText(`${IOL_BASE}/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'accept': 'application/json'
    },
    body
  });
  const data = parseJsonMaybe(res.text);
  if (res.status < 200 || res.status >= 300 || !data.access_token) {
    const err = new Error('IOL no devolvió token. Revisá usuario, contraseña y habilitación API.');
    err.code = 'IOL_TOKEN_ERROR';
    err.details = { status: res.status, response: data && data.error ? data.error : undefined };
    throw err;
  }
  return data.access_token;
}

async function iolGet(path, token) {
  const res = await fetchText(`${IOL_BASE}${path}`, {
    method: 'GET',
    headers: { 'authorization': `Bearer ${token}`, 'accept': 'application/json' }
  });
  const data = parseJsonMaybe(res.text);
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Error IOL GET ${path}`);
    err.code = 'IOL_GET_ERROR';
    err.details = { path, status: res.status, response: data };
    throw err;
  }
  return data;
}

async function tryEndpoints(token, paths) {
  let lastErr;
  for (const path of paths) {
    try { return { path, data: await iolGet(path, token) }; }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function symbolFromItem(item) {
  return item?.simbolo || item?.ticker || item?.symbol || item?.titulo?.simbolo || item?.titulo?.ticker || item?.instrumento?.simbolo || item?.descripcion?.split?.(' ')?.[0];
}

function findPortfolioArray(obj, depth = 0) {
  if (!obj || depth > 5) return [];
  if (Array.isArray(obj)) {
    if (obj.some(x => x && typeof x === 'object' && symbolFromItem(x))) return obj;
    for (const x of obj) { const r = findPortfolioArray(x, depth + 1); if (r.length) return r; }
  } else if (typeof obj === 'object') {
    const preferred = ['activos','titulos','tenencias','items','portafolio','portfolio','instrumentos','posiciones'];
    for (const k of preferred) { const r = findPortfolioArray(obj[k], depth + 1); if (r.length) return r; }
    for (const k of Object.keys(obj)) { const r = findPortfolioArray(obj[k], depth + 1); if (r.length) return r; }
  }
  return [];
}

function findSymbols(portfolio) {
  const arr = findPortfolioArray(portfolio);
  const out = [];
  for (const item of arr) {
    const symbol = symbolFromItem(item);
    const market = item?.mercado || item?.titulo?.mercado || item?.instrumento?.mercado || DEFAULT_MARKET;
    if (symbol && typeof symbol === 'string' && symbol.length <= 14) out.push({ symbol: symbol.toUpperCase(), market: String(market).toUpperCase(), source: 'portfolio' });
  }
  return out;
}

function parseWatchlist() {
  const raw = process.env.WATCHLIST || DEFAULT_WATCHLIST;
  return String(raw).split(',').map(x => x.trim()).filter(Boolean).map(x => {
    const parts = x.includes(':') ? x.split(':') : [DEFAULT_MARKET, x];
    return { market: String(parts[0]).toUpperCase(), symbol: String(parts[1]).toUpperCase(), source: 'watchlist' };
  });
}

async function getQuoteSafe(token, market, symbol, source) {
  const path = `/api/v2/${encodeURIComponent(market)}/Titulos/${encodeURIComponent(symbol)}/Cotizacion`;
  try {
    const data = await iolGet(path, token);
    return { symbol, market, source, ok: true, data };
  } catch (e) {
    return { symbol, market, source, ok: false, error: e.details?.status || e.message };
  }
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Método no permitido' });

  const appPin = process.env.APP_PIN;
  if (!appPin || String(appPin).length < 8) {
    return json(500, { ok: false, error: 'APP_PIN no configurado o demasiado corto en Netlify.' });
  }
  const provided = event.headers['x-app-pin'] || event.headers['X-App-Pin'];
  if (!safeEqual(provided, appPin)) {
    return json(401, { ok: false, error: 'PIN inválido. No se entregan datos de cartera.' });
  }

  try {
    const token = await getToken();
    const [accountResult, portfolioResult] = await Promise.allSettled([
      tryEndpoints(token, ['/api/v2/estadocuenta', '/api/v2/estadocuenta/argentina']),
      tryEndpoints(token, ['/api/v2/portafolio/argentina'])
    ]);

    const warnings = [];
    let account = null;
    let portfolio = null;
    if (accountResult.status === 'fulfilled') account = accountResult.value.data;
    else warnings.push('No se pudo leer estado de cuenta.');
    if (portfolioResult.status === 'fulfilled') portfolio = portfolioResult.value.data;
    else warnings.push('No se pudo leer portafolio.');

    const symbols = portfolio ? findSymbols(portfolio) : [];
    const watch = parseWatchlist();
    const merged = [...symbols, ...watch];
    const unique = [...new Map(merged.map(x => [`${x.market}:${x.symbol}`, x])).values()].slice(0, 45);
    const quotes = await Promise.all(unique.map(s => getQuoteSafe(token, s.market, s.symbol, s.source)));
    const failedQuotes = quotes.filter(q => !q.ok && q.source === 'portfolio').map(q => `${q.symbol}`);
    if (failedQuotes.length) warnings.push(`Algunas cotizaciones de cartera no respondieron: ${failedQuotes.join(', ')}`);

    return json(200, {
      ok: true,
      mode: ALLOW_ORDERS ? 'LECTURA_Y_ORDENES_HABILITADAS' : 'SOLO_LECTURA_SEGURO',
      updatedAt: new Date().toISOString(),
      source: 'IOL API via Netlify Function',
      account,
      portfolio,
      quotes,
      warnings,
      security: {
        credentialsExposedToBrowser: false,
        ordersEnabled: ALLOW_ORDERS
      }
    });
  } catch (err) {
    return json(500, {
      ok: false,
      error: err.message || 'Error inesperado',
      code: err.code || 'UNKNOWN',
      details: err.details || null
    });
  }
};
