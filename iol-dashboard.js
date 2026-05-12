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

function uniqueUpper(list) {
  return Array.from(new Set(
    list
      .map(x => String(x || "").trim().toUpperCase())
      .filter(Boolean)
  ));
}

function buildWatchlist() {
  const defaultWatchlist = [
    // acciones argentinas líquidas
    "YPFD", "PAMP", "VIST", "GGAL", "BMA", "TXAR", "ALUA", "TGSU2", "CEPU", "BYMA", "COME", "LOMA",
    // bonos soberanos / CER frecuentes
    "AL29", "AL30", "GD30", "GD35", "TX26", "TZX26",
    // CEDEARs y ETFs globales líquidos para comparar oportunidades sin sesgo por ticker
    "MU", "NVDA", "AMD", "MSFT", "AAPL", "GOOGL", "META", "AMZN", "SPY", "QQQ", "DIA", "IWM", "GLD", "XLP", "XLV", "KO", "PG", "JNJ", "BRKB"
  ];

  const raw = env("WATCHLIST", defaultWatchlist.join(","));
  return uniqueUpper(raw.split(",")).slice(0, 60);
}

function classifyAsset(symbol) {
  const s = String(symbol || "").toUpperCase();
  if (["AL29", "AL30", "GD30", "GD35", "TX26", "TZX26", "AE38", "AL35"].includes(s)) return "bono";
  if (["YPFD", "PAMP", "VIST", "GGAL", "BMA", "TXAR", "ALUA", "TGSU2", "CEPU", "BYMA", "COME", "LOMA"].includes(s)) return "accion_local";
  if (["SPY", "QQQ", "DIA", "IWM", "GLD", "XLP", "XLV"].includes(s)) return "cedear_etf";
  if (["KO", "PG", "JNJ", "BRKB"].includes(s)) return "cedear_defensivo";
  if (["MU", "NVDA", "AMD", "MSFT", "AAPL", "GOOGL", "META", "AMZN"].includes(s)) return "cedear_global";
  return "otro";
}

function riskBase(assetClass) {
  if (assetClass === "bono") return 48;
  if (assetClass === "cedear_etf") return 42;
  if (assetClass === "cedear_defensivo") return 38;
  if (assetClass === "cedear_global") return 62;
  if (assetClass === "accion_local") return 66;
  return 58;
}

function liquidityScore(symbol, assetClass) {
  const liquid = ["AL30", "GD30", "GGAL", "YPFD", "PAMP", "BMA", "SPY", "QQQ", "NVDA", "AAPL", "MSFT", "KO", "GLD"];
  if (liquid.includes(String(symbol).toUpperCase())) return 20;
  if (assetClass === "bono" || assetClass.includes("cedear")) return 14;
  return 9;
}

function scoreQuote(quote) {
  const symbol = quote.symbol;
  const assetClass = classifyAsset(symbol);

  if (!quote.ok || !quote.price || quote.price <= 0) {
    return {
      symbol,
      assetClass,
      score: 0,
      riskScore: 90,
      riskColor: "Rojo",
      action: "No operar",
      thesis: "Sin cotización válida desde IOL.",
      quote
    };
  }

  let score = 35 + liquidityScore(symbol, assetClass);
  let riskScore = riskBase(assetClass);
  const reasons = [];
  const pct = quote.pct;

  if (pct !== null && Number.isFinite(pct)) {
    if (pct >= 4) {
      score += 24;
      riskScore += 8;
      reasons.push("momentum fuerte, pero controlar no perseguir precio");
    } else if (pct >= 2) {
      score += 18;
      riskScore += 4;
      reasons.push("momentum positivo fuerte");
    } else if (pct >= 0.7) {
      score += 11;
      reasons.push("sesgo positivo");
    } else if (pct > -0.7) {
      score += 3;
      reasons.push("movimiento neutral");
    } else if (pct > -2) {
      score -= 8;
      riskScore += 5;
      reasons.push("debilidad moderada");
    } else {
      score -= 20;
      riskScore += 12;
      reasons.push("debilidad fuerte");
    }

    if (Math.abs(pct) > 7) {
      score -= 12;
      riskScore += 12;
      reasons.push("movimiento excesivo: esperar retroceso o confirmación");
    }
  } else {
    score -= 8;
    riskScore += 5;
    reasons.push("sin variación diaria clara");
  }

  if (assetClass === "cedear_etf") {
    score += 8;
    riskScore -= 8;
    reasons.push("diversificación global");
  }
  if (assetClass === "cedear_defensivo") {
    score += 5;
    riskScore -= 10;
    reasons.push("defensivo relativo");
  }
  if (assetClass === "bono") {
    score += 5;
    riskScore -= 4;
    reasons.push("renta fija líquida");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));

  const riskColor = riskScore <= 40 ? "Verde" : riskScore <= 62 ? "Amarillo" : riskScore <= 78 ? "Naranja" : "Rojo";

  let action = "Esperar";
  if (score >= 76 && riskColor !== "Rojo") action = riskColor === "Naranja" ? "Comprar parcial" : "Comprar";
  else if (score >= 62 && riskColor !== "Rojo") action = "Comprar parcial / esperar confirmación";
  else if (score >= 48) action = "Mantener en seguimiento";
  else action = "No comprar ahora";

  return {
    symbol,
    assetClass,
    score,
    riskScore,
    riskColor,
    action,
    thesis: reasons.join("; ") || "señal insuficiente",
    quote
  };
}

