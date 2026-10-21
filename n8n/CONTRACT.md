# Contrato privado Importados

Motor: `IMPORTADOS · WhatsApp · Motor de atención`, ID `m2q8tgG99ibAB6TO`. URL publicada: `https://intranetelrey.app.n8n.cloud/webhook/importados-assistant-turn-v1`. Versión activa/borrador `28d88274-a095-4e72-850e-e53eda68723d`. POST JSON autenticado por Header Auth `x-importados-webhook-secret`, credencial propia `IMPORTADOS · Intranet → n8n`. Nunca reutilizar las credenciales de otra marca.

## Entrada

```json
{
  "contract": "importados.bot.turn.v1",
  "mode": "preview",
  "turn_id": "UUID",
  "conversation_id": "UUID",
  "control_version": 0,
  "context_version": 0,
  "context_fingerprint": "SHA256 hexadecimal minúscula",
  "snapshot": {
    "source": "intranet",
    "issued_at": "ISO8601",
    "expires_at": "ISO8601",
    "control": {"manual_paused": false, "closed": false, "consent": "granted", "allow_ai": true},
    "branch": {"id": "ID propio", "name": "Nombre verificado"},
    "message": {"id": "ID propio", "text": "Texto actual", "kind": "text"},
    "history": [],
    "products": [],
    "information": [],
    "qr_assets": [],
    "last_options": [],
    "cart": [],
    "operator_instructions": [],
    "payment": {"ready_for_qr": false, "quote_id": ""},
    "checkout": {},
    "order": null
  }
}
```

`test` exige `snapshot.source=synthetic`. `preview` y `pilot` exigen `source=intranet` y fingerprint SHA256. Los UUID aceptados son versiones 1–5; las versiones de contexto/control son enteros seguros no negativos. Cuerpo máximo 140.000 caracteres JSON. Contexto vigente como máximo cinco minutos; `issued_at` admite cinco segundos de desfase futuro. Consentimiento o automatización ausentes, control humano, cierre y contexto vencido detienen el turno antes del modelo.

| Campo del snapshot | Contenido y límite |
| --- | --- |
| `history` | Hasta 60 `{role:customer|assistant|operator,text}`; texto 2.000 caracteres. Solo historial público autorizado de esta conversación |
| `products` | Hasta 100; `id,branch_id,name,description,price_cop,available_quantity,active,stock_verified,stock_valid_until,offer_starts_at,offer_ends_at`. Precios/cantidades enteros no negativos; todos pertenecen a la sede actual |
| `information` | Hasta 40 `{id,topic,text}`; texto 2.000 caracteres. Información verificada de Importados y sede |
| `qr_assets` | Hasta 10 `{id,branch_id,label,active}`. Solo activos de la sede actual. Se pasan referencias, no secretos ni archivos |
| `last_options` | Hasta 10 IDs reales del catálogo, en el orden presentado |
| `cart` | Hasta 10 `{product_id,quantity}`; referencias reales y cantidades 1–99 |
| `operator_instructions` | Hasta 10 `{id,text}`; texto 1.000 caracteres. No autoriza saltar guardas |
| `message.attachment` | Opcional `{id,message_id,persisted:true}`; pertenece al mensaje actual. Un archivo recibido no aprueba pago |
| `onboarding_request` | Opcional, consulta original hasta 2.000 caracteres, preservada tras consentimiento/sede |
| `confirmed_answers` | Opcional, hasta 10 `{id:UUID,question,answer}`; respuesta hasta 1.800 caracteres, misma conversación/sede |
| `pending_tasks` | Opcional, hasta 10 `{id:UUID,question,status:pending|in_progress}`; pregunta hasta 800 caracteres |
| `human_resolution` | Opcional `{task_id:UUID,inbound_message_id,question,answer}`; respuesta aprobada hasta 1.800 caracteres. Prioriza la consulta original |
| `product_images` | Opcional, hasta 100 `{id:UUID,product_id,task_id,caption}` autorizadas; caption hasta 500 caracteres |
| `checkout` | Estado verificado de la compra actual: stage, cart/pending_selection, datos confirmados, summary_delivered y controles del servidor. No arrastrar datos de otras compras |
| `payment` | `{ready_for_qr,quote_id}` habilitado únicamente por Worker |
| `order` | `null` o `{id,status,summary}` del pedido ya vinculado y autorizado. La IA no busca otros clientes |

## Herramientas sin efectos

Todas son Code Tools locales que leen únicamente el contexto normalizado de este turno. No hay HTTP, SQL, almacenamiento, credenciales de base, envío ni notificación. Todas rechazan contextos vencidos. Los argumentos son un objeto JSON codificado como texto en `query`.

