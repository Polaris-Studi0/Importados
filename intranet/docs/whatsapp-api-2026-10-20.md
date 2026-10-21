# Integración de WhatsApp · inicio 20 de octubre de 2026

## Confirmaciones de Samuel

- Primero configurar la API oficial de WhatsApp en Meta; después replicar el flujo de El Rey en la cuenta paga de n8n.
- Número: **+57 314 789 9067**. Samuel indica que no tiene una cuenta de WhatsApp vinculada.
- Portafolio de Meta: **Tiendas Importados**, identificador público `1509848827866246`. La pantalla de cuentas de WhatsApp no mostraba ninguna cuenta agregada al iniciar.
- App preparada en el asistente de Meta: **Tiendas importados**, contacto **contact@polaris-studio.tech**, caso de uso **Connect with customers through WhatsApp** y portafolio **Tiendas Importados**.
- Samuel autorizó expresamente pulsar Create app y aceptar los Términos de la Plataforma y Políticas para Desarrolladores.
- Razón social confirmada por Samuel: **GRUPO EMPRESARIAL ORIENTE SAS**. Perfil preparado con nombre visible **Tiendas Importados**, categoría **Shopping and Retail**, país **Colombia** y web **https://tiendasimportados.com/**. No se necesitó ingresar un identificador tributario en esta pantalla.

## Estado al preparar este registro

Se pulsó Create app. Meta abrió **Please re-enter your password** para confirmar la sesión de Facebook. Se solicitó a Samuel que complete esa verificación en Safari, sin compartir contraseñas por el chat. La app ya fue creada y verificada en su panel: **App ID `1378513457688529`**. Aún no tenemos WABA ID ni Phone Number ID de Importados. No registrar el número en WhatsApp móvil para intentar resolver este paso.

## Referencia de El Rey verificada por MCP (solo lectura)

Cuenta n8n accesible; motor publicado **EL REY · WhatsApp · Motor de atención**, ID `pGxqUgjYE6NCyiwZ`, versión activa `53cfa73d-0b89-4af2-8b08-be53399085a0`. La versión publicada coincide con el borrador; contiene 17 nodos y seis herramientas delimitadas. No se editó, ejecutó, duplicó ni desactivó ningún flujo.

Arquitectura de referencia: Meta → verificación de firma y recepción durable en Cloudflare/Supabase → contexto autorizado → n8n → propuesta validada en servidor → cola y envío por Meta. n8n no es el receptor público directo del flujo vigente de El Rey. La atención, identidad privada BSUID, consentimiento, sesión y tareas humanas tienen controles del servidor que deben conservarse al adaptar el flujo; no basta con duplicar visualmente los nodos.

## Continuación

1. Confirmar creación y App ID después de la verificación de sesión.
2. Abrir configuración de WhatsApp, revisar las condiciones que presente Meta y asociar una cuenta de WhatsApp de Importados.
3. Registrar el número confirmado y completar su verificación por el canal disponible. Los códigos y credenciales se introducen en el servicio correspondiente, sin copiarse al chat ni al repositorio.
4. Configurar acceso y recepción de eventos propios de Importados. Guardar App Secret, access token y verify token como secretos de Cloudflare; los identificadores y la versión de Graph son configuración no secreta. No reutilizar activos ni claves de El Rey.
5. Comprobar por separado verificación del webhook, evento firmado recibido, envío de prueba explícitamente autorizado y entrega real. No afirmar que la API está activa solo porque exista una app.
6. Después, adaptar el flujo de n8n a la base y módulos de Importados. La autorización de pruebas o apertura pública de El Rey no se traslada automáticamente a Importados.

No se modificaron la landing, los datos, los permisos ni los secretos de Importados durante este inicio. La asociación del portafolio sigue sin verificación empresarial; revisar los requisitos reales de Meta en las pantallas posteriores.

## App creada

Dashboard verificado: https://developers.facebook.com/apps/1378513457688529/dashboard/?business_id=1509848827866246 . App asociada a Tiendas Importados y caso de uso WhatsApp. La app permanece sin publicar y el canal todavía no está registrado.

