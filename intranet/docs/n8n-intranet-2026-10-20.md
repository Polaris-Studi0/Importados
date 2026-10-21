# WhatsApp: n8n e intranet de Importados

Trabajo autorizado por Samuel el 20 de octubre de 2026 mientras se resuelve el registro del número real en Meta. Este registro distingue preparación, pruebas sintéticas y atención pública. No se envían mensajes de prueba a clientes.

## Recursos propios

- Intranet: https://intranet.tiendasimportados.com/
- Supabase Importados: `opeytkcqblgjfyvfjkwe`.
- Worker: `importados-intranet`.
- Flujo: [IMPORTADOS · WhatsApp · Motor de atención](https://intranetelrey.app.n8n.cloud/workflow/m2q8tgG99ibAB6TO), en la cuenta paga existente de n8n.
- App de Meta: `1378513457688529`; teléfono registrado: `+57 314 789 9067`, WABA `968909369072994` y Phone Number ID `1398533173340545`. Graph v25.0 confirmó el nombre Tiendas Importados y calidad GREEN.
- Credencial exclusiva de entrada: `IMPORTADOS · Intranet → n8n`, tipo Header Auth, cabecera `x-importados-webhook-secret`. El valor no se registra en documentos ni código.

## Conexión

Meta → Cloudflare verifica firma y activo → Supabase conserva el evento de forma idempotente → contexto acotado de Importados → n8n propone una respuesta → el servidor vuelve a validar control, autorización, versiones y ventana → cola con un solo intento de envío.

n8n no recibe la llave administrativa de Supabase, no aprueba pagos y no envía directamente a Meta. Sus seis herramientas trabajan sobre el contexto verificado de una conversación. Una edición de catálogo o una intervención del equipo invalida las propuestas anteriores. No se reutilizan secretos, clientes ni base de El Rey.

## Acceso del equipo

La administración conserva su acceso actual con `contact@polaris-studio.tech`. El nuevo apartado **WhatsApp** permite consultar conversaciones y pendientes, tomar control manual, asignar sede, guardar respuestas del equipo y consultar los estados de mensajes. Caja queda limitada a la sede de su perfil activo; los expedientes sin sede son de administración.

La pestaña de integración permite ensayar una consulta sintética. Esta prueba no crea conversaciones ni pedidos ni envía WhatsApp. Una simulación exitosa no acredita registro del número, recepción de eventos firmados ni entrega al cliente.

## Activación autorizada

Samuel autorizó publicar la app y activar recepción, IA y envío el 21 de octubre. Las tres banderas están activadas y la base fija el inicio de atención en `2026-10-21T11:01:13.995175Z`, con política `2026-10-21.v1`. La recuperación programada corre cada minuto. Los requisitos de configuración se completaron; la prueba de recepción y entrega real la realizará Samuel:

1. Número real registrado, WABA y Phone Number ID propios de Importados, permisos y versión de Graph.
2. App Secret, access token y verify token propios como secretos de Cloudflare.
3. Política pública de privacidad adecuada para WhatsApp, versión del aviso y consentimiento verificable posterior a su entrega.
4. Webhook de Meta verificado y app publicada; prueba entrante y salida dirigida a un destinatario expresamente autorizado.
5. Fecha de activación explícita para descartar eventos anteriores y recuperación programada de trabajos pendientes.

## Alcance comercial

El catálogo y los conteos actuales de Importados son manuales. Esta etapa no implementa el motor transaccional completo de reservas, cotizaciones aceptadas, tarifas, QR y aprobación de pagos de El Rey. Las propuestas comerciales requieren intervención del equipo; el bot no puede afirmar un pedido creado, disponibilidad confirmada, reserva ni pago aprobado sin el respaldo correspondiente. No se cargan productos ni registros operativos ficticios.

## Verificación

La migración base de WhatsApp se aplicó al proyecto propio de Importados el 21 de octubre de 2026, con atención pública apagada. El token de sistema se comprobó válido, de la app correcta y sin vencimiento declarado por Meta. App Secret, access token, verify token y la clave exclusiva de n8n están guardados como secretos de Cloudflare; no se incluyen sus valores en el repositorio.

La batería previa aprobó 69 pruebas de intranet, permisos, base y WhatsApp; después se aprobó la regresión focal de aislamiento de horarios (14 pruebas Worker). n8n aprobó 22 guardas y casos sintéticos, incluido el pendiente de disponibilidad y precio. El build de producción terminó correctamente, con advertencia de tamaño de bundle. ESLint quedó bloqueado al cargar su propio módulo en este entorno; no se registra como aprobado. Samuel realizará la validación funcional final.

La corrección incremental `202610210001_whatsapp_privacy_receipts.sql` también se aplicó. Vincula recibos al aviso y versión exactos; las comprobaciones focales aprobaron 11 casos SQL y dos casos Worker de cortesías y presupuesto temporal. La conexión HTTP real con n8n aceptó la cabecera propia y rechazó el contrato incompleto con 422, sin ejecutar el modelo ni enviar mensajes.

Worker inicial publicado el 21 de octubre: versión `04b6a185-5315-4505-8405-a887bf8619c9`, con recuperación cada minuto y banderas públicas inicialmente apagadas. Samuel aprobó privacidad y eliminación con `Importados@polaris-studio.tech` como canal; ambas páginas responden 200 en el dominio. El usuario guardó el verify token, Meta confirmó messages suscrito y la app publicada. Se autorizó después activar atención; solo queda pendiente acreditar recepción y entrega real mediante la prueba del usuario.

Los archivos de rollback se conservan en `backups/intranet-antes-whatsapp-2026-10-20.zip`; el respaldo excluye variables locales y parte del checkout publicado anterior.

## Corrección de recepción · 21 de octubre

La primera prueba del usuario no recibió respuesta. La base no tenía conversaciones, inbox ni outbox. Graph GET sobre el recurso subscribed_apps de la WABA propia devolvió lista vacía: verificar el callback y suscribir el campo messages en la app no había vinculado la WABA a la app. Se completó POST subscribed_apps, autorizado dentro de la activación del canal; Meta devolvió success:true y GET confirmó exclusivamente la app1378513457688529. No se enviaron mensajes de prueba desde el servidor. Pendiente del nuevo mensaje del usuario para comprobar recepción y entrega.

El diagnóstico se ejecutó en una sesión remota temporal de Wrangler que heredó el secreto de Cloudflare, sin exportar el access token ni crear una ruta de mantenimiento en producción.