| Herramienta | Argumentos | Resultado principal |
| --- | --- | --- |
| `consultar_informacion` | `{}` | Información verificada y respuestas humanas autorizadas; `not_found` si falta |
| `buscar_promociones` | `{query?:string,max_price_cop?:integer}` | Máximo cinco opciones por grupo `available`, `needs_verification`, `unavailable`. Vacío no prueba ausencia de stock |
| `cotizar_carrito` | `{items:[{product_id,quantity}]}` | `quote_preview` con líneas y subtotal; no domicilio, reserva, pedido ni aprobación de pago |
| `consultar_qr` | `{}` | Referencia del único QR autorizado para sede/cotización habilitada, o estado de falta de autorización |
| `consultar_pedido` | `{}` | Solo pedido ya vinculado al cliente; nunca crea uno |
| `solicitar_equipo` | `{reason,question}` | Propuesta de consulta humana; no la registra ni avisa al equipo |

## Salida

HTTP 200 y `status=decision_ready`:

```json
{
  "contract": "importados.bot.decision.v1",
  "status": "decision_ready",
  "mode": "preview",
  "source": "intranet",
  "turn_id": "UUID",
  "conversation_id": "UUID",
  "expected_control_version": 0,
  "expected_context_version": 0,
  "expected_context_fingerprint": "SHA256",
  "expires_at": "ISO8601",
  "send_allowed": false,
  "requires_commit": true,
  "mutations_executed": [],
  "decision": {
    "intent": "information",
    "reply_text": "Propuesta de texto para el cliente",
    "offered_product_ids": [],
    "quote": null,
    "actions": [],
    "checkout": {},
    "confirmed_item": null,
    "accept_summary": false,
    "cancel_cart": false,
    "media_ids": []
  },
  "evidence": {"tools_used": ["consultar_informacion"]}
}
```

Intents: `information`, `discovery`, `quote`, `qr`, `handoff`, `order_status`, `clarification`, `close`, `checkout`. `reply_text` máximo 1.800 caracteres. Hasta cinco productos ofrecidos, diez líneas cotizadas, dos imágenes autorizadas.

Acciones admitidas:

- `{type:propose_quote,items:[{product_id,quantity}]}`. `quote` devuelve líneas calculadas y `subtotal_cop`, `delivery_included:false`, `reserved:false`, `order_created:false`.
- `{type:propose_qr,asset_id,branch_id,quote_id}`.
- `{type:propose_human_task,reason,question,related_message_id}`. Razones: `human_request`, `missing_information`, `stock_check`, `payment_review`, `pqrs`.

`checkout` es un parche con campos opcionales de texto `customer_name`, `recipient_name`, `recipient_phone`, `fulfillment_type` (`delivery|pickup`), `delivery_address`, `delivery_zone`, `payment_method` (`transfer|addi|sistecredito|cash_prepaid`). Tener un método admitido por el formato NO significa que Importados lo tenga habilitado: el Worker debe comprobar su política propia.

`confirmed_item` es `null` o `{source_task_id,source_excerpt,name,variant,unit_price_cop,quantity}`, con fuente humana literal y verificable; recuerda una selección, no stock contado. `accept_summary` requiere resumen vigente ya entregado. `cancel_cart` es solo una propuesta.

El esquema de salida interna del modelo está en [model-output.schema.json](model-output.schema.json); el envoltorio externo lo construye `source/validate-decision.js` tras validar las referencias.

## Rechazos y recuperación del Worker

Todo rechazo usa el contrato de decisión propio, `send_allowed:false`, `requires_commit:false`, `mutations_executed:[]`, `decision:null`. No hay que mostrar su `status` técnico al cliente ni tratar HTTP 200 como prueba de respuesta útil.

- HTTP 422: payload, contrato, versiones, snapshot, sede, catálogo, listas o mensaje no admitidos.
- HTTP 409: contexto vencido o propuesta/referencias incompatibles/no verificadas; refrescar contexto, sin registrar ni enviar la propuesta rechazada.
- HTTP 200 sin decisión: `manual_control`, `conversation_closed`, `consent_required`, `automation_deferred`; respetar estado, sin modelo/envíos.
- HTTP 503: `integration_not_enabled` o `agent_unavailable`. Este último incluye `retryable:true` y una categoría de fallo sin contenido privado. Conservar ingreso durable y reintentar solo cuando el Worker pruebe que no hubo commit/envío; no repetir entregas inciertas.
- HTTP 401/403/404: credencial/entrada sin configurar o flujo desactivado; integración bloqueada, sin intentar otro negocio.

Antes de cualquier commit/envío, el Worker debe volver a comprobar conversación/último mensaje, identidad, consentimiento, control manual, sede, versiones/fingerprint, vencimiento, catálogo/stock/QR, política comercial propia y restricciones Meta. Solo transacciones idempotentes pueden guardar tareas/cotizaciones/carrito, resolver compras y emitir la cola. Un pago siempre exige aprobación humana explícita. El modelo nunca envía ni aprueba pagos.

El registro real del número en Meta fue verificado por el agente principal y permanece separado de este motor. Atención pública y envío real siguen bloqueados por el servidor hasta completar privacidad y webhook. Una validación local, prueba con datos sintéticos o estado success en n8n no prueba entrega por WhatsApp.
