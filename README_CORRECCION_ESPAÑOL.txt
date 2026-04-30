PARCHE CORRECTIVO - ESPAÑOL LATINO EN RECOMENDACIONES

Este parche NO cambia la app completa.
No toca:
- tus tenencias
- la conexión con IOL
- netlify/functions/iol-dashboard.js
- el APP_PIN

Corrige:
- “Ideas / watchlist” -> “Ideas / lista de seguimiento”
- “Watch” -> “Seguimiento”
- “Momentum” -> “Impulso”
- “Stop” -> “Pérdida máxima / invalidación”
- agrega detalle en cada idea:
  - Horizonte
  - Lectura
  - Condición
  - Riesgo

También incluye sw.js actualizado para que el celular no siga mostrando la versión vieja guardada en caché.

Subir al mismo repositorio:
1. index.html
2. sw.js
3. netlify/functions/iol-context.js

NO BORRAR:
netlify/functions/iol-dashboard.js

Después del deploy:
- Cerrá la app del celular.
- Abrila desde Chrome una vez.
- Tocá Actualizar.
- Si sigue igual, en Chrome abrí la URL con ?v=3 al final.
