# Instalar SalsaMix como PWA

## Publicación
La PWA funciona en Live Server para pruebas y en GitHub Pages mediante HTTPS. Debes subir también `manifest.webmanifest`, `service-worker.js` y `assets/icons/`.

## Android / Chrome
Abre SalsaMix, entra al menú superior y pulsa **Instalar aplicación**. También puedes usar el menú de Chrome → **Instalar aplicación**.

## iPhone / iPad
Abre SalsaMix en Safari, pulsa **Compartir** y después **Añadir a pantalla de inicio**.

## Actualizaciones
Esta versión usa red primero y caché como respaldo. Cuando publiques cambios, abre la app con conexión; el service worker buscará la versión nueva. Si fuera necesario, cierra y vuelve a abrir la app.

## Alcance sin conexión
La interfaz puede abrir con los recursos guardados. Firebase, el mapa, el inicio de sesión y la sincronización de datos requieren conexión.
