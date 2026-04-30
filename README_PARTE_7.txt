PARTE 7 - USAR SOLO DINERO DISPONIBLE PARA OPERAR

Subir SOLO:
- index.html

NO tocar:
- sw.js
- netlify/functions/iol-dashboard.js
- Netlify
- APP_PIN

Qué corrige:
1. El monto recomendado ya NO se calcula sobre el total de la cartera.
2. La app intenta leer efectivo disponible para operar desde IOL.
3. Si detecta disponible, calcula montos sobre ese disponible.
4. Si NO detecta disponible, NO inventa un 25% de la cartera.
5. En ese caso muestra:
   - porcentajes de referencia
   - “Monto: No calculado”
   - advertencia clara

Objetivo:
Que la recomendación diaria sea operable solo con dinero realmente disponible, no con posiciones ya invertidas.
