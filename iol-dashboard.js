// Vercel Function directa para IOL.
// Ruta: /api/iol-dashboard
// SOLO LECTURA: obtiene token, portafolio, estado de cuenta, cotizaciones, análisis de tenencias y recomendaciones.
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

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value)
    .replace(/\s/g, "")
    .replace(/\$/g, "")
    .replace(/%/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = toNumber(value);
    if (n !== null) return n;
  }
  return null;
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

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const response = await fetch(`${IOL_BASE}/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "accept": "application/json"
      },
      body,
      signal: ctrl.signal
    });
    clearTimeout(t);
    const data = await parseJsonResponse(response, "Token IOL");
    const token = data.access_token || data.accessToken || data.token;
    if (!token) throw new Error("IOL no devolvió access_token.");
    return token;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function iolGet(path, token, label) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const response = await fetch(`${IOL_BASE}${path}`, {
      method: "GET",
      headers: {
        "authorization": `Bearer ${token}`,
        "accept": "application/json"
      },
      signal: ctrl.signal
    });
    clearTimeout(t);
    return parseJsonResponse(response, label || path);
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

function findSymbols(obj, depth = 0, out = new Set()) {
  if (!obj || depth > 8) return out;

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

function extractHoldings(portfolio) {
  const holdings = [];

  function visit(obj, path = "", depth = 0) {
    if (!obj || depth > 8) return;

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }

    if (typeof obj !== "object") return;

    const symbol = String(
      obj.simbolo ||
      obj.ticker ||
      obj.symbol ||
      obj?.titulo?.simbolo ||
      obj?.titulo?.ticker ||
      obj?.instrumento?.simbolo ||
      obj?.instrumento?.ticker ||
      ""
    ).toUpperCase();

    const quantity = firstNumber(
      obj.cantidad,
      obj.cantidadNominal,
      obj.tenencia,
      obj.saldo,
      obj.unidades,
      obj?.titulo?.cantidad,
      obj?.instrumento?.cantidad
    );

    const valueARS = firstNumber(
      obj.valorizacion,
      obj.valorActual,
      obj.valorMercado,
      obj.valuacion,
      obj.monto,
      obj.total,
      obj?.tenenciaValuada
    );

    const avgPrice = firstNumber(
      obj.precioPromedio,
      obj.precioCompra,
      obj.costoPromedio,
      obj.ppc,
      obj.PPC
    );

    const pnl = firstNumber(
      obj.ganancia,
      obj.gananciaPerdida,
      obj.resultado,
      obj.resultadoTotal,
      obj.varValorizada
    );

    const pnlPct = firstNumber(
      obj.gananciaPorcentaje,
      obj.rendimiento,
      obj.rendimientoPorcentual,
      obj.variacion,
      obj.variacionPorcentual
    );

    if (symbol && /^[A-Z0-9.]{2,12}$/i.test(symbol) && (quantity !== null || valueARS !== null)) {
      holdings.push({
        symbol,
        quantity,
        valueARS,
        avgPrice,
        pnl,
        pnlPct,
        sourcePath: path,
        raw: obj
      });
    }

    Object.entries(obj).forEach(([key, value]) => visit(value, path ? `${path}.${key}` : key, depth + 1));
  }

  visit(portfolio);

  const bySymbol = new Map();
  for (const h of holdings) {
    const prev = bySymbol.get(h.symbol);
    if (!prev) {
      bySymbol.set(h.symbol, h);
    } else {
      bySymbol.set(h.symbol, {
        ...prev,
        quantity: (prev.quantity || 0) + (h.quantity || 0) || prev.quantity || h.quantity,
        valueARS: (prev.valueARS || 0) + (h.valueARS || 0) || prev.valueARS || h.valueARS,
        pnl: (prev.pnl || 0) + (h.pnl || 0) || prev.pnl || h.pnl,
        pnlPct: prev.pnlPct ?? h.pnlPct,
        avgPrice: prev.avgPrice ?? h.avgPrice
      });
    }
  }

  return Array.from(bySymbol.values());
}

function quoteFromIol(symbol, data) {
  const price = firstNumber(
    data?.ultimoPrecio,
    data?.ultimoOperado,
    data?.precio,
    data?.cotizacion,
    data?.lastPrice,
    data?.ultimo,
    data?.puntas?.precioCompra,
    data?.puntas?.precioVenta
  );

  const change = firstNumber(
    data?.variacion,
    data?.variacionPorcentual,
    data?.variacionDiaria,
    data?.porcentajeVariacion,
    data?.changePercent
  );

  const volume = firstNumber(
    data?.volumen,
    data?.montoOperado,
    data?.volumenNominal,
    data?.cantidadOperaciones
  );

  return {
    ok: true,
    symbol,
    raw: data,
    price,
    last: price,
    change,
    pct: change,
    volume
  };
}

async function getQuoteSafe(symbol, token) {
  const mercados = ["bCBA", "bcba", "BCBA"];

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

// ── Price History & Technical Indicators ─────────────────────────────────────

async function fetchPriceHistory(symbol, token) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 90);
  const fmt = d => d.toISOString().split('T')[0];
  for (const mercado of ["bCBA", "bcba"]) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch(
        `${IOL_BASE}/api/v2/${mercado}/Titulos/${encodeURIComponent(symbol)}/Cotizacion/serializada?fechaDesde=${fmt(from)}&fechaHasta=${fmt(today)}&ajustada=sinAjustar`,
        { method: "GET", headers: { "authorization": `Bearer ${token}`, "accept": "application/json" }, signal: ctrl.signal }
      );
      clearTimeout(t);
      if (!resp.ok) continue;
      const data = await resp.json();
      if (Array.isArray(data) && data.length >= 5) return data;
      const arr = data?.cotizaciones || data?.items || data?.data;
      if (Array.isArray(arr) && arr.length >= 5) return arr;
    } catch {}
  }
  return [];
}

function extractCloses(history) {
  return history
    .map(c => firstNumber(c.ultimo, c.cierre, c.close, c.precioPromedio, c.price))
    .filter(v => v != null);
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round(100 - 100 / (1 + avgGain / avgLoss));
}

function calcSMA(values, period) {
  if (values.length < period) return null;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function applyTechnicals(scored, closes) {
  if (!closes || closes.length < 10) return { ...scored, rsi: null, sma20: null, sma50: null };
  const rsi = calcRSI(closes);
  const sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50);
  const price = scored.quote?.price;
  let bonus = 0;
  const reasons = [];
  if (rsi != null) {
    if (rsi < 30) { bonus += 12; reasons.push(`RSI ${rsi} sobrevendido`); }
    else if (rsi < 42) { bonus += 6; reasons.push(`RSI ${rsi} zona de entrada`); }
    else if (rsi > 72) { bonus -= 12; reasons.push(`RSI ${rsi} sobrecomprado`); }
    else if (rsi > 62) { bonus -= 4; reasons.push(`RSI ${rsi} calentando`); }
  }
  if (price && sma20) {
    if (price > sma20 * 1.01 && price < sma20 * 1.05) { bonus += 5; reasons.push("sobre MA20"); }
    else if (price < sma20 * 0.99) { bonus -= 6; reasons.push("bajo MA20"); }
  }
  if (sma20 && sma50) {
    if (sma20 > sma50 * 1.01) { bonus += 8; reasons.push("MA20>MA50 alcista"); }
    else if (sma20 < sma50 * 0.99) { bonus -= 8; reasons.push("MA20<MA50 bajista"); }
  }
  const newScore = Math.max(0, Math.min(100, Math.round(scored.score + bonus)));
  return {
    ...scored, score: newScore, rsi,
    sma20: sma20 ? Math.round(sma20 * 100) / 100 : null,
    sma50: sma50 ? Math.round(sma50 * 100) / 100 : null,
    thesis: [scored.thesis, ...reasons].filter(Boolean).join('; ')
  };
}

// ── Portfolio Health Score ────────────────────────────────────────────────────

function calcPortfolioHealth(holdingAnalysis) {
  if (!holdingAnalysis.length) return null;
  const totalValue = holdingAnalysis.reduce((s, h) => s + (Number(h.valueARS) || 0), 0);
  if (totalValue <= 0) return null;
  const byClass = new Map();
  holdingAnalysis.forEach(h => {
    const ac = h.assetClass || 'otro';
    byClass.set(ac, (byClass.get(ac) || 0) + (Number(h.valueARS) || 0));
  });
  const concentrations = holdingAnalysis
    .map(h => ({ symbol: h.symbol, pct: (Number(h.valueARS) || 0) / totalValue * 100 }))
    .sort((a, b) => b.pct - a.pct);
  const arsClasses = new Set(['accion_local', 'lecap', 'bono_cer']);
  const usdClasses = new Set(['bono', 'cedear_etf', 'cedear_global', 'cedear_defensivo', 'cedear_financiero', 'cedear_industrial']);
  let arsPct = 0, usdPct = 0;
  byClass.forEach((v, k) => {
    if (arsClasses.has(k)) arsPct += v / totalValue * 100;
    else if (usdClasses.has(k)) usdPct += v / totalValue * 100;
  });
  const maxConc = concentrations[0]?.pct || 100;
  let diversScore = 40;
  const n = holdingAnalysis.length;
  if (n >= 6) diversScore += 20; else if (n >= 4) diversScore += 12; else if (n >= 2) diversScore += 5;
  if (byClass.size >= 3) diversScore += 20; else if (byClass.size >= 2) diversScore += 10;
  if (maxConc < 25) diversScore += 20; else if (maxConc < 40) diversScore += 8; else diversScore -= 12;
  const warnings = [];
  if (maxConc > 40) warnings.push(`${concentrations[0].symbol} es el ${maxConc.toFixed(0)}% de tu cartera — alto riesgo de concentración`);
  if (arsPct > 70) warnings.push(`${arsPct.toFixed(0)}% en activos ARS — poca cobertura cambiaria`);
  if (usdPct > 85) warnings.push(`${usdPct.toFixed(0)}% dolarizado — considerá algo en tasa ARS de corto plazo`);
  if (n < 3) warnings.push("Menos de 3 posiciones — concentración muy alta");
  return {
    diversScore: Math.max(0, Math.min(100, Math.round(diversScore))),
    arsPct: Math.round(arsPct), usdPct: Math.round(usdPct),
    numPositions: n, numClasses: byClass.size,
    maxConcentrationPct: Math.round(maxConc),
    topHoldings: concentrations.slice(0, 3),
    warnings,
    byClassPct: Object.fromEntries([...byClass.entries()].map(([k, v]) => [k, Math.round(v / totalValue * 100)]))
  };
}

function uniqueUpper(list) {
  return Array.from(new Set(
    list
      .map(x => String(x || "").trim().toUpperCase())
      .filter(Boolean)
  ));
}

function buildWatchlist() {
  const defaultWatchlist = [
    // Merval - acciones líquidas con mayor volumen
    "YPFD","PAMP","VIST","GGAL","BMA","TXAR","ALUA","TGSU2","CEPU","BYMA","COME","LOMA","EDN","TRAN","SUPV","BBAR","CRES","TGNO4","MIRG","HARG",
    // Bonos soberanos dólar (AL, GD)
    "AL29","AL30","AL35","GD30","GD35","GD38",
    // Bonos CER / pesos
    "TX26","TX28","TZX26",
    // ETFs de EE.UU. - diversificación global
    "SPY","QQQ","GLD","IWM","TLT","XLP","XLV","XLK","XLE",
    // CEDEARs tech de calidad
    "AAPL","MSFT","GOOGL","NVDA","META","AMZN","AMD","TSLA",
    // CEDEARs defensivos
    "KO","PG","JNJ","BRKB","WMT","MCD",
    // CEDEARs financieros
    "JPM","V","MA","BAC","GS",
    // CEDEARs energía
    "XOM","CVX"
  ];

  const raw = env("WATCHLIST", defaultWatchlist.join(","));
  return uniqueUpper(raw.split(",")).slice(0, 70);
}

function classifyAsset(symbol) {
  const s = String(symbol || "").toUpperCase();
  if (/^(AL|GD|AE)\d+/.test(s)) return "bono";
  if (/^(TX|TZX|TZXM|TZXY)\d+/.test(s)) return "bono_cer";
  if (/^S\d{2}[A-Z]\d/.test(s) || /^LEDE|^LETL|^LETE/.test(s)) return "lecap";
  const merval = new Set(["YPFD","PAMP","VIST","GGAL","BMA","TXAR","ALUA","TGSU2","CEPU","BYMA","COME","LOMA","EDN","TRAN","CRES","TGNO4","MIRG","SUPV","CVH","BBAR","TECO2","HARG"]);
  if (merval.has(s)) return "accion_local";
  const etfs = new Set(["SPY","QQQ","DIA","IWM","GLD","SLV","TLT","XLE","XLF","XLK","XLV","XLP","XLI","ARKK","VTI","VOO"]);
  if (etfs.has(s)) return "cedear_etf";
  const def = new Set(["KO","PG","JNJ","WMT","COST","MCD","DIS","PFE","MRK","NKE","SBUX"]);
  if (def.has(s)) return "cedear_defensivo";
  const tech = new Set(["AAPL","MSFT","GOOGL","META","AMZN","NVDA","AMD","TSLA","NFLX","ORCL","CRM","INTC","CSCO","PYPL","MU","MSTR","COIN","BABA","UBER","SNAP"]);
  if (tech.has(s)) return "cedear_global";
  const fin = new Set(["JPM","BAC","WFC","GS","MS","V","MA","AXP","BRKB","C","BLK","SCHW"]);
  if (fin.has(s)) return "cedear_financiero";
  const ind = new Set(["XOM","CVX","F","GM","BA","CAT","HAL","SLB","COP","OXY"]);
  if (ind.has(s)) return "cedear_industrial";
  return "otro";
}

function riskBase(assetClass) {
  const bases = {
    lecap: 28,
    bono: 38,
    bono_cer: 36,
    cedear_etf: 38,
    cedear_defensivo: 34,
    cedear_financiero: 52,
    cedear_industrial: 50,
    cedear_global: 58,
    accion_local: 62,
    otro: 54
  };
  return bases[assetClass] || 54;
}

function liquidityScore(symbol, assetClass) {
  const highLiquidity = new Set(["AL30","GD30","GGAL","YPFD","PAMP","BMA","SPY","QQQ","NVDA","AAPL","MSFT","KO","GLD","META","AMZN","GOOGL","V","JPM"]);
  if (highLiquidity.has(String(symbol).toUpperCase())) return 20;
  if (assetClass === "bono" || assetClass === "bono_cer" || assetClass === "lecap" || assetClass.startsWith("cedear")) return 14;
  return 9;
}

function scoreQuote(quote) {
  const symbol = quote.symbol;
  const assetClass = classifyAsset(symbol);

  if (!quote.ok || !quote.price || quote.price <= 0) {
    const basePts = { lecap: 58, bono_cer: 52, bono: 52, cedear_etf: 56, cedear_defensivo: 54, cedear_financiero: 48, cedear_industrial: 46, cedear_global: 50, accion_local: 44, otro: 40 };
    const rs = riskBase(assetClass);
    return {
      symbol, assetClass,
      score: basePts[assetClass] ?? 40,
      riskScore: rs,
      riskColor: rs <= 36 ? "Verde" : rs <= 56 ? "Amarillo" : rs <= 74 ? "Naranja" : "Rojo",
      action: "Revisar en IOL",
      thesis: "Sin precio en tiempo real. Verificá liquidez en IOL antes de operar.",
      quote
    };
  }

  // Base score reflects the safety floor of each asset class
  const basePts = {
    lecap: 68, bono_cer: 62, bono: 60,
    cedear_etf: 65, cedear_defensivo: 63,
    cedear_financiero: 56, cedear_industrial: 55, cedear_global: 58,
    accion_local: 52, otro: 50
  };

  let score = basePts[assetClass] ?? 50;
  let riskScore = riskBase(assetClass);
  const reasons = [];
  const pct = quote.pct;

  if (pct !== null && Number.isFinite(pct)) {
    // Momentum scoring: optimal zone is 0.3%-2% (controlled positive move)
    if (pct >= 0.3 && pct <= 2) {
      score += 14; reasons.push("momentum controlado");
    } else if (pct > 2 && pct <= 4) {
      score += 8; riskScore += 5; reasons.push("momentum positivo fuerte");
    } else if (pct > 4 && pct <= 7) {
      score += 3; riskScore += 10; reasons.push("suba fuerte: no perseguir precio");
    } else if (pct > 7) {
      score -= 6; riskScore += 16; reasons.push("suba excesiva: esperar retroceso o confirmación");
    } else if (pct >= -0.3) {
      score += 2; reasons.push("movimiento neutral");
    } else if (pct >= -1.5) {
      score -= 8; riskScore += 5; reasons.push("debilidad leve");
    } else if (pct >= -3) {
      score -= 16; riskScore += 10; reasons.push("debilidad moderada");
    } else if (pct >= -6) {
      score -= 24; riskScore += 15; reasons.push("debilidad fuerte");
    } else {
      score -= 32; riskScore += 20; reasons.push("caída severa: esperar confirmación de piso");
    }
  } else {
    score -= 5; reasons.push("sin variación diaria disponible");
  }

  // Volume bonus
  if (quote.volume && Number.isFinite(quote.volume) && quote.volume > 0) {
    score += 3; reasons.push("volumen presente");
  }

  // Asset-class adjustments
  if (assetClass === "cedear_etf") {
    score += 7; riskScore -= 10; reasons.push("diversificación amplia");
  } else if (assetClass === "cedear_defensivo") {
    score += 5; riskScore -= 12; reasons.push("defensivo relativo");
  } else if (assetClass === "bono" || assetClass === "bono_cer") {
    score += 5; riskScore -= 5; reasons.push("renta fija soberana");
  } else if (assetClass === "lecap") {
    score += 8; riskScore -= 14; reasons.push("instrumento de corto plazo en pesos");
  }

  // Liquidity bonus
  const liq = liquidityScore(symbol, assetClass);
  if (liq >= 20) { score += 7; reasons.push("alta liquidez"); }
  else if (liq >= 14) { score += 3; }

  score = Math.max(0, Math.min(100, Math.round(score)));
  riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));

  const riskColor = riskScore <= 36 ? "Verde" : riskScore <= 56 ? "Amarillo" : riskScore <= 74 ? "Naranja" : "Rojo";

  let action = "Esperar";
  if (score >= 80 && riskColor !== "Rojo") action = riskColor === "Naranja" ? "Comprar parcial" : "Comprar";
  else if (score >= 70 && riskColor !== "Rojo") action = "Comprar parcial";
  else if (score >= 60 && riskColor !== "Rojo") action = "Comprar parcial / esperar confirmación";
  else if (score >= 48) action = "Mantener en seguimiento";
  else action = "No comprar ahora";

  return { symbol, assetClass, score, riskScore, riskColor, action, thesis: reasons.join("; ") || "señal insuficiente", quote };
}

function roundPrice(value) {
  if (!Number.isFinite(value)) return null;
  if (value >= 10000) return Math.round(value / 10) * 10;
  if (value >= 1000) return Math.round(value);
  if (value >= 100) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

// IOL commission rates (round-trip: buy + sell)
// Acciones/CEDEARs: ~0.6% per leg + bursátil + CNV ≈ 1.5% total
// Bonos: ~0.3% per leg ≈ 0.7% total
function commissionRoundTrip(assetClass) {
  if (assetClass === "bono" || assetClass === "bono_cer" || assetClass === "lecap") return 0.007;
  return 0.015;
}

function buildTradePlan(scored, availableARS) {
  const price = scored.quote?.price || null;
  const highBeta = ["accion_local", "cedear_global"].includes(scored.assetClass);
  const isBono = scored.assetClass === "bono" || scored.assetClass === "bono_cer" || scored.assetClass === "lecap";
  const commRt = commissionRoundTrip(scored.assetClass);
  let allocationPct = 0;

  if (scored.action.startsWith("Comprar")) {
    allocationPct = scored.riskColor === "Verde" ? 0.35 : scored.riskColor === "Amarillo" ? 0.25 : scored.riskColor === "Naranja" ? 0.12 : 0;
  } else if (scored.action.includes("seguimiento") || scored.action.includes("parcial")) {
    allocationPct = 0.10;
  }

  if (highBeta) allocationPct = Math.min(allocationPct, 0.15);
  if (scored.assetClass === "cedear_etf" || scored.assetClass === "cedear_defensivo") allocationPct = Math.min(allocationPct, 0.30);
  if (isBono && scored.riskColor !== "Rojo") allocationPct = Math.min(allocationPct, 0.30);

  // Solo calcular monto si el saldo disponible parece razonable (< 50M ARS)
  // Evita sugerir montos absurdos cuando IOL devuelve el total del portfolio como "disponible"
  const cashReasonable = availableARS > 100 && availableARS < 50_000_000;
  const amount = cashReasonable ? Math.round(availableARS * allocationPct) : null;

  const minGainPct = commRt * 100;
  const breakEvenPrice = price ? roundPrice(price * (1 + commRt)) : null;
  const target1Mult = isBono ? Math.max(1.06, 1 + commRt * 4) : Math.max(1.09, 1 + commRt * 5);
  const target2Mult = isBono ? Math.max(1.10, 1 + commRt * 7) : Math.max(1.15, 1 + commRt * 8);

  return {
    entryZone: price ? `${roundPrice(price * (highBeta ? 0.985 : 0.99))} - ${roundPrice(price * 1.008)}` : "Ver precio en IOL",
    target1: price ? roundPrice(price * target1Mult) : null,
    target2: price ? roundPrice(price * target2Mult) : null,
    invalidation: price ? roundPrice(price * (highBeta ? 0.94 : isBono ? 0.958 : 0.952)) : null,
    breakEvenAfterComm: breakEvenPrice,
    minGainToProfit: `+${minGainPct.toFixed(1)}% (comisión IOL ida y vuelta)`,
    allocationPct: Math.round(allocationPct * 100),
    suggestedAmountARS: amount,
    horizon: highBeta ? "1 a 4 semanas" : isBono ? "3 a 10 semanas" : "2 a 8 semanas",
    rule: `Usar ~${Math.round(allocationPct * 100)}% del capital disponible. Mínimo para cubrir comisiones IOL: +${minGainPct.toFixed(1)}%.`
  };
}

function extractAvailableCash(account) {
  const candidates = [];

  function walk(obj, path = "", depth = 0) {
    if (!obj || depth > 7) return;
    if (Array.isArray(obj)) return obj.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
    if (typeof obj !== "object") return;

    const joined = (Object.keys(obj).join(" ") + " " + path).toLowerCase();
    const hasCashWords = /disponible|saldo|comprar|operar|liquido|liquidez/.test(joined);
    const currency = String(obj.moneda || obj.currency || obj.simboloMoneda || "").toUpperCase();

    for (const key of Object.keys(obj)) {
      const n = toNumber(obj[key]);
      if (n !== null && hasCashWords) candidates.push({ path: `${path}.${key}`, value: n, currency });
    }

    Object.entries(obj).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : k, depth + 1));
  }

  walk(account);

  const ars = candidates
    .filter(x => !x.currency || /ARS|PESO|\$/.test(x.currency) || /pesos|ars|disponible/i.test(x.path))
    .sort((a, b) => b.value - a.value)[0]?.value || 0;

  const usd = candidates
    .filter(x => /USD|DOLAR|DÓLAR|US/.test(x.currency) || /dolar|dólar|usd/i.test(x.path))
    .sort((a, b) => b.value - a.value)[0]?.value || 0;

  return { ars, usd, candidates: candidates.slice(0, 12) };
}

function analyzeHolding(holding, scored) {
  const pct = scored.quote?.pct;
  const pnlPct = holding.pnlPct;
  const commRt = commissionRoundTrip(scored.assetClass) * 100; // as pct
  let decision = "Mantener y controlar";
  let priority = "media";
  let reason = scored.thesis;

  if (!scored.quote?.ok) {
    decision = "Revisar manualmente";
    priority = "alta";
    reason = "No pude leer cotización diaria desde IOL. Verificá la posición en la app.";
  } else if (scored.riskColor === "Rojo" || scored.score < 35) {
    decision = "Reducir o salir";
    priority = "alta";
    reason = `Señal muy débil (score ${scored.score}/100). Considera reducir posición aceptando el costo de comisión (~${commRt.toFixed(1)}% IOL).`;
  } else if (pct !== null && pct <= -3) {
    decision = "No aumentar · revisar stop";
    priority = "alta";
    reason = `Caída diaria del ${pct.toFixed(1)}%. No promediar a la baja sin señal de recuperación clara.`;
  } else if (pnlPct !== null && pnlPct > 0 && pnlPct < commRt) {
    // Ganancia menor a la comisión de salida → no vale vender
    decision = "Mantener · ganancia menor a comisión IOL";
    priority = "baja";
    reason = `P&L de +${pnlPct.toFixed(1)}% no cubre la comisión de venta (~${(commRt/2).toFixed(1)}%). Mejor esperar más movimiento antes de salir.`;
  } else if (pnlPct !== null && pnlPct < 0 && Math.abs(pnlPct) < commRt) {
    // Pérdida pequeña + comisión haría el daño mayor
    decision = "Mantener · salir ahora suma comisión";
    priority = "baja";
    reason = `Pérdida de ${pnlPct.toFixed(1)}%. Vender ahora agregaría la comisión IOL (~${(commRt/2).toFixed(1)}%) al costo. Si no hay catalizador negativo, esperá recuperación.`;
  } else if (scored.score >= 72 && scored.riskColor !== "Rojo") {
    decision = "Mantener · posible aumento si confirma";
    priority = "media";
    reason = `Señal positiva (score ${scored.score}/100). Solo aumentar si hay saldo disponible y el precio confirma fuerza. Recordá que la comisión IOL requiere al menos +${commRt.toFixed(1)}% para ser rentable.`;
  } else if (pnlPct !== null && pnlPct > 8 && scored.score < 55) {
    decision = "Tomar ganancia parcial";
    priority = "media";
    reason = `Ganancia acumulada del +${pnlPct.toFixed(1)}% con señal perdiendo fuerza. Considerá tomar parcial cubriendo la comisión de salida (~${(commRt/2).toFixed(1)}%).`;
  } else if (scored.score < 48) {
    decision = "Mantener posición reducida";
    priority = "media";
    reason = `Señal insuficiente para aumentar (score ${scored.score}/100). No reducir a menos que supere el umbral de pérdida más comisión.`;
  }

  return {
    symbol: holding.symbol,
    quantity: holding.quantity,
    valueARS: holding.valueARS,
    avgPrice: holding.avgPrice,
    pnl: holding.pnl,
    pnlPct: holding.pnlPct,
    currentPrice: scored.quote?.price || null,
    dailyPct: pct,
    score: scored.score,
    riskColor: scored.riskColor,
    assetClass: scored.assetClass,
    decision,
    priority,
    reason,
    commissionRoundTripPct: commRt,
    invalidation: scored.quote?.price ? roundPrice(scored.quote.price * (scored.assetClass === "accion_local" ? 0.94 : 0.95)) : null,
    rsi: scored.rsi ?? null,
    sma20: scored.sma20 ?? null,
    sma50: scored.sma50 ?? null,
    actionType: "tenencia"
  };
}

function buildDailyAnalysis(portfolio, account, quotes, historyMap = new Map()) {
  const holdings = extractHoldings(portfolio);
  const availableCash = extractAvailableCash(account);
  const quoteMap = new Map(quotes.map(q => [q.symbol, q]));

  const scoredUniverse = quotes
    .map(scoreQuote)
    .sort((a, b) => b.score - a.score)
    .map(item => ({ ...item, tradePlan: buildTradePlan(item, availableCash.ars) }));

  const holdingAnalysis = holdings
    .map(holding => {
      const quote = quoteMap.get(holding.symbol) || { ok: false, symbol: holding.symbol, error: "Sin cotización" };
      const scored = scoreQuote(quote);
      const closes = extractCloses(historyMap.get(holding.symbol) || []);
      return analyzeHolding(holding, applyTechnicals(scored, closes));
    })
    .sort((a, b) => {
      const weight = { alta: 3, media: 2, baja: 1 };
      return (weight[b.priority] || 0) - (weight[a.priority] || 0);
    });

  const held = new Set(holdings.map(h => h.symbol));
  const newOpportunities = scoredUniverse
    .filter(item => !held.has(item.symbol))
    .filter(item => item.score >= 45 && item.riskColor !== 'Rojo')
    .slice(0, 8);

  const bestNewOpportunity = newOpportunities[0] || null;
  const urgentHoldings = holdingAnalysis.filter(x => x.priority === "alta");

  let mainRecommendation = "Revisá las oportunidades del día";
  let summary = "Hay activos con señal positiva en el universo analizado. Mirá la sección Oportunidades para ver qué tiene mejor entrada hoy.";

  if (urgentHoldings.length) {
    mainRecommendation = "Revisá tu cartera antes de operar";
    summary = `Hay ${urgentHoldings.length} tenencia(s) con señal de alerta. Antes de comprar más, revisá stops o reducción parcial.`;
  } else if (bestNewOpportunity) {
    mainRecommendation = `Oportunidad: ${bestNewOpportunity.symbol} (score ${bestNewOpportunity.score})`;
    summary = `La mejor entrada del día es ${bestNewOpportunity.symbol} (${bestNewOpportunity.action}), riesgo ${bestNewOpportunity.riskColor}. Usá el asesor IA para más detalles.`;
  } else if (holdingAnalysis.some(h => h.decision.includes("aumentar"))) {
    const candidate = holdingAnalysis.find(h => h.decision.includes("aumentar"));
    mainRecommendation = `Mantener / posible aumento en ${candidate.symbol}`;
    summary = `Tu cartera ya tiene una posición con buena señal. Solo aumentar si hay disponible y confirma precio.`;
  }

  return {
    generatedAt: new Date().toISOString(),
    availableCash,
    holdingsCount: holdings.length,
    holdings,
    holdingAnalysis,
    ranking: scoredUniverse.slice(0, 12),
    newOpportunities,
    bestNewOpportunity,
    mainRecommendation,
    summary,
    portfolioHealth: calcPortfolioHealth(holdingAnalysis),
    rules: [
      "Primero se revisan tenencias actuales.",
      "Después se analiza dinero disponible.",
      "No se fuerza compra si la señal no supera el riesgo.",
      "No se ejecutan órdenes automáticas. El usuario confirma todo en IOL."
    ]
  };
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

    const holdings = extractHoldings(portfolio);
    const symbols = uniqueUpper([
      ...holdings.map(h => h.symbol),
      ...Array.from(findSymbols(portfolio)),
      ...buildWatchlist()
    ]).slice(0, 45);

    const quotes = await Promise.all(symbols.map(sym => getQuoteSafe(sym, token)));

    // Fetch price history for held symbols only — used for RSI and moving averages
    const historyMap = new Map();
    await Promise.allSettled(holdings.map(async h => {
      try {
        const hist = await fetchPriceHistory(h.symbol, token);
        if (hist.length) historyMap.set(h.symbol, hist);
      } catch {}
    }));

    const dailyAnalysis = buildDailyAnalysis(portfolio, account, quotes, historyMap);

    return json(res, 200, {
      ok: true,
      provider: "IOL",
      mode: "solo_lectura",
      generatedAt: new Date().toISOString(),
      portfolio,
      account,
      estadoCuenta: account,
      quotes,
      quoteUniverse: symbols,
      dailyAnalysis,
      holdingsAnalysis: dailyAnalysis.holdingAnalysis,
      recommendations: dailyAnalysis.ranking,
      newOpportunities: dailyAnalysis.newOpportunities,
      mainRecommendation: dailyAnalysis.mainRecommendation,
      dailyReport: {
        title: "Reporte diario de cartera",
        summary: dailyAnalysis.summary,
        mainRecommendation: dailyAnalysis.mainRecommendation,
        holdingsCount: dailyAnalysis.holdingsCount,
        availableARS: dailyAnalysis.availableCash.ars,
        availableUSD: dailyAnalysis.availableCash.usd,
        rules: dailyAnalysis.rules
      },
      universeSummary: {
        expandedUniverse: true,
        totalSymbols: symbols.length,
        note: "El backend analiza tenencias reales, saldo disponible y oportunidades del universo cargado sin privilegiar ningún ticker."
      },
      security: {
        readonly: true,
        ordersEnabled: false,
        note: "Esta función no tiene endpoints de compra/venta. Solo análisis y soporte de decisión."
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
