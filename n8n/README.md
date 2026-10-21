# Atención de WhatsApp de Importados

Flujo independiente creado y publicado en la instancia paga por MCP: [IMPORTADOS · WhatsApp · Motor de atención](https://intranetelrey.app.n8n.cloud/workflow/m2q8tgG99ibAB6TO), ID `m2q8tgG99ibAB6TO`. Versión activa y borrador coinciden: `28d88274-a095-4e72-850e-e53eda68723d`. Solo devuelve propuestas autenticadas; no hay envíos a clientes ni acceso directo a Meta o a la base operativa.

## Archivos

- `attention-core.workflow.json`: exportación propia con `active:false`, sin secretos ni IDs de credenciales ajenas.
- `attention-core.sdk.ts`: fuente SDK validada para creación; no volver a crear duplicados. Las actualizaciones deben dirigirse solo al ID propio anterior.
- `system-prompt.md`: identidad y reglas de Importados.
- `source/`: validación de turno/propuesta, seis herramientas locales y fallo controlado.
- `CONTRACT.md`: entrada, salida, límites, estados de error y responsabilidades del Worker.
- `model-output.schema.json`: esquema interno del modelo, previo al validador externo.
- `tests/guards.test.mjs`: datos completamente sintéticos; 22 pruebas locales aprobadas.
- `synthetic-model-evidence.json`: resultados reducidos de las pruebas sintéticas del modelo, regresiones y versión publicada, sin secretos ni datos de clientes.

## Arquitectura

Meta → Worker de Importados → snapshot autorizado de su base → n8n → propuesta sin efectos → Worker valida/guarda/encola → Meta.

La memoria es el historial público acotado de la conversación que entrega el Worker. n8n no guarda memoria propia, no consulta otras conversaciones ni comparte memoria con otro negocio. Las seis herramientas leen exclusivamente ese snapshot: información, promociones, cotización, QR, pedido y consulta humana. Todas las respuestas llevan `send_allowed:false` y `mutations_executed:[]`.

El Worker actual ofrece información y derivación; hasta implementar las transacciones propias, debe convertir propuestas comerciales en consultas humanas sin crear pedidos, reservar stock ni aprobar pagos. Sin stock contado vigente, mapear `stock_verified:false`, `available_quantity:0`, `stock_valid_until:""`, o enviar `products:[]`. Catálogo vacío no prueba que un producto esté agotado. QR queda bloqueado mientras `payment.ready_for_qr` sea falso.

## Verificación

Se inspeccionó el contexto de la instancia, SDK, técnicas, tipos de todos los nodos y credenciales disponibles. Las configuraciones de los 17 nodos y el SDK completo validaron sin advertencias antes de crear. Cinco grupos organizan permisos, atención, validación, fallos y guía.

```sh
node --test n8n/tests/guards.test.mjs
```

Las pruebas locales cubren consentimiento, control manual, cierre, versiones/huella, expiración, límite de historial, sede ajena, catálogo vacío, QR sin autorización, evidencia de herramientas, propuestas sin efectos, comprobantes, audio sin transcripción y preservación de la consulta de disponibilidad/precio. Las pruebas del modelo real usan únicamente datos sintéticos; su evidencia reducida está en synthetic-model-evidence.json. Ninguna prueba demuestra entrega por WhatsApp.

## Credencial y publicación

Entrada publicada: POST `/webhook/importados-assistant-turn-v1`, Header Auth `x-importados-webhook-secret` mediante credencial `IMPORTADOS · Intranet → n8n`. El secreto debe coincidir con la configuración privada del Worker y permanecer exclusivamente en sus gestores de secretos. No ponerlo en parámetros, código ni este directorio.

El MCP de creación asigna automáticamente cualquier credencial existente del mismo tipo incluso cuando se solicita `newCredential` con otro nombre. Se detectó esa asignación en el nuevo flujo y se bloqueó inmediatamente el nodo de entrada; esa configuración nunca se publicó ni se ejecutó. El usuario creó después la credencial propia `IMPORTADOS · Intranet → n8n` (`YMZZGRM8goT7MYhZ`); MCP verificó el header `x-importados-webhook-secret` y su asignación exclusiva antes de habilitar el nodo para pruebas manuales. La referencia ajena fue sustituida y no se utilizó en ninguna ejecución. Esta limitación afectó únicamente al nuevo flujo; no se modificó ni ejecutó ningún flujo existente.

El modelo usa `gpt-5-mini` con Gateway credits administrados de la instancia, como el motor de referencia; no hay una clave del modelo copiada en archivos. La credencial Header Auth propia fue creada por el usuario y verificada por MCP. Su secreto solo vive en n8n y en la configuración privada del Worker; este directorio conserva únicamente nombre e ID de referencia.

Publicación del motor de propuestas autorizada después de confirmar la credencial propia y las pruebas sintéticas. La regresión final del modelo (ejecución `510`, versión `79fcb336-de4e-4c16-a660-57feb258aad3`) conserva exactamente «En Santa Lucía: ¿Tienen licuadoras y cuánto cuestan?», sin agregar variantes ni omitir el precio. Después solo se retiró del prompt una afirmación estática de registro pendiente del número; SDK y actualización validaron sin advertencias y se publicó la versión actual, sin repetir llamadas al modelo. El estado técnico de Meta pertenece al servidor.

El 21/10 se confirmó el número, se publicaron privacidad y eliminación aprobadas por Samuel, el usuario verificó el webhook y Meta suscribió messages. Meta confirmó la app publicada y Samuel autorizó activar recepción y respuestas. La conexión HTTP privada de n8n se comprobó con contrato incompleto (422 y send_allowed:false), sin modelo ni envíos. Las pruebas manuales no prueban entrega: Samuel realizará la validación real iniciando una conversación desde su celular; no se han enviado pruebas a destinatarios ajenos.

Las ejecuciones manuales de estas pruebas contienen solo datos sintéticos. En la configuración final no se guardan cuerpos de ejecuciones exitosas, fallidas o manuales, ni progreso por nodo. El Rey se verificó nuevamente sin cambios: versión activa/borrador `53cfa73d-0b89-4af2-8b08-be53399085a0` y fecha de modificación `2026-10-19T19:20:50.372Z`.

La exportación es una fuente de reconstrucción sin activación; `build-workflow.py` solo lee la referencia local y genera archivos propios, sin APIs ni escrituras fuera de este directorio. No incluye acceso a base, gateway o webhook de otro negocio. No crea commits ni publica cambios.