En **WhatsApp → Production setup**, Meta solicita pulsar **Continue** para aceptar dos acuerdos adicionales: [Meta Terms for WhatsApp Business Platform](https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform) y [WhatsApp Business Platform Cloud API Terms](https://www.facebook.com/legal/Meta-Hosting-Terms-Cloud-API). Samuel autorizó expresamente aceptar y continuar; se pulsó el botón el 20 de octubre. La pantalla anuncia la provisión inicial de un número de prueba con hasta cinco destinatarios; ese número no sustituye el registro del número real de Importados. Evidencia local: `meta-whatsapp-condiciones-2026-10-20.png`.

## Resultado del registro del número

**Actualización verificada el 21 de octubre:** Samuel completó el proceso pendiente. Safari → Meta Developers → WhatsApp Production setup muestra el número **+57 314 789 9067** como **Registered**. Cuenta **Tiendas Importados**, WABA **`968909369072994`**, Phone Number ID **`1398533173340545`**. Estos son los activos reales confirmados; sustituyen las referencias tentativas o de prueba descritas abajo. La app continúa sin publicar, el webhook aún no tiene callback configurado y la suscripción aparece desactivada. El registro del número no demuestra todavía recepción ni entrega por la integración.

Se ingresó el número confirmado con Colombia +57 y verificación por SMS. Al continuar, Meta rechazó el alta con: **“This phone number is already in use by another WhatsApp account. Moving a phone number between WhatsApp accounts isn't supported.”**, código **#2388103**. No se alcanzó la pantalla de ingreso del código y no se confirmó ningún SMS enviado. No se eliminó ni migró ninguna cuenta. Evidencia: `meta-numero-ya-vinculado-2026-10-20.png`. Revisar las cuentas existentes antes de decidir cómo liberar o migrar el número.

WhatsApp Manager muestra únicamente **Test Messaging Account**, WABA de prueba `4735945056683065`, propiedad de Tiendas Importados, con un teléfono de prueba de Meta. No aparece el número real en ese selector. Se preguntó a Samuel por el uso previo de la SIM/número para determinar el siguiente paso; no se debe asumir si la cuenta existente es móvil o de API.

La pantalla **Publish** muestra pendiente **Privacy policy URL**, con el botón de publicación deshabilitado. La web actual solo contiene un aviso específico para postulaciones; no se configuró ese aviso como si cubriera las conversaciones comerciales de WhatsApp. La pantalla de producción advierte que la app sin publicar solo recibe webhooks de prueba enviados desde su panel. No se publicó la app ni se configuraron aún webhooks o tokens.

Samuel confirmó que **la SIM es nueva y no la han usado**. El [Centro de ayuda oficial de WhatsApp](https://faq.whatsapp.com/3347469605523961) explica que los operadores pueden reciclar números y conservarse un registro de su propietario anterior. Es una posibilidad, no un diagnóstico confirmado del error #2388103 ni una indicación de eliminar una cuenta.

Al retomar Safari, el enlace de WhatsApp Manager dentro del registro referencia ahora el activo `1436228828608088`; falta comprobar su nombre, propiedad y teléfonos en el administrador antes de tratarlo como WABA de producción. El formulario está de nuevo en **Choose the number you would like to use**, con **Add a new number** seleccionado y **CO +57**. Hubo tres interrupciones del control por cambios del usuario en Safari; se pidió dejar la ventana libre antes de continuar. No se confirmó un nuevo envío de verificación ni el registro del teléfono.

MCP Meta Social Technologies: entrada `meta-social-technologies` añadida al config global con endpoint oficial `https://mcp.facebook.com/devtools`. No autenticada: la CLI rechaza la redirección de OAuth metadata www.facebook.com → web.facebook.com. No se debilitó esa validación. El control de interfaz tampoco permite acceder al propio Codex. Samuel autorizó continuar por Safari para no detener el alta de WhatsApp. No hay contraseñas ni tokens en este registro.
