PARTE 10 - RECOMENDACIÓN EN TENENCIAS + MEJOR DETECCIÓN USD

Subir SOLO:
- index.html

NO tocar:
- sw.js
- netlify/functions/iol-dashboard.js
- Netlify
- APP_PIN

Qué corrige:
1. En Cartera / Tenencias, cada activo ahora muestra:
   - qué hacer con esa tenencia
   - mantener, reducir parcial, no aumentar, proteger, tomar parcial, etc.
   - motivo
   - entrada / cuándo aumentar
   - salida / invalidación
   - riesgo

2. Mejora la detección de saldo disponible en dólares:
   - busca USD, dólar, dolares, moneda, currency, simboloMoneda, etc.
   - detecta estructuras anidadas comunes de IOL

Importante:
Si sigue mostrando “USD no identificado en respuesta de IOL”, entonces la función iol-dashboard no está trayendo ese dato desde IOL. En ese caso hay que modificar la función del backend para incluir saldos en dólares.
