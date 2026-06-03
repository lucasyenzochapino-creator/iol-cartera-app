const baseHandler = require('./iol-dashboard.js');

function marketStatus() {
  const now = new Date();
  const h = (now.getUTCHours() - 3 + 24) % 24;
  const m = now.getUTCMinutes();
  const d = now.getUTCHours() < 3 ? (now.getUTCDay() + 6) % 7 : now.getUTCDay();
  const mins = h * 60 + m;
  const weekday = d >= 1 && d <= 5;
  const open = weekday && mins >= 660 && mins < 1020;
  const argTime = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  if (open) return { isOpen: true, isWeekday: true, argTime, status: 'ABIERTO', note: 'Mercado BYMA abierto. Precios en tiempo real con posible delay de IOL.' };
  if (weekday) {
    const pre = mins < 660;
    return { isOpen: false, isWeekday: true, argTime, status: 'CERRADO', note: pre ? `Abre a las 11:00hs ARS. Faltan ${660-mins} min.` : 'Cerrado. Los precios son del último cierre. Reabre mañana 11:00hs ARS.' };
  }
  return { isOpen: false, isWeekday: false, argTime, status: 'FIN DE SEMANA', note: 'Mercado cerrado. Reabre el lunes 11:00hs ARS.' };
}

function cls(s) {
  s = String(s || '').toUpperCase();
  if (/^(AL|GD|AE)\d+/.test(s)) return 'bono_dolar';
  if (/^(TX|TZX|TZXM|TZXY|TZXD)\d+/.test(s)) return 'bono_cer';
  if (/^S\d{2}[A-Z]\d/.test(s) || /^LEDE|^LETL|^LETE/.test(s)) return 'lecap';
  if (['YPFD','PAMP','VIST','GGAL','BMA','TXAR','ALUA','TGSU2','CEPU','BYMA','COME','LOMA','EDN','TRAN','CRES','TGNO4','MIRG','SUPV','CVH','BBAR','TECO2','HARG'].includes(s)) return 'accion_local';
  if (['SPY','QQQ','DIA','IWM','EEM','EFA','GLD','SLV','TLT','XLE','XLF','XLK','XLV','XLP','XLI','ARKK','VTI','VOO'].includes(s)) return 'cedear_etf';
  if (['KO','PG','JNJ','WMT','COST','MCD','DIS','PFE','MRK','NKE','SBUX'].includes(s)) return 'cedear_defensivo';
  if (['AAPL','MSFT','GOOGL','META','AMZN','NVDA','AMD','TSLA','NFLX','ORCL','CRM','INTC','CSCO','PYPL','MU','MSTR','COIN','BABA','UBER','SNAP'].includes(s)) return 'cedear_tech';
  if (['JPM','BAC','WFC','GS','MS','V','MA','AXP','BRKB','C','BLK','SCHW'].includes(s)) return 'cedear_financiero';
  if (['XOM','CVX','F','GM','BA','CAT','HAL','SLB','COP','OXY'].includes(s)) return 'cedear_industrial';
  return 'otro';
}

function label(score, risk) {
  score = Number(score || 0);
  if (score >= 78 && (risk === 'Verde' || risk === 'Amarillo')) return 'Muy buena oportunidad';
  if (score >= 65 && risk !== 'Rojo') return 'Buena oportunidad';
  if (score >= 50) return 'Esperá mejor momento';
  if (score >= 35) return 'Mejor no entrar ahora';
  return 'Evitar';
}

// Fetch financial news headlines for internal analysis context
async function fetchNewsHeadlines() {
  const feeds = [
    { url: 'https://www.ambito.com/rss/pages/economia.xml', source: 'Ambito' },
    { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', source: 'WSJ' },
    { url: 'https://www.cronista.com/rss/finanzas/', source: 'Cronista' },
  ];

  function cleanHtml(s) { return String(s || '').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim(); }
  function extractTag(xml, tag) {
    const m = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i').exec(xml);
    return m ? cleanHtml(m[1]) : '';
  }

  const settled = await Promise.allSettled(feeds.map(async f => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const r = await fetch(f.url, { signal: ctrl.signal, headers: { 'user-agent': 'IOL-Cartera-Pro/1.0' } });
      clearTimeout(t);
      if (!r.ok) return [];
      const text = await r.text();
      const items = [];
      const re = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = re.exec(text)) !== null && items.length < 4) {
        const title = extractTag(m[1], 'title');
        if (title && title.length > 8) items.push(`[${f.source}] ${title.slice(0, 100)}`);
      }
      return items;
    } catch { clearTimeout(t); return []; }
  }));

  return settled.flatMap(r => r.status === 'fulfilled' ? r.value : []).slice(0, 15);
}

