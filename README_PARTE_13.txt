PARTE 13 - GANANCIA/PÉRDIDA + COHERENCIA DE RECOMENDACIONES

Subir SOLO:
- index.html

NO tocar:
- api/iol-dashboard.js
- vercel.json
- variables de Vercel
- PIN
- sw.js

Qué agrega:
1. Pantalla Hoy:
   - Ganancia/Pérdida actual
   - Ganancia/Pérdida diaria

2. Cartera / Tenencias:
   - Ganancia/Pérdida actual por activo si IOL devuelve ese dato
   - Ganancia/Pérdida diaria estimada por variación diaria de IOL

3. Regla de coherencia:
   - si un activo tiene alerta de reducir/proteger/no perseguir, no puede aparecer como compra
   - si un activo subió fuerte en el día, no se recomienda comprarlo tarde
   - si tiene peso alto en cartera, no se recomienda aumentar

4. Evita contradicciones:
   - no aparecerá el mismo activo en “comprar” y “no operar” al mismo tiempo dentro de la cartera sugerida

Importante:
Si IOL no devuelve ganancia/pérdida total por activo, la app lo informa como “No viene en la respuesta de IOL”.
La ganancia/pérdida diaria se estima usando valuación actual y variación diaria de IOL.
