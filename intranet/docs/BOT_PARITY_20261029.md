# Importados · revisión y equiparación del bot · 29/10/2026

Samuel solicitó revisar el bot de Importados y darle las funcionalidades y la eficiencia del bot de El Rey. Se revisaron por MCP ambos motores, el backend propio, la base y las seis conversaciones conservadas (65 mensajes, cuatro solicitudes y un pedido). El contenido privado y las definiciones anteriores están respaldados fuera del proyecto, en `~/.config/importados/parity-20261029/`.

## Hallazgos reales

- La aceptación «Sí, acepto» con puntuación no se reconocía. Después del aviso completo el cliente podía quedar esperando sin ninguna orientación.
- Una intención explícita de compra tras una respuesta breve de precio no continuó. El backend ocultaba deliberadamente el catálogo, el carrito, los QR y los pedidos a las herramientas, y derivaba la mayoría de acciones comerciales.
- El agente tenía instrucciones contradictorias: describían compras, pero también prohibían usarlas porque el servidor aún no las soportaba. Una selección respaldada por una respuesta humana podía rechazarse por no repetir una herramienta, aunque el dato ya estuviera verificado en el contexto.
- El historial de ejecuciones estaba desactivado. Un estado técnico Success no demostraba una respuesta útil ni entrega por WhatsApp.
- El catálogo y el inventario estaban vacíos. No se inventaron productos, existencias ni QR para completar las pruebas.

## Operación implementada

| Área | Comportamiento |
| --- | --- |
| Entrada | SÍ, ACEPTO y variantes explícitas con puntuación, solo después del aviso vigente entregado. Un recibo tardío puede reanudar esa aceptación sin pedirla de nuevo. Se conserva la consulta original al elegir sede o autorizar datos. |
| Sedes | Nombres y números normales, selección por frase natural, lista y cambio de sede directos. Niquía sigue abierta en Valkiria; no se copiaron sedes ni datos de El Rey. |
| Conversación | Cortesías/espera y reacciones en silencio; seguimiento sin duplicados. Reclamos con prioridad y conservación del caso original. Una gestión general anterior solo se incorpora tras confirmar sede y retomar explícitamente un único caso propio de los últimos 30 días. No se arrastra la compra anterior. |
| Información | Respuestas humanas integradas con naturalidad, preservando importes, condiciones y negativas. Un catálogo vacío no significa agotado. Consulta de precio y una compra siguen siendo intenciones diferentes. |
| Catálogo | Consulta de productos reales, fotografías privadas, vigencia de promociones y conteo por sede válido hasta el cierre de hoy. Orden de opciones entregadas conservado para referencias posteriores. |
| Compra | Selección de catálogo o artículo con precio confirmado por el equipo, captura conjunta de datos y recordatorio solo de faltantes. No se inventan IDs de producto para una oferta humana. |
| Existencias | Revalidación de precio/conteo y reserva de artículos de catálogo tras aceptación del resumen entregado. Reservas de 15 minutos, acotadas por el cierre del día; exclusión entre compradores de la última unidad. Una oferta humana sin catálogo exige aprobación estructurada de artículos, cantidades y precios. |
| Domicilio | Cobertura, tarifa y estimación confirmadas por el equipo para la dirección actual. Los cambios de dirección invalidan la tarifa correspondiente. No se prometen domicilios después de las 7 p. m. |
| Pago | QR privado de la sede después del resumen aceptado; transferencia con comprobante recibido y aprobación expresa de administración. Addi/Sistecrédito y efectivo al recoger requieren autorización humana. No hay aprobación automática ni contraentrega. |
| Pedido | Un único pedido por compra aprobada, con auditoría y descuento de unidades de catálogo. Seguimiento limitado a pedidos del contacto verificado y lectura de la estimación existente, sin reiniciarla. Acepta números con y sin guion. |
| Archivos | Fotos de producto autorizadas; recepción privada de referencias/comprobantes; control manual con JPG/PNG 5 MB y PDF 10 MB, vista previa e identidad de solicitud conservada ante resultado incierto. No se interpretan audios, fotos ni PDF mediante IA. |
| Sesiones | Nueva atención después de 24 horas sin mensajes del cliente; sede y compra anteriores no pasan a la nueva atención. Historial y pedidos conservados. Filtros Atención actual/Todo el historial y paginación privada. |
| Horarios | Confirmados por Samuel: todos los días, Colombia, WhatsApp 09–20 y domicilios 09–19. Aviso de cierre y continuación durable al abrir, solo con autorización/ventana/control vigentes. Un mensaje nuevo o control manual invalida recordatorios antiguos. |
| Equipo | Revisiones de existencias y domicilio por administración/caja de la sede; aprobación de pagos y autorización de pedidos solo por administración. Una tarea no toma control manual. Tomar control sí detiene la IA. |
| Diagnóstico | Ejecuciones exitosas, fallidas y manuales guardadas, sin progreso incremental. Estado y causas generales del inbox/outbox conservados. Entregas inciertas nunca se reenvían automáticamente. |

## Uso en la intranet

