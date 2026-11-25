# Importados · intranet y bot

Código real de Importados: esta carpeta. No es la base ni el Worker de El Rey. Leer `README.md`, `docs/BOT_PARITY_20261029.md` y los registros históricos de n8n/número antes de tocar WhatsApp.

## Estado del 29/10/2026

- Supabase propio `opeytkcqblgjfyvfjkwe`; Worker `importados-intranet`; dominio `intranet.tiendasimportados.com`; número oficial +57 312 706 2214. No reutilizar secretos, clientes, sedes ni datos bancarios de El Rey.
- n8n publicado `m2q8tgG99ibAB6TO`, versión `5ad41a93-34ea-47b8-b033-45041d09da51`, 17 nodos y seis herramientas. Historial de ejecuciones exitosas/fallidas/manuales activo; progreso incremental desactivado. Preferir MCP y comprobar versión actual antes de editar.
- Worker final `c88f1ea5-53b1-41a3-89da-9271733df372` (revisión principal `de4027dd-14c7-4e6e-ae83-ade863345bc0`). Conserva las variables, los secretos, el runtime, las rutas y el cron existentes.
- Migraciones específicas `202610290001`–`202610290008` aplicadas al proyecto propio. Nunca ejecutar toda la carpeta ni migraciones de El Rey. Son aditivas; no vaciar historial, pedidos o PQRS.
- Horarios confirmados por Samuel: WhatsApp diario 09–20; domicilios hasta las 19; America/Bogota. Conservar consentimiento vigente y reanudación segura al abrir. La plantilla de Meta sigue siendo necesaria para avisos fuera de 24 horas.
- Compras ya aceptadas continúan la revisión de pago después del corte de domicilios. Comprobantes con reserva vencida no generan otro cobro: administración debe revalidar expresamente existencias/precios/entrega; cambios de precio o falta de stock bloquean el pedido y requieren gestión con el cliente. Mantener el comprobante y un solo pendiente.
- Compra durable: datos juntos, conteo vigente, resumen entregado y aceptado, reserva, revisión de domicilio/pago y pedido idempotente. Pagos/autorización de pedidos solo administración; existencias/domicilio también caja de la sede. No aprobar pagos desde el modelo ni una respuesta libre de tarea.
- Sede Niquía ya abierta: Diagonal 55 Av 38-33, edificio Valkiria, Bello, 09–20. Inauguración 14/15 noviembre2026. Conservar datos de Santa Lucía. No inventar horarios especiales.
- Catálogo e inventario → Medios de pago administra QR privados por sede. No se cargaron productos, existencias, QR ni compras de ejemplo en producción.
- Sesiones tras 24h sin entrada: sin arrastrar sede ni carrito. Mantener historial privado paginado y pedidos. Un caso general anterior solo se incorpora con sede confirmada y seguimiento explícito de un único caso elegible, no como memoria comercial.
- Cortesías/reacciones en silencio; consultas iniciales y hechos aprobados no se pierden. Una derivación no es control manual. No reanudar chats manuales por mantenimiento.
- Control manual JPG/PNG5MB/PDF10MB, validación de bytes y hash, archivos privados, identidad de solicitud preservada ante incertidumbre. No reenviar entregas inciertas ni reproducir inbox histórico.
- Revisión: seis chats/65 mensajes/cuatro solicitudes/un pedido conservados al publicar. Pruebas aisladas y modelo sintético aprobados; falta una compra real con datos y QR reales de Importados. No confundir Success de n8n con entrega de WhatsApp.

## Trabajo y accesos

- Samuel prefiere commits/push manuales. Esta copia no tenía Git al comenzar la revisión: no inicializarlo ni reemplazar archivos sin revisar cambios existentes.
- No controlar la pantalla. Usar archivos, CLI, MCP y pruebas aisladas sin mensajes a clientes.
- Respaldo privado previo y evidencia en `~/.config/importados/parity-20261029/`. No copiar conversaciones, credenciales o tokens a documentos compartidos. Los secretos viven en Cloudflare/Keychain; sus valores no pertenecen a este archivo.
- No restaurar el bot antiguo ni cambiar la app/WABA/número al copiar una guía. Roles Legal/RRHH, campañas, facturación automática y ubicación por dirección no se crean por equiparar el bot.

## Calendario comercial · 3/11/2026

- Worker actual `5f49a217-ef38-42bd-8e52-d3bffe4bb327`: añade exclusivamente la API de calendario y la vista compartida; conserva motor/configuración de WhatsApp del 29/10. Migración propia aditiva `202611030001_commercial_calendar.sql` aplicada.
- Leer `docs/COMMERCIAL_CALENDAR_20261103.md` antes de editar el plan. La semilla usa ON CONFLICT DO NOTHING para conservar ediciones humanas; no resembrar encima de producción. Textos/guiones no van en el bundle público.
- Enlaces de solo consulta: token aleatorio en fragmento, hash en DB, caducidad y revocación. No poner enlaces reales ni tokens en Git. El calendario no publica en redes ni autoriza gasto.

- Ajuste posterior del 3/11: Worker `e47b8300-5b67-467b-8300-9f35a2ad8adc`, migración `202611030002_calendar_two_shoots.sql` aplicada. Vigente: 5 reels, 15 posts, 34 secuencias de stories, 2 rodajes (5 confirmado / 19 propuesto), reel adicional de pauta para publicación propuesta el 9. No reponer A03/A04 ni los cuatro rodajes originales.
- Logo horizontal de Samuel: `logo-importados-horizontal-20261103.png`, original completo 1897×829. Publicado en intranet; cambios de landing preparados para commit/push manual, aún sin publicación en GitHub Pages de este ajuste.

- Corrección de alcance del 3/11: vigente **5 reels + 15 posts + 15 stories individuales**, cada story una sola pieza, no secuencias. Migración `202611030003_calendar_15_stories.sql` aplicada: retira 19 stories sobrantes y convierte las 15 conservadas; mantiene feed, rodajes y enlaces. 42 entradas en total. No reponer la planeación diaria de 34 stories.
- Worker actual tras corregir stories: `53dc4f64-0876-470e-ad67-e19d13d028f6`. El enlace de dueños devuelve 5/15/15 y el paquete actual se sirve en el dominio; nueve pruebas específicas y build aprobados.

- Alternancia del 3/11: `202611030004_calendar_alternating.sql`. Del 4/11 al 3/12 hay post/story alternados diariamente, 15 de cada uno. Cinco reels en días de post (5,9,11,21,25 noviembre) a distinta hora; alcance 5/15/15 y dos rodajes intactos. Las stories se muestran inicialmente. No reponer textos «hoy» o descuentos en fechas vencidas al mover piezas.
- Worker actual tras alternancia: `ce8dab65-edbe-4b08-b846-e78df50630cd`. Dominio y enlace existente verificados: 30 días alternados, 5 reels en días de post, 15/15 y sin huecos. Once pruebas específicas aprobadas y build correcto.