function explain(x, newsHeadlines) {
  const ac = x.assetClass || cls(x.symbol);
  const tp = x.tradePlan || {};
  const commPct = (x.commissionRoundTripPct || (ac === 'bono' || ac === 'bono_cer' || ac === 'lecap' ? 0.7 : 1.5)).toFixed(1);

  const queMap = {
    lecap: 'Letra del Tesoro argentino en pesos con tasa fija. Instrumento de corto plazo con bajo riesgo relativo.',
    bono_cer: 'Bono soberano que ajusta por inflación (CER). Protege el capital ante subas del IPC.',
    bono_dolar: 'Bono soberano en dólares. Precio ligado al riesgo país y tipo de cambio. Sirve como cobertura cambiaria.',
    accion_local: 'Acción del Merval. Alta volatilidad ligada al contexto argentino. Potencial alto con riesgo elevado.',
    cedear_tech: 'CEDEAR de empresa tecnológica de EE.UU. Seguís acciones de Wall Street comprando en pesos. Alta beta.',
    cedear_etf: 'ETF global: diversificación automática en muchas empresas a la vez. Menor riesgo de concentración.',
    cedear_defensivo: 'CEDEAR defensivo de consumo o salud. Más estable en correcciones que tecnología agresiva.',
    cedear_financiero: 'CEDEAR de banco/financiera de EE.UU. Sensible a tasas de la Fed y ciclo crediticio.',
    cedear_industrial: 'CEDEAR industrial o energético. Ligado a precios de commodities y ciclo global.',
    otro: 'Instrumento financiero. Revisar liquidez y spread antes de operar.',
  };

  const que = queMap[ac] || queMap.otro;

  const riesgoMap = {
    Verde: 'Riesgo bajo. Spread y volatilidad controlados.',
    Amarillo: 'Riesgo moderado. Manejable con sizing correcto.',
    Naranja: 'Riesgo medio-alto. No superar 15-20% del capital disponible.',
    Rojo: 'Riesgo alto. Evitar o posición mínima.',
  };
  const riesgoFrase = riesgoMap[x.riskColor] || 'Riesgo no calculado.';

  const action = String(x.action || '');
  let hacer = `Hoy no fuerces la entrada. Comisión IOL ida y vuelta: ~${commPct}% — necesitás al menos eso para no perder.`;

  if (action.startsWith('Comprar') && tp.suggestedAmountARS) {
    hacer = `Considerá usar hasta $${Number(tp.suggestedAmountARS).toLocaleString('es-AR')} (${tp.allocationPct||0}% del disponible).`;
    if (tp.entryZone) hacer += ` Zona de entrada: ${tp.entryZone}.`;
    if (tp.target1) hacer += ` Objetivo 1: $${Number(tp.target1).toLocaleString('es-AR')}.`;
    if (tp.invalidation) hacer += ` Stop: $${Number(tp.invalidation).toLocaleString('es-AR')}.`;
    hacer += ` ⚠ Comisión IOL ~${commPct}% — solo tiene sentido si esperás mover al menos el doble.`;
  } else if (action.includes('Vender') || action.includes('Reducir') || action.includes('salir')) {
    hacer = `La señal sugiere reducir o salir.`;
    if (tp.invalidation) hacer += ` Precio de salida de referencia: $${Number(tp.invalidation).toLocaleString('es-AR')}.`;
    hacer += ` Comisión de venta IOL: ~${(Number(commPct)/2).toFixed(1)}% — calculalo sobre el monto a vender.`;
  } else if (action.includes('seguimiento') || action.includes('parcial')) {
    hacer = `No compres todavía. Seguilo 2-3 días. Si confirma fuerza, la comisión IOL (~${commPct}% round trip) es razonable para el movimiento esperado.`;
    if (tp.entryZone) hacer += ` Zona de entrada si confirma: ${tp.entryZone}.`;
  } else if (action.includes('Esperar') || action.includes('No comprar')) {
    hacer = `Señal insuficiente para entrar. Mantené liquidez. Con comisiones IOL de ~${commPct}%, entrar ahora tiene alta probabilidad de pérdida neta.`;
  }

  return {
    label: label(x.score, x.riskColor),
    queEs: que,
    queHacer: hacer,
    riesgoFrase,
    textoCompleto: `${que} ${hacer} ${riesgoFrase}`
  };
}

