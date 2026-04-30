// Vercel Function directa para IOL.
// Ruta: /api/iol-dashboard
// SOLO LECTURA: obtiene token, portafolio, estado de cuenta y algunas cotizaciones.
// NO contiene funciones de compra, venta ni envío de órdenes.

const IOL_BASE = "https://api.invertironline.com";

function json(res, status, data) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.send(JSON.stringify(data));
}

function getHeader(req, name) {
  const v = req.headers?.[name.toLowerCase()] || req.headers?.[name] || "";
  return Array.isArray(v) ? v[0] : String(v || "");
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function requiredEnv(name, value) {
  if (!value) throw new Error(`Falta variable ambiental: ${name}`);
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label}: respuesta no JSON. HTTP ${response.status}. ${text.slice(0, 180)}`);
  }

  if (!response.ok) {
    const msg = data?.message || data?.error || data?.error_description || JSON.stringify(data).slice(0, 180);
    throw new Error(`${label}: HTTP ${response.status}. ${msg}`);
  }

  return data;
}

async function getIolToken(username, password) {
  const body = new URLSearchParams();
  body.set("username", username);
  body.set("password", password);
  body.set("grant_type", "password");

  const response = await fetch(`${IOL_BASE}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "accept": "application/json"
    },
    body
  });

  const data = await parseJsonResponse(response, "Token IOL");

  const token = data.access_token || data.accessToken || data.token;
  if (!token) throw new Error("IOL no devolvió access_token.");

  return token;
}

async function iolGet(path, token, label) {
  const response = await fetch(`${IOL_BASE}${path}`, {
    method: "GET",
    headers: {
      "authorization": `Bearer ${token}`,
      "accept": "application/json"
    }
  });

  return parseJsonResponse(response, label || path);
}

function findSymbols(obj, depth = 0, out = new Set()) {
  if (!obj || depth > 7) return out;

  if (Array.isArray(obj)) {
    obj.forEach(x => findSymbols(x, depth + 1, out));
    return out;
  }

  if (typeof obj === "object") {
    const sym =
      obj.simbolo ||
      obj.ticker ||
      obj.symbol ||
      obj?.titulo?.simbolo ||
      obj?.titulo?.ticker ||
      obj?.instrumento?.simbolo ||
      obj?.instrumento?.ticker;

    if (sym && /^[A-Z0-9.]{2,12}$/i.test(String(sym))) {
      out.add(String(sym).toUpperCase());
    }

    Object.values(obj).forEach(v => findSymbols(v, depth + 1, out));
  }

  return out;
}

function quoteFromIol(symbol, data) {
  const price =
    data?.ultimoPrecio ??
    data?.ultimoOperado ??
    data?.precio ??
    data?.cotizacion ??
    data?.lastPrice ??
    data?.ultimo ??
    null;

  const change =
    data?.variacion ??
    data?.variacionPorcentual ??
    data?.variacionDiaria ??
    data?.porcentajeVariacion ??
    data?.changePercent ??
    null;

  return {
    ok: true,
    symbol,
    raw: data,
    price,
    last: price,
    change,
    pct: change
  };
}

async function getQuoteSafe(symbol, token) {
  const mercados = ["bcba", "BCBA"];

  for (const mercado of mercados) {
    try {
      const data = await iolGet(`/api/v2/${mercado}/Titulos/${encodeURIComponent(symbol)}/Cotizacion`, token, `Cotización ${symbol}`);
      return quoteFromIol(symbol, data);
    } catch (e) {
      // probar siguiente variante
    }
  }

  return {
    ok: false,
    symbol,
    error: "No pude obtener cotización"
  };
}

function buildWatchlist() {
  const raw = env("WATCHLIST", "YPFD,PAMP,VIST,GGAL,BMA,AL30,GD30,TX26,NVDA,SPY,QQQ");
  return raw
    .split(",")
    .map(x => x.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return json(res, 405, { ok: false, error: "Método no permitido" });
    }

    const expectedPin = env("APP_PIN");
    requiredEnv("APP_PIN", expectedPin);

    const receivedPin = getHeader(req, "x-app-pin");
    if (!receivedPin || receivedPin !== expectedPin) {
      return json(res, 401, { ok: false, error: "PIN inválido" });
    }

    const username = env("IOL_USERNAME", env("IOL_USER"));
    const password = env("IOL_PASSWORD");

    requiredEnv("IOL_USERNAME", username);
    requiredEnv("IOL_PASSWORD", password);

    const token = await getIolToken(username, password);

    const [portfolio, account] = await Promise.all([
      iolGet("/api/v2/portafolio/argentina", token, "Portafolio IOL").catch(error => ({ ok: false, error: error.message })),
      iolGet("/api/v2/estadocuenta", token, "Estado de cuenta IOL").catch(error => ({ ok: false, error: error.message }))
    ]);

    const symbols = Array.from(new Set([
      ...Array.from(findSymbols(portfolio)),
      ...buildWatchlist()
    ])).slice(0, 25);

    const quotes = await Promise.all(symbols.map(sym => getQuoteSafe(sym, token)));

    return json(res, 200, {
      ok: true,
      provider: "IOL",
      mode: "solo_lectura",
      generatedAt: new Date().toISOString(),
      portfolio,
      account,
      estadoCuenta: account,
      quotes,
      security: {
        readonly: true,
        ordersEnabled: false,
        note: "Esta función no tiene endpoints de compra/venta."
      }
    });
  } catch (error) {
    console.error("IOL dashboard Vercel error:", error);
    return json(res, 500, {
      ok: false,
      error: "Error en función IOL Vercel",
      detail: error.message
    });
  }
};
