# Cambio de número de Importados · 26 de octubre de 2026

Samuel pidió cambiar el canal a **+57 312 706 2214** y proporcionó su token. Graph confirmó token válido de SYSTEM_USER, app1378513457688529 y expires_at0. No se guardan sus valores en Git.

Meta confirmó el número VERIFIED y CONNECTED en Cloud API, nombre Tiendas Importados, Phone Number ID1427253940466059, WABA1165310869256663. Es una WABA nueva: la anterior968909369072994 quedó sin teléfonos registrados. Se suscribió explícitamente la app propia a messages en la WABA nueva, con success:true. El callback y App Secret pertenecen a la misma app y se conservan.

La revisión previa no encontró envíos en cola/en curso, inbox pendiente ni avisos en cola. Se pausaron las tres banderas de atención durante la transición para no mezclar token e identificadores. Historial, tareas y usuarios se conservan; no se reproducen eventos ni se envían pruebas a terceros.

El token se guarda exclusivamente como WHATSAPP_ACCESS_TOKEN en secretos de Cloudflare. El número del responsable de avisos sigue siendo el configurado previamente; no se cambia por el nuevo número comercial.

Se actualizó únicamente el contacto oficial en el prompt de n8n y se publicó la versión0f33e606-301e-4dc6-9a41-d77055b0cc8f. La nueva WABA requiere su propia plantilla importados_consulta_pendiente_v1: solicitud29422395237367288, categoríaUTILITY, inicialmentePENDING. Esa revisión de Meta afecta los avisos fuera de ventana; la atención entrante no depende de la aprobación de esa plantilla.

Los datos de contacto actuales en privacidad y el manual se actualizan también. El registro histórico de octubre21 permanece como antecedente.

Worker de la transición:10fa9af2-52b2-4b9d-b507-3aa0ddb063cc. Incluye las funciones previamente publicadas de Tomar control, envío de fotos JPG/PNG privadas de5MB y avisos idempotentes a solicitudes nuevas. Se sincronizan también esas fuentes, cuya publicación en Git había quedado pendiente.

Samuel confirmó que envió un mensaje al número nuevo y recibió respuesta real el26/10/2026. Cloudflare y la base quedaron con recepción, IA y envío activados para los identificadores nuevos. La plantilla de avisos seguíaPENDING al cierre.
