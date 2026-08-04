# Seguridad fuerte por vendedor

Esta versión cambia Firestore de seis documentos con arreglos compartidos a colecciones con un documento por cliente, venta, pago, producto, movimiento y visita.

## Orden obligatorio de instalación

1. Haz respaldo del proyecto y de los datos.
2. En Firebase Console abre **Firestore Database → Reglas**.
3. Sustituye las reglas por el contenido de `firestore.rules` y pulsa **Publicar**.
4. Abre esta versión con Live Server e inicia sesión con el administrador `josegonzalezcarrillo88@gmail.com`.
5. La primera apertura del administrador migra automáticamente los datos antiguos a las colecciones seguras. No cierres la pestaña durante la primera sincronización.
6. Revisa en Firestore que existan las colecciones `clients`, `notes`, `payments`, `catalog`, `inventoryMovements` y `visits`.
7. Prueba en una ventana privada con un vendedor. Solo debe recibir sus clientes y sus operaciones.
8. Cuando la prueba termine, publica el proyecto en GitHub.

## Importante

- Los datos locales ahora se guardan con una clave separada por UID para evitar que un vendedor vea la caché de otra cuenta en un dispositivo compartido.
- El vendedor no puede cambiar la asignación de sus clientes ni leer documentos de otros vendedores.
- El catálogo es visible para usuarios activos. Solo el administrador crea o elimina productos; un vendedor únicamente puede cambiar existencias como consecuencia de una venta.
- No borres todavía `salsamixData`; sirve como respaldo de la estructura anterior hasta confirmar la migración.