function norm(x, newsHeadlines) {
  const assetClass = x.assetClass || cls(x.symbol);
  const human = x.human || explain({ ...x, assetClass }, newsHeadlines);
  return {
    symbol: x.symbol, assetClass,
    label: x.label || human.label,
    explicacion: x.explicacion || human.textoCompleto,
    price: x.price ?? x.quote?.price ?? null,
    dailyPct: x.dailyPct ?? x.quote?.pct ?? null,
    score: x.score || 0,
    riskColor: x.riskColor || 'Amarillo',
    action: x.action || 'Revisar',
    thesis: x.thesis || '',
    tradePlan: x.tradePlan || null,
    human
  };
}

function enrich(data, newsHeadlines) {
  if (!data || typeof data !== 'object') return data;

  const ms = marketStatus();
  data.marketStatus = ms;
  if (data.dailyAnalysis) data.dailyAnalysis.marketStatus = ms;

  // Embed news context (internal — not shown to user as raw feed)
  if (newsHeadlines && newsHeadlines.length) {
    data.newsContext = newsHeadlines;
    if (data.dailyAnalysis) data.dailyAnalysis.newsContext = newsHeadlines;
  }

  const held = new Set((data.dailyAnalysis?.holdings || []).map(h => String(h.symbol || '').toUpperCase()));
  const ranking = (data.recommendations || data.dailyAnalysis?.ranking || []).map(x => norm(x, newsHeadlines));
  const current = (data.newOpportunities || data.dailyAnalysis?.newOpportunities || []).map(x => norm(x, newsHeadlines));

  const extra = ranking.filter(x => !held.has(String(x.symbol || '').toUpperCase())).filter(x => x.score >= 55 && x.riskColor !== 'Rojo');
  const map = new Map();
  [...current, ...extra].forEach(x => { if (x.symbol && !map.has(x.symbol)) map.set(x.symbol, x); });
  const opps = Array.from(map.values()).slice(0, 6);

  data.recommendations = ranking;
  data.newOpportunities = opps;
  data.bestNewOpportunity = opps[0] || null;

  if (data.dailyAnalysis) {
    data.dailyAnalysis.ranking = ranking;
    data.dailyAnalysis.newOpportunities = opps;
    data.dailyAnalysis.bestNewOpportunity = data.bestNewOpportunity;
    // Enrich holding analysis with human explanations and news context
    if (data.dailyAnalysis.holdingAnalysis) {
      data.dailyAnalysis.holdingAnalysis = data.dailyAnalysis.holdingAnalysis.map(h => ({
        ...h,
        human: explain({ ...h, assetClass: h.assetClass || cls(h.symbol) }, newsHeadlines)
      }));
    }
  }

  if (data.bestNewOpportunity) {
    data.mainRecommendation = `${data.bestNewOpportunity.label}: ${data.bestNewOpportunity.symbol}`;
    if (data.dailyReport) data.dailyReport.mainRecommendation = data.mainRecommendation;
  }

  data.universeSummary = {
    ...(data.universeSummary || {}),
    humanized: true,
    newsIntegrated: (newsHeadlines || []).length > 0,
    note: 'Análisis enriquecido con estado de mercado, comisiones IOL, noticias del día y explicaciones en español. Solo lectura.'
  };

  return data;
}

module.exports = async function handler(req, res) {
  const chunks = [];
  const fake = {
    statusCode: 200, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    send(b) { chunks.push(typeof b === 'string' ? b : JSON.stringify(b)); }
  };

  // Run base handler and news fetch in parallel to save time
  const [, newsResult] = await Promise.allSettled([
    baseHandler(req, fake),
    fetchNewsHeadlines()
  ]);

  const newsHeadlines = newsResult.status === 'fulfilled' ? newsResult.value : [];

  let data;
  try { data = JSON.parse(chunks.join('')); } catch {
    data = { ok: false, error: 'Respuesta base no JSON', raw: chunks.join('').slice(0, 500) };
  }

  const out = fake.statusCode >= 200 && fake.statusCode < 300 ? enrich(data, newsHeadlines) : data;
  res.status(fake.statusCode).setHeader('content-type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(out));
};
