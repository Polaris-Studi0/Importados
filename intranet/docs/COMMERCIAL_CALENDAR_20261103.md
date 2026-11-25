# Calendario comercial · noviembre 2026

Módulo de administración de Importados en `/?calendario=1`, integrado en el menú «Calendario comercial». Planeación vigente: 5 reels (4 orgánicos + R05 adicional para pauta), 15 posts/carruseles, 15 stories individuales en fechas seleccionadas del 4/11 al 1/12, dos rodajes y una revisión de resultados; fechas de temporada y natillada del 1/11 como antecedente. La planeación no programa publicaciones en Meta ni realiza gasto en pauta.

## Contenido y uso

Calendario mensual y agenda; filtros por formato, temporada y estado; detalle con objetivo, láminas, guion por tiempos/planos/voz/texto, caption, referencias de producto y pendientes. Administración puede editar fechas, horas, estado, caption, láminas, planos, pendientes y acuerdos. La revisión concurrente se compara antes de guardar. No se aprueba ni registra publicado si quedan pendientes.

El botón «Compartir calendario» permite crear enlaces de consulta de 7/30/90 días, copiar y abrir el enlace y revocarlo. Los dueños pueden ver calendario, estrategia y piezas sin tener acceso de operación. El enlace se muestra una sola vez al crearlo: si se pierde, se genera otro. Compartirlo efectivamente con terceros lo hace Samuel. Exportación ICS de los elementos filtrados, como eventos de día completo con la hora propuesta de Bogotá en la descripción.

## Hechos y pendientes

- Niquía ya abierta: Diagonal 55 Av 38-33, edificio Valkiria. Horario general confirmado 9–20, sin asumir horario específico de festivos.
- Inauguración 14 y 15 de noviembre de 2026; 20 % en casi toda la tienda. Toto y Sirirí, música en vivo e imitadora de Arelys Henao de Yo Me Llamo. No usar la identidad de la cantante original como si viniera ella.
- Rifa: compra en tienda y seguir Instagram, confirmado por Samuel el 3/11. Moto AKT (confirmar nombre exacto Special 110X), patinetes eléctricos. Bases, cantidades, sorteo y entrega aún pendientes.
- Concurso «Culi chupado»: premio $500.000 en efectivo + $500.000 para gastar en tienda. Faltan bases/dinámica/cupos/seguridad y horarios. No presentarlo como $1.000.000 en efectivo.
- Black Friday 27–29: 20 % en toda la tienda según Samuel; validar condiciones finales y sedes, sin arrastrar exclusiones de inauguración ni extender la promoción.
- Ocho fotos de `PRODUCTOS/`: licuadora, arrocera, dos trenes navideños, Papá Noel, piezas doradas/plateadas y árboles. Originales copiados sin transformar a `public/marketing-assets/`; no son diseños finales. Sus etiquetas no se asumen como precios vigentes o base de descuento. Otras categorías navideñas requieren inventario real.

Fuentes de investigación y límites constan en «Estrategia y fuentes». Meta describe recomendaciones personalizadas de creación/interacción/alcance y pruebas con no seguidores; se proponen POV, presentador, transformación y lista como hipótesis para esta tienda. No se garantiza viralidad ni una hora universal. El perfil/embebido de Instagram bloqueó lectura el 3/11 y el buscador no recuperó piezas verificables: revisión actual de feed e Insights pendiente. No se inventó una auditoría de publicaciones o rendimientos.

## Persistencia y seguridad

Migración aditiva propia `supabase/202611030001_commercial_calendar.sql`: planes, piezas y enlaces. Seed con `ON CONFLICT DO NOTHING`: volver a aplicar no pisa ediciones. Solo proyecto Importados `opeytkcqblgjfyvfjkwe`. No toca compras, bot, colas, QR, clientes, pedidos ni registros de El Rey.

API privada exige token Supabase verificado y perfil admin activo. RLS solo permite lectura autenticada de plan/piezas a administradores; sin escritura directa del cliente. Tabla de enlaces sin acceso anon/authenticated, incluso para leer hashes. Las modificaciones pasan por el Worker y llevan revisión esperada.

Enlace con token aleatorio de 256 bits en fragmento, nunca query. En base solo SHA-256. La vista consulta por POST y exige token vigente/no revocado en cada lectura, con limitación de solicitudes, no-store, noindex y no-referrer. Respuesta acotada a metadatos y registros editoriales del único plan; sin perfiles, credenciales, compradores ni conversaciones. La consulta refresca cada minuto. Las fotos de marketing son recursos estáticos públicos; el plan y los guiones no se incluyen en el bundle público. Cualquiera con el enlace puede consultar hasta vencer/revocar: no es identidad individual de un dueño.

Conserva las variables/secrets, cron y configuración del Worker existente. Respaldo de archivos cambiados en `../backups/calendario-20261103/`. La preferencia vigente del repositorio es commit/push manual por Samuel; no se realiza commit ni push automático.

## Publicación comprobada

Worker `5f49a217-ef38-42bd-8e52-d3bffe4bb327`, 3/11/2026; previo `c88f1ea5-53b1-41a3-89da-9271733df372`. Migración aplicada al proyecto propio; 62 registros: 19 feed, 34 secuencias de stories, 4 temporadas y 5 actividades. RLS verificado. 18 pruebas aisladas del módulo/API base aprobadas, render estático de la vista de consulta, alineación mensual y exportación ICS comprobados. Build aprobado con aviso preexistente de tamaño del paquete. No se controló la pantalla ni se simuló revisión visual.

