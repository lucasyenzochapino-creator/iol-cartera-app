// Endpoint de consulta con IA para IOL Cartera Pro.
// Recibe { pregunta, contexto } y devuelve { ok, respuesta }.
// Requiere ANTHROPIC_API_KEY en variables de entorno.

function jsonResp(res, status, data) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.send(JSON.stringify(data));
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function buildSystemPrompt(contexto) {
  let ctx = "";

  if (contexto) {
    const {
      mainRecommendation, summary, holdingsCount,
      availableCash, marketStatus, holdingAnalysis, newOpportunities
    } = contexto;

    const arsDisp = availableCash?.ars > 0
      ? "$" + Math.round(availableCash.ars).toLocaleString("es-AR")
      : "no detectado";

    ctx = `

## Estado actual de la cartera del usuario
- Recomendación del día: ${mainRecommendation || "—"}
- Resumen del análisis: ${summary || "—"}
- Tenencias activas: ${holdingsCount || 0}
- Disponible ARS: ${arsDisp}
- Estado mercado: ${marketStatus?.status || "—"} (${marketStatus?.argTime || "—"} ARS)
${marketStatus?.note ? "- Nota mercado: " + marketStatus.note : ""}`;

    if (holdingAnalysis?.length) {
      ctx += `\n\n## Tenencias actuales\n`;
      holdingAnalysis.forEach(h => {
        ctx += `- ${h.symbol} (${h.assetClass || "—"}): Score ${h.score}/100, Riesgo ${h.riskColor}, Valuación ${h.valueARS ? "$" + Math.round(h.valueARS).toLocaleString("es-AR") : "—"}, Hoy ${h.dailyPct != null ? (h.dailyPct >= 0 ? "+" : "") + h.dailyPct.toFixed(2) + "%" : "—"}, P&L ${h.pnlPct != null ? (h.pnlPct >= 0 ? "+" : "") + h.pnlPct.toFixed(2) + "%" : "—"}\n  Decisión: ${h.decision} — ${h.reason}\n`;
      });
    }

    if (newOpportunities?.length) {
      ctx += `\n## Oportunidades detectadas hoy\n`;
      newOpportunities.forEach(o => {
        ctx += `- ${o.symbol} (${o.assetClass || "—"}): Score ${o.score}/100, Riesgo ${o.riskColor}, Precio ${o.price != null ? o.price.toLocaleString("es-AR", {maximumFractionDigits:2}) : "—"}, Hoy ${o.dailyPct != null ? (o.dailyPct >= 0 ? "+" : "") + o.dailyPct.toFixed(2) + "%" : "—"}\n  Acción: ${o.action} — ${o.thesis}\n`;
      });
    }
  }

  return `Sos un asesor financiero experto especializado en el mercado argentino. Analizás acciones del Merval, CEDEARs, bonos soberanos, LECAPs y otras inversiones disponibles en InvertirOnline (IOL).

Tus respuestas son:
- Concisas pero sustanciales (máximo 400 palabras)
- En español argentino informal y directo
- Basadas en principios sólidos de inversión: gestión de riesgo, diversificación, análisis técnico y fundamental
- Honestas sobre la incertidumbre del mercado argentino (volatilidad, riesgo político, tipo de cambio)
- Siempre recordás que el inversor decide, no vos

Cuando analizás oportunidades siempre considerás:
- Contexto macro argentino (inflación, brecha cambiaria, riesgo país, ciclo político)
- Liquidez y spreads del instrumento en IOL
- Horizonte temporal apropiado para el perfil
- Gestión de posición: stop loss, toma de ganancias parcial, sizing correcto
- Comparación entre alternativas del mismo riesgo

NO das certezas sobre el mercado. Usás frases como "en este contexto...", "una opción si confirmás...", "el riesgo principal es...". Si no tenés datos suficientes, lo decís claramente.${ctx}`;
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
        error: "Servicio de IA no configurado. Agregá ANTHROPIC_API_KEY en las variables de entorno del servidor (Vercel → Settings → Environment Variables)."
      });
    }

    const body = req.body || {};
    const pregunta = String(body.pregunta || "").trim();
    if (!pregunta) {
      return jsonResp(res, 400, { ok: false, error: "Pregunta vacía." });
    }

    const contexto = body.contexto || null;
    const systemPrompt = buildSystemPrompt(contexto);

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
      throw new Error("Error API Anthropic: " + errMsg);
    }

    const aiData = await anthropicRes.json();
    const respuesta = aiData.content?.[0]?.text || "Sin respuesta del modelo.";

    return jsonResp(res, 200, { ok: true, respuesta });

  } catch (error) {
    console.error("Consulta IA error:", error);
    return jsonResp(res, 500, {
      ok: false,
      error: "Error interno en la consulta IA.",
      detail: error.message
    });
  }
};
