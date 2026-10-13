# Intranet Importados

Operación publicada en **https://intranet.tiendasimportados.com/**. Frontend React/Vite y API Cloudflare Worker `importados-intranet`; Supabase **Importados** (`opeytkcqblgjfyvfjkwe`) dentro de Almacenes El Rey. El proyecto y los datos de El Rey no se modifican ni se comparten.

## Operación disponible

- Accesos personales por correo, con administrador y caja por sede.
- Pedidos de domicilio y recogida, productos múltiples, importes calculados en servidor, asignación de domiciliarios frecuentes u ocasionales y tiempos definidos por administración.
- Preparación, despacho, entrega y cancelación mediante acciones autorizadas; responsable físico, fecha y hora de entrega; historial inmutable por pedido.
- Comprobantes privados de hasta 5 MB; enlaces de consulta de 5 minutos.
- Personal de caja por sede y directorio de domiciliarios.
- Catálogo interno con fotografías privadas, conteos manuales de inventario con historial y conocimiento por sede.
- Chat privado entre administración y sedes, mensajes idempotentes, contador de no leídos, historial y avisos mientras la pestaña está abierta si la persona concede permiso.
- Hojas de vida privadas recibidas desde la landing: búsqueda, filtros, PDF, notas y seguimiento humano (nueva, en revisión, contactada, archivada).
- Vacantes: borrador, publicación explícita en la landing, cierre y reapertura. Los candidatos pueden elegir una vacante publicada o realizar una postulación general.
- PQRS privadas, estado, notas internas y respuesta formal registrada. El cliente consulta con radicado y código secreto de 128 bits, además de verificación Turnstile.

## Primeros pasos

1. Ingresa con `contact@polaris-studio.tech`. La invitación inicial se envió el 12/10/2026; la contraseña la configura personalmente el usuario.
2. En **Accesos del equipo**, crea los accesos de caja y asigna Santa Lucía o Niquía. La opción **Generar enlace** permite entregar un acceso de primer uso personalmente sin depender del envío de correo. Entrega ese enlace únicamente a su destinatario; no lo publiques ni lo guardes en archivos compartidos.
3. Para **Enviar invitación por correo**, Supabase usa su servicio de correo. Puede necesitar un SMTP propio para destinatarios fuera de la organización y para superar los límites de envío. No se configuró un proveedor SMTP nuevo.
4. En **Personal de caja**, registra quién puede entregar físicamente los pedidos. Este directorio es independiente de los accesos personales.
5. Agrega productos reales y sus conteos en **Catálogo e inventario**. El catálogo permanece interno: no restaura el mini catálogo de la landing.
6. Crea pedidos y sigue sus acciones. La entrega al domiciliario o al cliente exige elegir una persona activa de la sede.
7. Revisa **Talento y vacantes** y **Servicio al cliente** para responder o dar seguimiento.

## Límites de esta versión

El bot de WhatsApp, sus conversaciones, campañas y automatizaciones de Meta/n8n no están conectados para Importados. Necesitan recursos y credenciales propios. Los conteos de inventario son manuales: guardar un pedido no reserva ni descuenta automáticamente existencias. Las respuestas de PQRS se consultan en la web; no se envían avisos automáticos por email o WhatsApp. Los estados de candidaturas son seguimiento del equipo, no decisiones automáticas de selección.

No se cargaron productos, empleados, cargos ni pedidos ficticios en producción. Solo las dos sedes reales y el administrador solicitado. Las pruebas de permisos remotos se ejecutan con rollback; la demostración de interfaz usa memoria local.

## Desarrollo y despliegue

`npm install`, `npm run dev`, `npm run check`, `npm test`, `npm run build`.

La configuración pública está en `.env.local`, fuera de Git. Usa `.env.example` como referencia. Nunca incluyas una llave de servicio en variables `VITE_*`. La demostración requiere `VITE_DEMO_MODE=true` **y** un servidor de desarrollo; está deshabilitada en builds de producción incluso si esa variable queda activada.

Para publicar el Worker: `npx --offline wrangler deploy --config wrangler.jsonc`, después de lint, pruebas y build. Los secretos `SUPABASE_SERVICE_KEY` y `TURNSTILE_SECRET_KEY` viven en Cloudflare. Las modificaciones en Git no despliegan automáticamente este Worker; GitHub Pages sigue publicando la landing.

Migración aplicada específicamente: `supabase/202610120002_intranet.sql`, después de la migración inicial de reclutamiento. No aplicar migraciones de El Rey ni ejecutar seeds de demostración. RLS y permisos por columna protegen operaciones; la creación de accesos se valida con una sesión real y un perfil administrador activo en el servidor.

Los archivos y expedientes permanecen privados. Define responsables de selección, plazo de conservación y procedimiento de atención a solicitudes sobre datos personales antes de ampliar el equipo de acceso.
