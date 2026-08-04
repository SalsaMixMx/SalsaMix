# Actualización automática de SalsaMix

Cuando GitHub Pages publique una versión nueva, la PWA la detectará y mostrará:

**Nueva versión disponible — Actualizar ahora**

Al pulsar el botón:

1. Se activa el nuevo Service Worker.
2. Se eliminan las cachés antiguas.
3. La aplicación se recarga una sola vez.
4. Se usa la versión nueva sin desinstalar la PWA.

La aplicación comprueba actualizaciones al abrirse, al volver al primer plano y una vez por hora mientras permanece abierta.