Dominio real: health200, API privada401 sin sesión, enlace incorrecto404, enlace de consulta válido200 con las cantidades previstas, no-store/no-referrer/noindex y paquete servido idéntico al build. Primer enlace de dueños creado con vigencia de 90 días; valor solo en el registro privado, no en Git. No se enviaron mensajes ni se modificó n8n. Fuentes preparadas para revisión/commit manual en el checkout; sin commit/push.

## Ajuste autorizado: dos rodajes y quinto reel

- Rodaje 1: jueves 5/11 confirmado, horario 09:00–14:00 propuesto; R01, R02, R05 y banco fotográfico. R01 se edita primero para mantener salida el 5 a las 18:30; si no se revisa a tiempo, debe reprogramarse expresamente.
- Rodaje 2: jueves 19/11 propuesto, aún por confirmar, 09:00–14:00; R03, R04 y banco Navidad/Black Friday. R03 pasa del 18 al 20 para salir después de rodar; R04 conserva el 26.
- R05 adicional: 50–55 s, todas las dinámicas (descuento en casi toda la tienda, rifa moto/patinetes, compra + seguir IG, artistas/imitadora, concurso y premios separados), publicación propuesta 9/11, con edición/revisión/cierre 6–8. La propuesta de pauta 9–13 no activa campaña ni gasto. No se da por aprobada la elegibilidad del anuncio o las bases.
- No se programan rodajes el 4, 9, 16 o 23. Las memorias de natillada/inauguración usan material existente o espontáneo que aporte tienda; si falta, se hacen piezas gráficas sin simular cobertura, sin tercera jornada.
- Migración incremental `202611030002_calendar_two_shoots.sql`: guardas de igualdad/revisión contra snapshot previo, cambios atómicos y repetición sin pisar ediciones. Retira únicamente las actividades de rodaje A03/A04, consolida A01/A02 y añade R05. Total vigente 61 entradas: 20 feed, 34 stories, 4 temporadas y 3 actividades (2 rodajes + revisión). Semilla original se conserva inmutable.
- Encabezado ahora calcula conteos desde los datos. Logo horizontal aportado por Samuel el 3/11, archivo original 1897×829 copiado sin edición a intranet y páginas públicas. Las copias de landing están preparadas para su commit/push manual; no se afirma que GitHub Pages lo haya publicado.

Publicación de la revisión: Worker `e47b8300-5b67-467b-8300-9f35a2ad8adc`. Build aprobado; ocho pruebas específicas aprobadas incluida migración incremental repetible y conservación de ediciones. Enlace de consulta existente devuelve 61 entradas y cinco reels; dos rodajes y fechas previstas. Paquete actual servido en dominio real y logo idéntico byte a byte al archivo aportado. Landing pendiente del commit/push manual.

## Corrección de alcance: 15 stories individuales

Samuel confirmó que el paquete incluye solo 15 stories. La planeación diaria anterior excedía el alcance. Vigente: 5 reels, 15 posts/carruseles y exactamente 15 stories individuales, cada una una sola imagen, clip o recompartido (no secuencias de varias láminas). Las entradas se distribuyen en 4, 5, 6, 9, 12, 13, 14, 15, 17, 20, 24, 26, 27 y 29 de noviembre y 1 de diciembre. Se conserva el trabajo en dos rodajes y el quinto reel del 9/11.

Migración `202611030003_calendar_15_stories.sql`: comprueba snapshot, bloquea filas y aplica atómicamente la reducción; 15 stories existentes convertidas a una sola pieza y 19 sobrantes retiradas únicamente de la planificación. No toca feed, rodajes, enlaces de consulta, bot ni datos operativos. Total vigente: 42 entradas (20 feed, 15 stories, 4 temporadas y 3 actividades). La repetición conserva las ediciones humanas posteriores. Los textos de las secciones históricas anteriores documentan versiones previas, no el alcance actual.

## Alternancia diaria autorizada

Vigente: una pieza base por día del 4/11 al 3/12, alternando 15 stories y 15 posts sin huecos. Los 5 reels se suman a cinco días de post a distinta hora (post 11:30 / reel 18:30): 5, 9, 11, 21 y 25 de noviembre. Esto supone cinco días con dos publicaciones de feed; los días de story no tienen otra publicación del paquete. Las stories se muestran de forma predeterminada para no aparentar huecos.

Se conserva R05 el 9 antes del evento; R03 pasa al 21 y R04 al 25 para respetar alternancia y rodaje del 19. Inauguración: P06 el 13 pasa a «Mañana empieza», story el 14 y P07 el 15. Black Friday: P12 el 27, story el 28, P14 el 29. P13 pasa al 3/12 como selección navideña sin 20 % ni condiciones vencidas; el 30/11 story de agradecimiento, sin prolongar descuento. Dos rodajes y alcance 5/15/15 intactos.

Migración `202611030004_calendar_alternating.sql`, con guardas de snapshot y revisión, actualización atómica y repetición sin pisar ediciones posteriores. No crea, borra ni duplica entregables ni enlaces; modifica fechas/horas y adapta textos al día real.
