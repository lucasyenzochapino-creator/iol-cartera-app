PARTE 8 - SALDO DISPONIBLE EN PANTALLA PRINCIPAL

Subir SOLO:
- index.html

NO tocar:
- sw.js
- netlify/functions/iol-dashboard.js
- Netlify
- APP_PIN

Qué agrega:
1. En la pantalla principal “Hoy” aparece una tarjeta nueva:
   “Saldo disponible para operar”

2. Ese saldo se intenta leer de manera real desde la respuesta de IOL.

3. Si lo detecta:
   - muestra el monto disponible
   - marca “Disponible”
   - muestra el origen/campo detectado

4. Si no lo detecta:
   - muestra “No detectado”
   - NO inventa saldo
   - avisa que no calculará montos operativos sin disponible real

Objetivo:
Separar claramente:
- Valor total de cartera
- Saldo disponible para operar

Así las recomendaciones usan dinero realmente disponible, no posiciones ya invertidas.
