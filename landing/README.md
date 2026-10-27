# Importados · landing pública

Sitio estático publicado en https://tiendasimportados.com mediante GitHub Pages y Cloudflare. La fuente pública está en `dist/`; el checkout de publicación se encuentra en `../publish/Importados`.

## Vista local

`python3 -m http.server 4173 --bind 127.0.0.1 --directory dist`

## Información vigente · 27 de octubre de 2026

- Santa Lucía: Cr. 87 # 47 DD 50, Medellín. Horario físico: 9:00 a. m. – 8:00 p. m.
- Niquía: Diagonal 55 Av 38-33, edificio Valkiria, Bello. Ya está abierta. Horario físico: 9:00 a. m. – 8:00 p. m.
- Gran inauguración de Niquía: 14 y 15 de noviembre de 2026. La apertura comercial y la inauguración son hechos distintos.
- WhatsApp operativo: +57 312 706 2214, con enlaces `wa.me` desde la cabecera, portada, pie y acceso flotante.
- Instagram: https://www.instagram.com/tiendasimportados/. Se muestra la vista oficial del perfil, sin credenciales ni contadores inventados, con enlace alternativo si Meta no carga.
- Las imágenes `logo-importados-2026.png` y `navidad-importados-2026.jpg` fueron suministradas por el propietario. Se conservan completas; el logo se encuadra con un viewport SVG, sin redibujarlo. Los recursos previos permanecen disponibles.

## Funciones

Geolocalización bajo permiso, distancias aproximadas calculadas en el navegador, Google Maps, menú móvil, animaciones con movimiento reducido, contador de inauguración y formularios reales de PQRS/empleo. Los formularios usan el servicio de Importados en Cloudflare; sus credenciales no pertenecen a esta carpeta.

La referencia de Niquía para distancias es el punto enlazado por la cuenta oficial de Instagram (6.3392231, -75.5456356), tratado como aproximado. «Cómo llegar» busca la dirección completa del edificio Valkiria. La ubicación del visitante no se almacena ni se envía a nuestros servicios.

`node --test tests/locations.test.mjs` comprueba el cálculo y la navegación de sedes. Los contratos, documentos comerciales, respaldos y configuración privada quedan fuera de `dist/`. El manual histórico conserva sus fuentes en `dist/manual/`.
