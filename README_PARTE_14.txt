PARTE 14 - CAUCIONES / OPERACIONES PARA MAÑANA + RECOMENDACIÓN DE CIERRE

Subir estos 2 archivos:
1. index.html
2. api/iol-dashboard.js

NO tocar:
- vercel.json
- variables de Vercel
- PIN
- sw.js

Qué agrega:
1. Backend:
   - intenta leer operaciones de IOL
   - intenta leer cauciones
   - intenta leer operaciones pendientes
   - mantiene solo lectura
   - NO compra, NO vende, NO envía órdenes

2. Pantalla Hoy:
   - nueva sección “Cauciones / operaciones para mañana”
   - muestra cauciones u operaciones pendientes si IOL las devuelve
   - detecta si liquidan o vencen mañana

3. Recomendación para el próximo día:
   - al cierre de jornada muestra plan para mañana
   - considera cauciones pendientes
   - considera disponible ARS/USD
   - considera ganancia/pérdida diaria
   - evita recomendar comprar si hay activos débiles, activos muy subidos o concentración

Importante:
Si la caución colocada hoy no aparece, puede ser porque IOL no la devuelve en los endpoints disponibles. En ese caso la pestaña Técnico mostrará rawOperations para revisar qué devuelve IOL.
