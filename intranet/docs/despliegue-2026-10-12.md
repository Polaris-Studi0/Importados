# Despliegue Importados · 12 de octubre de 2026

Intranet: https://intranet.tiendasimportados.com/

Repositorio: https://github.com/Polaris-Studi0/Importados

Código final Git: be0ad00aa251276b8888f3731a7afe90c5f3dc41. GitHub Pages publicado correctamente: https://github.com/Polaris-Studi0/Importados/actions/runs/38342791778.

Worker intranet: importados-intranet, versión55fbff04-19d6-46a9-920a-b3c62c3bdbd4. Worker reclutamiento: importados-operacion, versión368ad1c9-3865-43d6-8651-8a885d641946. HTTPS y assets verificados; CSP, FrameDENY y noindex en intranet; APIteam exige sesión validada y adminactivo.

Supabase Importados: opeytkcqblgjfyvfjkwe, proyecto independiente dentro de Almacenes El Rey. Migración202610120002 aplicada después de dryrun con rollback; 19 pruebas SQLaisladas y prueba de permisos real con rollback aprobadas. Solo las dos sedes reales y el administrador solicitado se aprovisionaron. La invitación de contact@polaris-studio.tech fue aceptada según confirmación del usuario, quien configuró personalmente su contraseña. SiteURL/redirect exactos intranet; registro público y acceso anónimo Auth desactivados.

Pruebas: 37 intranet (7 sesión + 19 PostgreSQL + 11 Worker); 21 reclutamiento. Lint/build aprobados, auditnpm sin vulnerabilidades. Bundle sin claves de servicio ni referencias al proyecto Supabase de El Rey. UI administración/caja verificada a390/320px medianteiframes locales porque overrideviewportIAB no cambió el tamaño real. Sin desbordamiento horizontal. Registro local de pedido pickup con2items a15000: total30000, demo aislado en memoria.

PQRS real de prueba: IMP-PQ-737227DD6DEE. Enviada desde landing con Turnstile automático, datos explícitamente sintéticos y correoexample.invalid. Confirmación verificada, estado y respuesta registrados mediante RPC, y consulta pública con código privado aprobada. Registro cerrado y notas indican prueba, conservando el historial inmutable. No se envió correo a cliente alguno. La prueba cerrada se ve en el filtro Todas/Cerradas, no en Pendientes.

Vacantes públicas y postulación general conectadas. Validación de idempotencia mantiene recibo/archivo al cerrar una vacante después de recibir la postulación. PDFs, imágenes y soportes permanecen privados. Mini catálogo y WhatsApp siguen retirados. Sin datos ni configuración de El Rey modificados.

Pendientes fuera de esta etapa: Meta/n8n/bot/campañas, correoSMTPpara invitaciones ampliadas y notificaciones dePQRS, reservas/descuentos automáticos de inventario. Conteosmanuales y seguimiento humano de candidaturas.

Evidencias locales: intranet-publicada-2026-10-12.png y pqrs-publica-validada-2026-10-12.png. Fuente/guía: ../README.md.

HTMLdelorigen GitHubPages idéntico; los cinco assetsJS/CSS finales coinciden. Cloudflare transforma las direcciones de correo en HTML mediante su protección de email; la diferencia de HTMLproxied no es una discrepancia de despliegue. Formularios públicos y lectura de correo renderizados correctamente.