function roundPrice(value) {
  if (!Number.isFinite(value)) return null;
  if (value >= 10000) return Math.round(value / 10) * 10;
  if (value >= 1000) return Math.round(value);
  if (value >= 100) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

function buildTradePlan(scored, availableARS) {
  const price = scored.quote?.price || null;
  const highBeta = ["accion_local", "cedear_global"].includes(scored.assetClass);
  let allocationPct = 0;

  if (scored.action.startsWith("Comprar")) {
    allocationPct = scored.riskColor === "Verde" ? 0.45 : scored.riskColor === "Amarillo" ? 0.35 : scored.riskColor === "Naranja" ? 0.18 : 0;
  } else if (scored.action.includes("seguimiento")) {
    allocationPct = 0.08;
  }

  if (highBeta) allocationPct = Math.min(allocationPct, 0.20);
  if (scored.assetClass === "cedear_etf" || scored.assetClass === "cedear_defensivo") allocationPct = Math.max(allocationPct, 0.20);
  if (scored.assetClass === "bono" && scored.riskColor !== "Rojo") allocationPct = Math.max(allocationPct, 0.25);

  const amount = availableARS > 0 ? Math.round(availableARS * allocationPct) : null;

  return {
    entryZone: price ? `${roundPrice(price * (highBeta ? 0.985 : 0.99))} - ${roundPrice(price * 1.01)}` : "Esperar precio válido",
    buyTrigger: price ? `Solo operar dentro de zona o con confirmación sobre ${roundPrice(price * 1.01)}` : "No operar sin precio",
    target1: price ? roundPrice(price * (scored.assetClass === "bono" ? 1.055 : 1.08)) : null,
    target2: price ? roundPrice(price * (scored.assetClass === "bono" ? 1.09 : 1.14)) : null,
    invalidation: price ? roundPrice(price * (highBeta ? 0.94 : scored.assetClass === "bono" ? 0.955 : 0.95)) : null,
    allocationPct: Math.round(allocationPct * 100),
    suggestedAmountARS: amount,
    estimatedUnits: amount && price ? Math.floor((amount / price) * 100) / 100 : null,
    horizon: highBeta ? "1 a 4 semanas" : scored.assetClass === "bono" ? "3 a 10 semanas" : "2 a 8 semanas",
    rule: "Si toca invalidación, salir. Si llega a objetivo 1, tomar parcial y subir stop."
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
  let decision = "Mantener y controlar";
  let priority = "media";
  let reason = scored.thesis;

  if (!scored.quote?.ok) {
    decision = "Revisar manualmente";
    priority = "alta";
    reason = "No pude leer cotización diaria desde IOL.";
  } else if (scored.riskColor === "Rojo" || scored.score < 35) {
    decision = "Reducir o salir parcial";
    priority = "alta";
    reason = "Riesgo alto o señal muy débil.";
  } else if (pct !== null && pct <= -3) {
    decision = "No aumentar; revisar stop";
    priority = "alta";
    reason = "Caída diaria relevante. No promediar a la baja sin señal.";
  } else if (scored.score >= 72 && scored.riskColor !== "Rojo") {
    decision = "Mantener; aumentar solo si hay disponible y confirma";
    priority = "media";
    reason = "La posición sigue con buena señal relativa.";
  } else if (pnlPct !== null && pnlPct > 8 && scored.score < 55) {
    decision = "Tomar ganancia parcial";
    priority = "media";
    reason = "Ganancia acumulada con señal actual perdiendo fuerza.";
  } else if (scored.score < 48) {
    decision = "Mantener chico o reducir";
    priority = "media";
    reason = "La señal actual no justifica aumentar exposición.";
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
    decision,
    priority,
    reason,
    invalidation: scored.quote?.price ? roundPrice(scored.quote.price * 0.95) : null,
    actionType: "tenencia"
  };
}

function buildDailyAnalysis(portfolio, account, quotes) {
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
      return analyzeHolding(holding, scoreQuote(quote));
    })
    .sort((a, b) => {
      const weight = { alta: 3, media: 2, baja: 1 };
      return (weight[b.priority] || 0) - (weight[a.priority] || 0);
    });

  const held = new Set(holdings.map(h => h.symbol));
  const newOpportunities = scoredUniverse
    .filter(item => !held.has(item.symbol))
    .filter(item => item.quote?.ok && item.score >= 55 && item.riskColor !== "Rojo")
    .slice(0, 8);

  const bestNewOpportunity = newOpportunities[0] || null;
  const urgentHoldings = holdingAnalysis.filter(x => x.priority === "alta");

  let mainRecommendation = "Esperar / caución corta";
  let summary = "No se detecta una oportunidad nueva suficientemente clara. Priorizar control de cartera y liquidez.";

  if (urgentHoldings.length) {
    mainRecommendation = "Primero corregir riesgo en cartera actual";
    summary = `Hay ${urgentHoldings.length} tenencia(s) con prioridad alta. Antes de comprar más, revisar stops, reducción o salida parcial.`;
  } else if (bestNewOpportunity && availableCash.ars > 0) {
    mainRecommendation = `${bestNewOpportunity.action}: ${bestNewOpportunity.symbol}`;
    summary = `La mejor oportunidad fuera de tus tenencias es ${bestNewOpportunity.symbol}, con score ${bestNewOpportunity.score} y riesgo ${bestNewOpportunity.riskColor}.`;
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
    ]).slice(0, 60);

    const quotes = await Promise.all(symbols.map(sym => getQuoteSafe(sym, token)));
    const dailyAnalysis = buildDailyAnalysis(portfolio, account, quotes);

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
