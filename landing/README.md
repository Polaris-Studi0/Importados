# Importados — prototipo de landing page

Prototipo estático de diseño, en español, con estética de contenedor, amarillo y negro del logo, productos ilustrativos, sedes, apertura de Niquía, Instagram y PQRS.

## Abrir

Desde esta carpeta: `python3 -m http.server 4173 --bind 127.0.0.1 --directory dist`

Abrir `http://127.0.0.1:4173/`. También se puede abrir `dist/index.html` directamente; la previsualización por servidor facilita la carga consistente de recursos.

## Manual de marca web

Abrir `http://127.0.0.1:4173/manual/`. El manual es una web independiente dentro de este prototipo, con ocho secciones y treinta temas completos: esencia, identidad visual, aplicaciones, voz, atención y PQRS, redes y campañas, fotografía y operación. La navegación usa enlaces directos por capítulo y tema; el menú se adapta a móvil. Los códigos de color pueden copiarse y los ejemplos de voz muestran los cambios por canal.

El contenido está en `dist/manual/content.js`, la interfaz en `dist/manual/index.html`, y los estilos y comportamiento en sus archivos CSS y JS. Las fuentes se sirven localmente con sus licencias OFL. Los productos siguen siendo ilustrativos y las condiciones comerciales pendientes deben confirmarse antes de activar campañas.

El manual es una guía del equipo. El contrato y los documentos originales no forman parte de su carpeta pública.

## Alcance de esta etapa

Navegación, animaciones de scroll, menú móvil, contador y cambios visuales de ciudad funcionan dentro del prototipo. Contacto, Instagram, rutas, geolocalización y PQRS son demostraciones: no hay backend, envío, almacenamiento de datos, medición, mapas externos ni publicación. Los formularios explican esto al abrirse.

## Datos confirmados

- Santa Lucía, Medellín: Cr. 87 # 47 DD 50; 9:00 a. m. a 8:00 p. m. No se presume qué días de la semana aplica.
- Niquía, Bello: Dg. 55 AV 33. Próxima inauguración: 14 y 15 de noviembre. Horario por confirmar.
- WhatsApp: +57 314 789 9067. Se usa para informar el destino previsto, sin enlace activo.
- Instagram: pendiente de crear; no se inventó usuario.

## Supuestos para revisar

- Año de apertura: 2026, según el contexto de la conversación del 7 de octubre de 2026.
- El contador visual termina al inicio del 14 de noviembre, hora de Colombia. Es una referencia provisional al día anunciado, no una confirmación de la hora del evento.
- Los cuatro productos (audífonos, vaso térmico, ventilador y kit de cuidado personal) y sus imágenes son ilustrativos. No se anuncian precios, inventario, prestaciones técnicas o marcas.
- Las tarjetas incluyen esquemas gráficos para proponer el espacio del mapa; no representan cartografía ni coordenadas verificadas.
- El selector Medellín/Bello filtra la presentación visual. No calcula distancias ni usa ubicación real. Niquía permanece anunciada como próxima apertura.

## Dirección visual

- Amarillo de marca `#FFE321`, negro `#101010`, blanco `#FFFFFF`, gris de lectura `#626260` y superficie `#F3F3F0`.
- Bricolage Grotesque para titulares; Manrope para texto y controles. Se cargan desde Google Fonts, con fallback Arial.
- Marco amarillo y paneles verticales acanalados como elementos distintivos; se usa el logo proporcionado sin redibujarlo.
- Entrada inicial breve y revelado al hacer scroll. `prefers-reduced-motion` elimina movimiento y muestra el contenido.
- Las reglas de aplicación visual y verbal se desarrollan en el manual de marca web, versión 1.0.

El contrato y los PDFs originales permanecen fuera de la carpeta pública `dist`.
