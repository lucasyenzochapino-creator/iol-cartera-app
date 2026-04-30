PARCHE SOLO RECOMENDACIONES - IOL CARTERA PRO

Este parche NO cambia la conexión principal con IOL.
Mantiene:
- /.netlify/functions/iol-dashboard
- APP_PIN
- Tenencias / cartera
- pestañas principales de la app

Qué mejora:
1. Recomendaciones en español latino.
2. Reemplaza términos en inglés dentro de recomendaciones:
   - Momentum -> Impulso
   - Watch -> Seguimiento
   - Stop -> Pérdida máxima / invalidación
3. Agrega horizonte de análisis:
   - corto plazo
   - mediano plazo
   - largo plazo cuando corresponde
4. Agrega chequeo de contexto económico externo usando fuentes confiables:
   - BCRA
   - BYMA
   - CNV
   - Tesoro argentino
   - INDEC
   - Reserva Federal
   - BLS EE.UU.
   - Tesoro EE.UU.
5. Si el contexto externo no se puede confirmar, la app NO marca compra fuerte.
   La baja a “Esperar confirmación externa” o “Señal preliminar”.

Archivos del parche:
- index.html
- netlify/functions/iol-context.js

Cómo subir:
1. Subí index.html reemplazando el actual.
2. Subí netlify/functions/iol-context.js dentro de la carpeta netlify/functions.
3. NO borres netlify/functions/iol-dashboard.js.
4. Commit changes.
5. Esperá el deploy de Netlify.
