// Endpoint de noticias financieras: RSS de fuentes argentinas y globales.
// GET /.netlify/functions/noticias con x-app-pin header.

function jsonResp(res, status, data) {
  res.status(status).setHeader('content-type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(data));
}

function env(name, fallback = '') { return process.env[name] || fallback; }

function cleanHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
}

function extractTag(xml, tag) {
  const cdata = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = cdata.exec(xml) || plain.exec(xml);
  return m ? cleanHtml(m[1]) : '';
}

async function fetchFeed(url, source, maxItems) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'IOL-Cartera-Pro/1.0', 'accept': 'application/rss+xml,application/xml,text/xml,*/*' }
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const text = await r.text();
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(text)) !== null && items.length < maxItems) {
      const chunk = m[1];
      const title = extractTag(chunk, 'title');
      const link = extractTag(chunk, 'link') || extractTag(chunk, 'guid');
      const date = extractTag(chunk, 'pubDate');
      const desc = extractTag(chunk, 'description');
      if (title && title.length > 8) {
        items.push({ title: title.slice(0, 130), link: link.slice(0, 350), date, summary: desc.slice(0, 220), source });
      }
    }
    return items;
  } catch { return []; }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return jsonResp(res, 405, { ok: false, error: 'Método no permitido' });

    const expectedPin = env('APP_PIN');
    if (expectedPin) {
      const pin = String(req.headers?.['x-app-pin'] || '');
      if (!pin || pin !== expectedPin) return jsonResp(res, 401, { ok: false, error: 'PIN inválido' });
    }

    const sources = [
      // Argentina
      { url: 'https://www.ambito.com/rss/pages/economia.xml',       source: 'Ámbito Financiero', region: 'AR' },
      { url: 'https://www.cronista.com/rss/finanzas/',               source: 'El Cronista',        region: 'AR' },
      { url: 'https://www.iprofesional.com/rss/home.xml',            source: 'iProfesional',       region: 'AR' },
      { url: 'https://www.infobae.com/feeds/rss/economia/',          source: 'Infobae Economía',   region: 'AR' },
      // Global
      { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',       source: 'WSJ Markets',        region: 'GLOBAL' },
      { url: 'https://finance.yahoo.com/news/rssindex',              source: 'Yahoo Finance',      region: 'GLOBAL' },
    ];

    const settled = await Promise.allSettled(sources.map(s => fetchFeed(s.url, s.source, 4)));
    const noticias = settled.flatMap((r, i) => r.status === 'fulfilled' ? r.value.map(n => ({ ...n, region: sources[i].region })) : []);

    return jsonResp(res, 200, {
      ok: true,
      noticias: noticias.slice(0, 24),
      ar: noticias.filter(n => n.region === 'AR').slice(0, 10),
      global: noticias.filter(n => n.region === 'GLOBAL').slice(0, 8),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Noticias error:', error.message);
    return jsonResp(res, 500, { ok: false, error: 'Error al obtener noticias.' });
  }
};
