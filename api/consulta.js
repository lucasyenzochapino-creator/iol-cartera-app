// Endpoint de consulta con IA para IOL Cartera Pro.
// Recibe POST { pregunta, contexto } y devuelve { ok, respuesta }.
// Requiere ANTHROPIC_API_KEY en variables de entorno.

function jsonResp(res, status, data) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.send(JSON.stringify(data));
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function parseBody(req) {
  // Handles Vercel (auto-parsed object), Netlify Lambda (string), and raw Buffer
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  if (Buffer.isBuffer(req.body)) {
    try { return JSON.parse(req.body.toString("utf8")); } catch { return {}; }
  }
  if (typeof req.body === "object") return req.body;
  return {};
}

function buildSystemPrompt(contexto) {
  let ctx = "";

  if (contexto) {
    const { mainRecommendation, summary, holdingsCount, availableCash, marketStatus, holdingAnalysis, newOpportunities, macro, portfolioHealth } = contexto;
    const arsDisp = availableCash?.ars > 0
      ? "$" + Math.round(availableCash.ars).toLocaleString("es-AR")
      : "no detectado";

    ctx = `\n\n## Estado actual de la cartera
- Recomendación del día: ${mainRecommendation || "—"}
- Resumen del análisis: ${summary || "—"}
- Tenencias activas: ${holdingsCount || 0}
- Disponible ARS: ${arsDisp}
- Mercado BYMA: ${marketStatus?.status || "—"} (${marketStatus?.argTime || "—"} ARS)`;

    if (holdingAnalysis?.length) {
      ctx += "\n\n## Tenencias actuales";
      holdingAnalysis.forEach(h => {
        const hoy = h.dailyPct != null ? `${h.dailyPct >= 0 ? "+" : ""}${Number(h.dailyPct).toFixed(2)}%` : "—";
        const pnl = h.pnlPct != null ? `${h.pnlPct >= 0 ? "+" : ""}${Number(h.pnlPct).toFixed(2)}%` : "—";
        const val = h.valueARS ? "$" + Math.round(h.valueARS).toLocaleString("es-AR") : "—";
        ctx += `\n- ${h.symbol} (${h.assetClass || "—"}): score ${h.score}/100, riesgo ${h.riskColor}, val ${val}, hoy ${hoy}, P&L ${pnl}\n  → ${h.decision} — ${h.reason}`;
      });
    }

    if (newOpportunities?.length) {
      ctx += "\n\n## Oportunidades detectadas hoy (fuera de cartera)";
      newOpportunities.forEach(o => {
        const hoy = o.dailyPct != null ? `${o.dailyPct >= 0 ? "+" : ""}${Number(o.dailyPct).toFixed(2)}%` : "—";
        const precio = o.price != null ? Number(o.price).toLocaleString("es-AR", {maximumFractionDigits: 2}) : "—";
        ctx += `\n- ${o.symbol} (${o.assetClass || "—"}): score ${o.score}/100, riesgo ${o.riskColor}, precio ${precio}, hoy ${hoy}\n  → ${o.action}: ${o.thesis}`;
      });
    }

    if (macro) {
      const blueStr = macro.blue?.venta ? `$${macro.blue.venta.toLocaleString('es-AR')}` : "—";
      const oficialStr = macro.oficial?.venta ? `$${macro.oficial.venta.toLocaleString('es-AR')}` : "—";
      const cclStr = macro.ccl?.venta ? `$${macro.ccl.venta.toLocaleString('es-AR')}` : "—";
      const mepStr = macro.mep?.venta ? `$${macro.mep.venta.toLocaleString('es-AR')}` : "—";
      ctx += `\n\n## Tipo de cambio actual\n- Dólar Blue: ${blueStr} | Oficial: ${oficialStr} | CCL: ${cclStr} | MEP: ${mepStr}`;
      if (macro.brechaBlueOficial != null) ctx += `\n- Brecha blue/oficial: ${macro.brechaBlueOficial > 0 ? '+' : ''}${macro.brechaBlueOficial}%`;
    }

    if (portfolioHealth) {
      ctx += `\n\n## Salud de cartera\n- Score de diversificación: ${portfolioHealth.diversScore}/100\n- Exposición ARS: ${portfolioHealth.arsPct}% | USD-linked: ${portfolioHealth.usdPct}%\n- Posiciones: ${portfolioHealth.numPositions} activos en ${portfolioHealth.numClasses} clases`;
      if (portfolioHealth.warnings?.length) {
        portfolioHealth.warnings.forEach(w => { ctx += `\n- ⚠ ${w}`; });
      }
    }

    if (contexto.newsContext?.length) {
      ctx += '\n\n## Noticias financieras del día (contexto de mercado)';
      contexto.newsContext.slice(0, 10).forEach(n => { ctx += `\n- ${n}`; });
    }
  }

  return `Sos un asesor financiero experto especializado en el mercado argentino. Analizás acciones del Merval, CEDEARs, bonos soberanos, LECAPs, cauciones y otros instrumentos disponibles en InvertirOnline (IOL).

Tus respuestas son:
- Concisas pero sustanciales (máximo 400 palabras)
- En español rioplatense informal y directo
- Basadas en principios sólidos de inversión: gestión de riesgo, diversificación, análisis técnico y fundamental básico
- Honestas sobre la incertidumbre del mercado argentino (volatilidad, riesgo político, tipo de cambio, brecha cambiaria)
- Siempre aclarás que el inversor decide, no vos

Al analizar siempre considerás:
- Contexto macro argentino: inflación, brecha cambiaria, riesgo país, ciclo político
- Liquidez y spreads del instrumento en IOL
- Horizonte temporal apropiado para el perfil
- Gestión de posición: stop loss, toma de ganancias parcial, sizing correcto
- Comparación entre alternativas del mismo nivel de riesgo
- Si el mercado está cerrado, aclarás que los precios son del último cierre

NO das certezas sobre el futuro del mercado. Usás frases como "en este contexto...", "una opción si confirmás...", "el riesgo principal es...". Si no tenés datos suficientes para responder con precisión, lo decís claramente.${ctx}`;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return jsonResp(res, 405, { ok: false, error: "Método no permitido. Usar POST." });
    }

    const expectedPin = env("APP_PIN");
    if (!expectedPin) {
      return jsonResp(res, 500, { ok: false, error: "APP_PIN no configurado en el servidor." });
    }

    const receivedPin = String(req.headers?.["x-app-pin"] || "");
    if (!receivedPin || receivedPin !== expectedPin) {
      return jsonResp(res, 401, { ok: false, error: "PIN inválido." });
    }

    const apiKey = env("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return jsonResp(res, 503, {
        ok: false,
        error: "Consulta IA no disponible. Agregá ANTHROPIC_API_KEY en las variables de entorno (Settings → Environment Variables)."
      });
    }

    const body = parseBody(req);
    const pregunta = String(body.pregunta || "").trim();
    if (!pregunta) {
      return jsonResp(res, 400, { ok: false, error: "Pregunta vacía." });
    }

    const systemPrompt = buildSystemPrompt(body.contexto || null);

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: "user", content: pregunta }]
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      let errMsg = `HTTP ${anthropicRes.status}`;
      try { errMsg = JSON.parse(errText)?.error?.message || errMsg; } catch {}
      throw new Error("Error Anthropic API: " + errMsg);
    }

    const aiData = await anthropicRes.json();
    const respuesta = aiData.content?.[0]?.text || "Sin respuesta del modelo.";

    return jsonResp(res, 200, { ok: true, respuesta });

  } catch (error) {
    console.error("Consulta IA error:", error.message);
    return jsonResp(res, 500, {
      ok: false,
      error: "Error interno en la consulta IA. Intentá de nuevo en un momento."
    });
  }
};
