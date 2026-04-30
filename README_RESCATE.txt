PARCHE DE RESCATE - NO CAMBIA IOL

Subir SOLO estos dos archivos:
- index.html
- sw.js

No borres ni toques:
- netlify/functions/iol-dashboard.js
- variables de Netlify
- usuario/contraseña de IOL

Qué hace:
1. Vuelve a la versión que usa solamente:
   /.netlify/functions/iol-dashboard
2. Quita el cambio nuevo de contexto externo.
3. Intenta recuperar el PIN que estaba guardado en el celular con distintos nombres internos.
4. Fuerza actualización de caché.

Después de subir:
1. Commit changes.
2. Esperá el deploy de Netlify.
3. Abrí la app desde Chrome.
4. Agregá al final de la URL:
   ?rescate=5
5. Tocá “Buscar PIN guardado”.
6. Si encuentra el PIN, la app vuelve a consultar IOL.

Si no encuentra PIN:
No hay forma segura de adivinarlo. Hay que editar APP_PIN en Netlify.
