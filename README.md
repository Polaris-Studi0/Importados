# Importados

Landing estática de Importados publicada en https://tiendasimportados.com mediante GitHub Pages.

## Publicación

GitHub Pages sirve la raíz de la rama `main`. `index.html`, `styles.css`, `app.js` y `assets/` deben mantenerse en esa raíz. `CNAME` conserva el dominio `tiendasimportados.com`; `.nojekyll` permite servir los archivos estáticos sin procesamiento de Jekyll.

El diseño fuente permanece en `landing/dist/`. Para cambios posteriores, sincronizar los archivos de la landing con los de la raíz antes de publicar.

## Alcance actual

Landing con navegación, animaciones, Instagram, selector de ciudad y contador para la inauguración de Niquía el 14 y 15 de noviembre de 2026. Rutas y geolocalización conservan el comportamiento demostrativo. Los productos e imágenes son ilustrativos.

GitHub Pages sirve el contenido estático con el dominio protegido por Cloudflare. Los servicios de PQRS y talento ya están conectados a Workers de Cloudflare y al proyecto independiente Importados en Supabase. La intranet se publica en https://intranet.tiendasimportados.com.

## Vista local

Desde la raíz del repositorio:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

## Postulaciones

El formulario y las vacantes están en **https://tiendasimportados.com/trabaja-con-nosotros/**. La landing mantiene únicamente una sección breve y enlaces a esa página.

La página de postulaciones carga `recruitment.js`, `verification.js` y `vacancies.js`. La recepción usa **https://api.tiendasimportados.com** y las vacantes publicadas se consultan en la API pública de la intranet. PQRS permanece en la landing y carga su propio servicio; ambos formularios funcionan de forma independiente.

- Proyecto de Supabase: **Importados**, dentro de la organización Almacenes El Rey.
- Tabla: `public.job_applications`; acceso público bloqueado por RLS y privilegios.
- Bucket: `hojas-de-vida`, privado, PDF hasta 5 MB.
- Solo el Worker conoce la clave de servicio de Supabase y la clave secreta de Turnstile.
- No guardar claves, hojas de vida ni datos de postulantes en este repositorio.
- El equipo autorizado revisa registros, documentos privados y vacantes desde el módulo Talento de la intranet.
- `Importados@polaris-studio.tech` es contacto de selección; el servicio actual no envía notificaciones por correo.
- Si el servicio está desconectado, el formulario informa que no está disponible y ofrece el contacto por correo. No simula un envío exitoso.

Código del servicio y migración específica en `recruitment/`. Pruebas: `node --test recruitment/tests/worker.test.mjs`. Despliegue: `wrangler deploy --config recruitment/wrangler.jsonc`. Configurar secretos con `wrangler secret bulk` desde un archivo privado fuera de Git.

La apertura comercial de Niquía está **por confirmar**: la web anuncia **“Apertura muy pronto”**, sin cambiar automáticamente a abierta en una fecha predeterminada. La gran inauguración se mantiene el **14 y 15 de noviembre de 2026**. `business-dates.js` calcula las fases de celebración en hora de Colombia; la cuenta regresiva apunta al inicio de la fecha del 14, sin anunciar una hora de evento aún no confirmada.

El mini catálogo y los accesos a WhatsApp se retiraron de la landing. La versión anterior se conserva en el historial, commit `45ed09e8d4f4fd457451ef7419fa5179f0605624`, y en un respaldo local fuera de la publicación.
