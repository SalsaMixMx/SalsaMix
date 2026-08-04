# SalsaMix v2

## Probar localmente
No abras `index.html` con doble clic, porque Firebase usa módulos ES.

En VS Code instala la extensión **Live Server**, abre `index.html` y pulsa **Go Live**.

## Publicar
Sube todo el contenido de esta carpeta a la raíz del repositorio GitHub Pages.

## Importación inicial
Si Firestore está vacío, la app intenta importar los datos guardados en el navegador actual y después los sincroniza con Firebase. Haz la primera apertura desde el dispositivo que contiene tus datos actuales.


## Inventario y pedidos
Las notas con inventario insuficiente se guardan como pedidos pendientes. No generan adeudo ni aceptan cobro hasta surtirse.


## Usuarios
Consulta `CONFIGURAR-USUARIOS.md` para activar Firebase Authentication y las reglas de Firestore.
