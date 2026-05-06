PARTE 19 - MOTOR AGRESIVO CONTROLADO PARA CORTO PLAZO

Subir SOLO:
- index.html

NO tocar:
- api/iol-dashboard.js
- vercel.json
- variables de Vercel
- PIN
- sw.js
- manifest / iconos

Qué agrega:
1. Nueva sección en pantalla Hoy:
   “Motor agresivo controlado”

2. Busca oportunidades de corto plazo con filtro más exigente:
   - score agresivo
   - no perseguir subas fuertes
   - no promediar caídas
   - no aumentar si ya hay concentración
   - no operar si falta precio válido

3. Si hay oportunidad fuerte, muestra:
   - activo
   - monto sugerido
   - porcentaje
   - comprar desde
   - comprar hasta
   - objetivo 1
   - objetivo 2
   - stop / invalidación
   - plazo
   - riesgo
   - instrucciones de compra y venta

4. Si NO hay oportunidad fuerte, muestra:
   - no operar agresivo
   - caución / esperar
   - motivos por los que rechazó activos

5. Mejora la pestaña IA:
   - solo simula operaciones agresivas si cumplen el filtro fuerte
   - si no hay oportunidad, simula caución / esperar
   - sigue sin comprar ni vender
   - sigue sin enviar órdenes reales

Seguridad:
- Solo cambia index.html.
- No toca conexión con IOL.
- No toca PIN.
- No toca variables.
- No toca Vercel.
