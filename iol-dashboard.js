// Adaptador Vercel para reutilizar tu función existente de Netlify.
// No reemplaza iol-dashboard.js: lo llama desde netlify/functions/iol-dashboard.js.
// Mantiene el endpoint viejo que usa tu app: /.netlify/functions/iol-dashboard
// vercel.json redirige esa ruta a /api/iol-dashboard.

const path = require("path");

let netlifyFunction;

function loadNetlifyFunction() {
  if (netlifyFunction) return netlifyFunction;

  const functionPath = path.join(process.cwd(), "netlify", "functions", "iol-dashboard.js");
  const mod = require(functionPath);

  if (!mod || typeof mod.handler !== "function") {
    throw new Error("No encontré exports.handler en netlify/functions/iol-dashboard.js");
  }

  netlifyFunction = mod.handler;
  return netlifyFunction;
}

function normalizeHeaders(headers) {
  const output = {};
  for (const [key, value] of Object.entries(headers || {})) {
    output[String(key).toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return output;
}

module.exports = async function handler(req, res) {
  try {
    const fn = loadNetlifyFunction();

    const event = {
      httpMethod: req.method,
      headers: normalizeHeaders(req.headers),
      queryStringParameters: req.query || {},
      body:
        req.method === "GET" || req.method === "HEAD"
          ? null
          : typeof req.body === "string"
            ? req.body
            : req.body
              ? JSON.stringify(req.body)
              : null,
      isBase64Encoded: false,
      path: "/.netlify/functions/iol-dashboard",
      rawUrl: req.url
    };

    const result = await fn(event, {});

    const statusCode = result && result.statusCode ? result.statusCode : 200;
    const headers = (result && result.headers) || {};

    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined && value !== null) {
        res.setHeader(key, value);
      }
    }

    if (!res.getHeader("content-type")) {
      res.setHeader("content-type", "application/json; charset=utf-8");
    }

    res.status(statusCode).send(result && result.body !== undefined ? result.body : "");
  } catch (error) {
    console.error("Error en adaptador Vercel iol-dashboard:", error);
    res.status(500).json({
      ok: false,
      error: "Error en adaptador Vercel",
      detail: error.message
    });
  }
};
