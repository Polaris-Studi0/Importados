# Importados

Landing estática de Importados publicada en https://tiendasimportados.com mediante GitHub Pages.

## Publicación

GitHub Pages sirve la raíz de la rama `main`. `index.html`, `styles.css`, `app.js` y `assets/` deben mantenerse en esa raíz. `CNAME` conserva el dominio `tiendasimportados.com`; `.nojekyll` permite servir los archivos estáticos sin procesamiento de Jekyll.

El diseño fuente anterior permanece en `landing/dist/`. Para cambios posteriores, sincronizar los archivos de la landing con los de la raíz antes de publicar.

## Alcance actual

Versión de presentación con navegación, animaciones, selector de ciudad y contador para la inauguración de Niquía el 14 y 15 de noviembre de 2026. Contacto, Instagram, rutas, geolocalización y PQRS conservan el comportamiento demostrativo del prototipo. Los productos e imágenes son ilustrativos.

Cloudflare, intranet, recepción y seguimiento de PQRS, vacantes y recepción de hojas de vida quedan para una etapa posterior. GitHub Pages sirve contenido estático; esas funciones requerirán la integración correspondiente.

## Vista local

Desde la raíz del repositorio:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```
