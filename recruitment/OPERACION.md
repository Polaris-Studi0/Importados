# Importados: recepción de hojas de vida

Montaje del 12 de octubre de 2026. La landing continúa publicada en GitHub Pages, detrás del proxy de Cloudflare. Supabase usa un proyecto independiente llamado **Importados** dentro de **Almacenes El Rey**; no comparte tablas ni archivos con el proyecto de El Rey.

## Dónde consultar postulaciones

1. Abre [el proyecto Importados en Supabase](https://supabase.com/dashboard/project/opeytkcqblgjfyvfjkwe).
2. En **Table Editor**, abre `public.job_applications` y filtra `status = received`. Ordena `created_at` de más reciente a más antiguo.
3. La fila contiene nombre, correo, celular, sede preferida, referencia (`receipt`) y nombre del archivo (`object_path`).
4. En **Storage**, abre el bucket privado `hojas-de-vida`. Busca el nombre exacto de `object_path` y usa la descarga del panel con tu sesión autorizada.
5. No hagas público el bucket ni compartas credenciales. Concede acceso al panel únicamente al personal responsable de selección.

Los registros con `status = uploading` todavía no tienen recepción confirmada. Una falla de conexión puede dejar un registro pendiente; revisa que exista el archivo antes de tratarlo como una postulación recibida. El formulario permite reintentar un envío pendiente con los mismos datos sin duplicarlo.

## Qué recibe el formulario

- Postulación general, sin anunciar vacantes no confirmadas.
- Nombre, correo, celular, sede preferida, autorización y un PDF de máximo 5 MB.
- Referencia de recepción únicamente después de guardar archivo y registro.
- Verificación Turnstile y límites de frecuencia en Cloudflare.
- Archivos privados, tabla con RLS y sin permisos de lectura pública.

El correo `Importados@polaris-studio.tech` figura como contacto y alternativa de envío. **No se configuraron notificaciones automáticas por correo**: las postulaciones web se consultan en Supabase. El funcionamiento y acceso a ese buzón deben comprobarse con su proveedor de correo.

## Servicios y mantenimiento

- Web: https://tiendasimportados.com/
- Repositorio: https://github.com/Polaris-Studi0/Importados
- Worker: `importados-operacion`.
- Dominio del servicio: `api.tiendasimportados.com`.
- Endpoint operativo de la versión publicada: `https://importados-operacion.throbbing-salad-55e3.workers.dev` (también pertenece a Cloudflare). Se conserva mientras se propaga el DNS del subdominio propio.
- Supabase: `opeytkcqblgjfyvfjkwe`, región Oregon, organización Almacenes El Rey.
- DNS: `art.ns.cloudflare.com` y `brenda.ns.cloudflare.com`. El dominio sigue registrado en GoDaddy.
- GitHub Pages permanece como alojamiento; Cloudflare administra DNS y proxy con SSL Full (strict).

Las claves están en secretos del Worker. No deben copiarse al HTML, JavaScript del navegador, Git ni documentos compartidos. La copia local de configuración sensible está fuera del repositorio, en `~/.config/importados/`, con permisos restringidos.

El código del servicio y la migración están en `recruitment/`. Para desplegar con la sesión de Wrangler ya autorizada: `npx --offline wrangler deploy --config recruitment/wrangler.jsonc`. Para ejecutar las pruebas del servicio: `npm test` desde `recruitment/`.

## Próxima etapa

La intranet de selección y el servicio real de PQRS aún deben implementarse. El panel de Supabase es la herramienta administrativa provisional. Antes de ampliar la operación, define responsables de selección, plazo de conservación de postulaciones y procedimiento para solicitudes sobre datos personales. No se debe reutilizar información de candidatos para campañas comerciales.

## Copia del diseño anterior

El mini catálogo y los botones de WhatsApp quedaron retirados de la landing pública. Se conservan en `backups/landing-antes-reclutamiento-2026-10-12.zip` y en el historial anterior del repositorio (commit `45ed09e8d4f4fd457451ef7419fa5179f0605624`).
