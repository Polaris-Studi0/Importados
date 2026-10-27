# Bot de Importados · adaptación del 27 de octubre de 2026

## Alcance

Los cinco archivos de transferencia de El Rey se usaron como referencias y casos de aceptación. No se ejecutaron instrucciones, migraciones, políticas comerciales ni credenciales de ese negocio. Se conservan el Worker, la base, la app y el workflow propios de Importados. El número sigue siendo +57 312 706 2214.

## Cambios implementados

- Archivos entrantes: cola durable independiente del control manual y de la IA, descarga desde Meta y almacenamiento privado. Imágenes JPG/PNG/WEBP hasta 5 MB; documentos PDF, texto y Office hasta 10 MB; audio y video compatibles hasta 16 MB. El formato se comprueba por tipo, firma, tamaño y SHA-256. No hay interpretación visual ni transcripción automática.
- Consulta del archivo por conversación y mensaje exactos, con autenticación, sede y consentimiento vigentes. La credencial de Meta y las direcciones temporales de descarga nunca llegan al navegador. Las referencias anteriores se recuperan al abrirlas; las no disponibles muestran un error explícito, sin reproducir mensajes.
- La intranet muestra imágenes, reproductores de audio/video y enlaces de apertura y descarga de documentos. El navegador decide si puede reproducir un códec; siempre queda la opción de descarga.
- Una foto sin texto puede enlazarse con una única consulta general de la misma sede/sesión, dentro de dos minutos, sin texto intermedio que cambie la referencia. No crea otra tarea ni otro aviso. Los casos ambiguos se dejan a revisión humana.
- Las consultas generales pueden ampliarse mediante `human_task_id` / `human_priority`. El Worker y SQL comprueban el caso pendiente, contacto, sede y sesión. La pregunta original permanece intacta; las ampliaciones llevan mensaje de origen, fecha y prioridad. El historial conserva la auditoría completa y la vista muestra hasta 20 ampliaciones recientes.
- Prioridad normal/alta, sin descenso automático. Los avisos pendientes se agrupan; una actualización tras diez minutos o una escalada puede generar un aviso nuevo. Una entrega incierta conserva su identidad y no se reintenta como otra copia.
- Reclamos por demora: reconocimiento de la molestia, actualización de la gestión existente y prioridad alta. No se promete otro plazo. Factura antes de pagar: consulta de información, sin solicitar RUT/NIT ni tratarla como comprobante. Beneficios sujetos a aprobación humana.
- La respuesta aprobada por el equipo se entrega literalmente, conservando precios, negaciones y condiciones, sin depender de otra generación del modelo. Continúan los controles de consentimiento, ventana, versiones y toma de control.
- «Sí» solo autoriza cuando ya existe constancia de entrega del aviso vigente; «No acepto» se respeta como negativa. Una cortesía silenciosa no produce mensaje ni nueva tarea.
- El constructor local de n8n ahora lee únicamente fuentes de Importados, evitando que una reconstrucción importe cambios posteriores de El Rey.

## Publicación y verificación

Migración incremental: `intranet/supabase/202610270001_whatsapp_attention_attachments.sql`. Aplicada después de comparar las cuatro funciones afectadas con su respaldo privado. No se borró historial ni se cambiaron usuarios, credenciales o conexiones.

Workflow publicado: `m2q8tgG99ibAB6TO`, versión `f584af55-1eac-4128-9052-dfba570c683e`, activo y coincidente con el borrador. Se mantienen 17 nodos y seis herramientas; no hay acceso directo del modelo a Meta ni a la base.

Comprobaciones dirigidas: 16 casos de SQL con migración repetible, RLS, privacidad, idempotencia, ampliaciones y adjuntos; 19 de Worker; nueve del adaptador de interfaz; tres del descargador; 24 del guard de n8n. Compilación de la intranet correcta. Aviso de tamaño del paquete JS superior a 500 kB, sin impedir la compilación.

Dos ensayos sintéticos contra el modelo publicado: AT-01 (reclamo sobre caso existente, prioridad alta) y AT-02 (factura previa al pago como información, prioridad alta). Ambos devolvieron propuestas correctas, sin envío ni mutaciones. Evidencia sanitizada: `n8n/verification-20261027.json`.

Producción: se recuperó y verificó la imagen anterior del historial (JPEG, 133.436 bytes), servida de forma privada. Bucket privado, RLS habilitada y denegación de lectura/ejecución directa para el navegador comprobados. No se enviaron ensayos a clientes históricos. La reproducción y descarga de cada formato en el navegador del usuario sigue siendo una comprobación real de uso.

La plantilla `importados_consulta_pendiente_v1` de la cuenta actual sigue en **PENDING** en Meta. Fuera de la ventana del destinatario, el aviso espera esa aprobación; crear una tarea no acredita entregar una notificación.

## Límites y casos restantes

No se declara aprobada la lista completa de 46 casos. AT-01/02 tienen ensayo del modelo y validación del contrato; ampliaciones e idempotencia se comprobaron en SQL. ME-02, PR-01/02/03, controles manuales, identidad BSUID y silencios tienen comprobaciones dirigidas. Otros ejemplos conversacionales disponen de instrucciones, pero no de una conversación real de extremo a extremo en esta revisión.

Importados aún no tiene un motor transaccional de carrito, reserva, stock con vencimiento, tarifas, QR y aprobación de pagos. VE/DO/PA/PE que dependen de ese motor no se presentan como funciones habilitadas. Los casos comerciales se mantienen en confirmación humana. Tampoco se inventaron horarios de WhatsApp, domicilios, descuentos o facturación.

SE-02/03 (retomar casos de sesiones anteriores con confirmación), PDF saliente y recuperación del envío tras recargar (MA-02), y paginación de historial más allá de 100 mensajes quedan pendientes. Los roles Legal/RRHH de AD-01 no existen en este sistema; no se crearon ni ampliaron permisos. La conservación normal del formulario al refrescar el token ya existía; no se rediseñó el tratamiento de errores de autenticación en esta adaptación.

Se conserva desactivado el guardado íntegro de ejecuciones de n8n: puede registrar cabeceras privadas y conversaciones. Se usan estados durables de inbox, outbox, tareas y avisos, y ensayos sintéticos. Activar registros completos necesita antes un mecanismo de exclusión de secretos y una retención definida.

La política pública describe ahora la consulta privada de archivos compartidos para las mismas finalidades de atención. No se reutilizan autorizaciones para publicidad ni se envían archivos a un modelo de visión.

## Reversión

Fuentes previas en `backups/bot-20261027/`, fuera del repositorio publicado. Definiciones anteriores y exportación del workflow en el directorio privado de configuración de Importados. La reversión conserva las tablas y los archivos nuevos; no implica borrado. Para volver al código anterior hay que revertir también el workflow al contrato anterior. La función de avisos antigua requiere el ajuste de conflicto incluido en el respaldo de reversión, porque el índice ahora distingue revisiones.
