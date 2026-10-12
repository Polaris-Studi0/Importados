# Importados

Landing estática de Importados publicada en https://tiendasimportados.com mediante GitHub Pages.

## Publicación

GitHub Pages sirve la raíz de la rama `main`. `index.html`, `styles.css`, `app.js` y `assets/` deben mantenerse en esa raíz. `CNAME` conserva el dominio `tiendasimportados.com`; `.nojekyll` permite servir los archivos estáticos sin procesamiento de Jekyll.

El diseño fuente anterior permanece en `landing/dist/`. Para cambios posteriores, sincronizar los archivos de la landing con los de la raíz antes de publicar.

## Alcance actual

Versión de presentación con navegación, animaciones, selector de ciudad y contador para la inauguración de Niquía el 14 y 15 de noviembre de 2026. Contacto, Instagram, rutas, geolocalización y PQRS conservan el comportamiento demostrativo del prototipo. Los productos e imágenes son ilustrativos.

Cloudflare, intranet, recepción y seguimiento de PQRS, vacantes y recepción de hojas de vida quedan para una etapa posterior. GitHub Pages sirve contenido estático; esas funciones requerirán la integración correspondiente.

## Vista local

Desde la raíz del repositorio:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

## Postulaciones

La landing carga `recruitment.js` y consulta un Cloudflare Worker independiente:
`https://importados-operacion.throbbing-salad-55e3.workers.dev`.

- Proyecto de Supabase: **Importados**, dentro de la organización Almacenes El Rey.
- Tabla: `public.job_applications`; acceso público bloqueado por RLS y privilegios.
- Bucket: `hojas-de-vida`, privado, PDF hasta 5 MB.
- Solo el Worker conoce la clave de servicio de Supabase y la clave secreta de Turnstile.
- No guardar claves, hojas de vida ni datos de postulantes en este repositorio.
- Por ahora el equipo autorizado revisa registros y documentos desde el panel de Supabase. La intranet será una etapa posterior.
- `Importados@polaris-studio.tech` es contacto de selección; el servicio actual no envía notificaciones por correo.
- Si el servicio está desconectado, el formulario informa que no está disponible y ofrece el contacto por correo. No simula un envío exitoso.

Código del servicio y migración específica en `recruitment/`. Pruebas: `node --test recruitment/tests/worker.test.mjs`. Despliegue: `wrangler deploy --config recruitment/wrangler.jsonc`. Configurar secretos con `wrangler secret bulk` desde un archivo privado fuera de Git.

La apertura comercial de Niquía es el **15 de octubre de 2026**. La gran inauguración es el **14 y 15 de noviembre de 2026**. `business-dates.js` calcula cada fase en hora de Colombia; la cuenta regresiva apunta al inicio de la fecha del 14, sin anunciar una hora de evento aún no confirmada.

El mini catálogo y los accesos a WhatsApp se retiraron de la landing. La versión anterior se conserva en el historial, commit `45ed09e8d4f4fd457451ef7419fa5179f0605624`, y en un respaldo local fuera de la publicación.
