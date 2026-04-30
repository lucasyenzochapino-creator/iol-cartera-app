PARTE 9 SEGURA - SALDOS ARS/USD + CONSULTA + ICONOS + OCULTAR MONTOS

Subir SOLO:
- index.html

NO tocar:
- sw.js
- netlify/functions/iol-dashboard.js
- Netlify
- APP_PIN

Importante:
Esta versión parte de la versión estable y mantiene intacta la lógica del PIN:
- getPin()
- Buscar PIN guardado
- Recuperar conexión
- endpoint /.netlify/functions/iol-dashboard

Agrega:
1. Pantalla principal:
   - Disponible en pesos
   - Disponible en dólares
   - ambos reales si IOL los devuelve

2. Botón:
   - Ocultar todos los montos
   - Mostrar todos los montos

3. Barra inferior:
   - iconos mejorados
   - nueva pestaña Consulta

4. Consulta:
   - preguntar por GGAL, AL30, NVDA, CAUCIÓN, etc.
   - devuelve decisión, monto sugerido si hay ARS disponible, porcentaje, plazo, entrada, salida/invalidación y riesgo

Subida:
1. Reemplazar solo index.html.
2. Commit changes.
3. Esperar deploy.
4. Abrir desde el mismo navegador donde funcionaba.
5. Si pide PIN, usar “Buscar PIN guardado” o “Recuperar conexión”.