1. Catálogo e inventario: cargar artículos reales y sus fotos; precio regular y fechas de promoción son opcionales. Confirmar el conteo de cada sede. Un conteo de ayer no basta para ofrecer existencias hoy.
2. Catálogo e inventario → Medios de pago: cargar el QR vigente, el titular/nombre del medio y la sede correcta. No se configuraron cuentas bancarias supuestas.
3. WhatsApp → Solicitudes al equipo: abrir la conversación. Las revisiones de compra muestran controles de confirmación específicos; no se aprueba un pago escribiendo libremente «aprobado».
4. Tras aprobación y aceptación del cliente, el pedido aparece en Pedidos. Los pedidos manuales existentes conservan su operación y sus conteos necesitan ajuste manual.
5. En control manual pueden adjuntarse fotos/PDF. Ante incertidumbre, utilizar el reintento de la misma solicitud; nunca crear otra copia por intuición.

## Cambios técnicos y publicación

- Worker propio `importados-intranet`; Supabase propio `opeytkcqblgjfyvfjkwe`. No se modificaron El Rey, sus clientes, su motor ni sus credenciales.
- Motor MCP `m2q8tgG99ibAB6TO`, publicado `5ad41a93-34ea-47b8-b033-45041d09da51`: conserva 17 nodos, seis herramientas, modelo y credenciales. Prompt en `n8n/assistant-system.md`, guarda en `n8n/decision-guard.js`.
- Worker: publicación inicial de la revisión `de4027dd-14c7-4e6e-ae83-ade863345bc0`; versión final `c88f1ea5-53b1-41a3-89da-9271733df372`.
- Migraciones incrementales específicas `202610290001` a `202610290008`. Las seis primeras se aplicaron en una transacción; la séptima mejora la lectura de números de pedido y la octava protege la continuidad de pagos recibidos. No ejecutar toda la carpeta ni aplicar migraciones de El Rey.
- Lectura de contexto agrupada en un RPC privado; reducción de llamadas y respuestas directas para casos inequívocos. El Worker vuelve a comprobar contexto, control y datos antes de guardar; SQL gobierna reservas, revisiones y pedidos.
- Fuentes en `src/bot-*`, APIs `src/whatsapp*`, controles `WhatsAppHub.jsx`, `WhatsAppPaymentSettings.jsx`, `CommerceHub.jsx` y sus clientes privados. Se conserva la referencia del perfil al volver a la pestaña cuando no cambia su acceso.

## Validación y límites

112 pruebas PostgreSQL aisladas/Node/guarda aprobadas, además de build y lint. El lint usó las mismas versiones fijadas en un directorio limpio de dependencias: la instalación local antigua se detenía al leer una dependencia del plugin de React. Interfaz aislada comprobada en escritorio/móvil: revisión de domicilio, tarifa/estimación, PDF, sesiones y carga de QR. Diez escenarios distintos del modelo evaluados con datos sintéticos, incluidos precio humano breve, descuento negado, datos completos, reclamo, catálogo vacío, foto/cotización, QR, sede, respuesta humana y estado de pedido. Las comprobaciones técnicas no equivalen a una compra entregada por WhatsApp.

Se conservaron los seis chats, 65 mensajes, cuatro solicitudes y un pedido al publicar. No se reprodujo el historial, no se enviaron ensayos a clientes y no se crearon pedidos/productos ficticios en producción. No se reanudó ningún control manual ni se hicieron commits/push.

Falta cargar catálogo/QR reales y completar una compra real controlada por Samuel. La base estaba vacía en esos módulos, por lo que la atención de productos no cargados seguirá necesitando al equipo. La entrega de avisos fuera de 24 horas requiere la plantilla propia aprobada por Meta; se conserva su comprobación y no se ignora la ventana. No se incorporan campañas, facturación automática, geolocalización ni permisos/cuentas departamentales por copiar los de El Rey.

Respaldo: fuentes previas, metadatos de Worker/n8n y funciones anteriores en el directorio privado indicado. Para una reversión se debe revisar el estado nuevo: las migraciones son aditivas y no corresponde borrar compras ni regresar automáticamente al motor antiguo. El Worker anterior a esta revisión era `d1e4de65-abe5-4a8d-a033-db64f6f89604`; n8n anterior `0dc1b724-9236-4d3b-af65-442ed094edc0`.

Comprobación final: versión de Worker final al 100%; paquete JS servido en el dominio igual al build revisado; API privada y webhook sin firma devuelven401; flags de entrada/IA/salida y horario activados; tablas nuevas con RLS; colas vacías y registros previos intactos. El motor de El Rey sigue en2ac1fabb sin cambios.

Validación adicional de pagos: la reserva vencida mantiene el mismo comprobante y pendiente, sin pedir otro pago. Administración puede revalidar expresamente los mismos artículos/importes y la entrega antes de registrar el pedido; el servidor rechaza precio distinto o existencias insuficientes. El corte19h bloquea domicilios nuevos, conserva la revisión de las compras aceptadas antes del corte. Casos SQL aislados y casilla obligatoria en interfaz móvil comprobados.
