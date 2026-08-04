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


## Multiusuario v1
- Los administradores ven todos los clientes y pueden asignarlos a vendedores.
- Los vendedores ven clientes, rutas, ventas y adeudos asignados a su cuenta.
- Los usuarios se siguen creando gratis desde Firebase Authentication.
- Cada vendedor debe iniciar sesión al menos una vez para que su perfil aparezca en la lista.

> Esta primera fase aplica permisos en la interfaz. Como los datos actuales están guardados en documentos compartidos, el aislamiento fuerte mediante reglas de Firestore se hará en una migración posterior a colecciones individuales.


## Vendedores v2
El administrador dispone de una pestaña Vendedores con clientes, ventas, cobranza, pedidos y rutas por vendedor. En la lista de clientes se muestra el vendedor asignado.


## GPS de clientes
La ubicación se guarda desde la ficha del cliente. Las coordenadas se almacenan internamente, pero no se muestran en pantalla. El botón “Ir al cliente” abre Google Maps. La geolocalización funciona en localhost y en sitios HTTPS como GitHub Pages.


## Control de visitas
Permite iniciar y finalizar visitas, registrar observaciones, ver estados por cliente y consultar un resumen diario de ruta.


## Identidad visual y rutas inteligentes
Incluye logotipo corporativo en el encabezado e inicio de sesión, además de optimización gratuita de recorridos por cercanía.


## Identidad visual
El paquete incluye el logotipo oficial procesado desde el PDF suministrado:
- `assets/img/logo-header.png`: versión compacta para el encabezado.
- `assets/img/logo-full.png`: versión completa para el inicio de sesión.
- `assets/img/logo.png`: copia compatible de la versión compacta.

Los archivos tienen fondo transparente y están recortados para evitar que el logotipo se vea pequeño.


## Navegación compacta
La barra inferior muestra Clientes, Ventas, Adeudos e Inventario para administradores. Rutas, Productos/Reportes y Vendedores están en el menú superior. Los vendedores no ven Inventario ni Vendedores.


## Corrección de navegación
Se restauró la función de renderizado de la pestaña Ventas para evitar que quedara visible la pantalla anterior al cambiar de menú.


## Mapa de clientes
Sección exclusiva de administrador con pines para todos los clientes que tienen ubicación GPS guardada.


## PWA instalable
Incluye manifiesto, service worker, iconos y opción de instalación desde el menú superior. La interfaz puede cargar desde caché; Firebase y los mapas requieren conexión.


## Optimización de carga
La PWA muestra primero datos locales y sincroniza Firebase en segundo plano. Firestore utiliza persistencia local y el Service Worker sirve la interfaz desde caché.


## Actualizaciones de la PWA
La app detecta nuevas versiones y muestra un botón **Actualizar ahora**. No es necesario desinstalarla.


## Seguridad por vendedor
Los datos se guardan en colecciones documentales y las reglas de Firestore aplican acceso por UID y rol. Consulta `INSTRUCCIONES-SEGURIDAD-VENDEDOR.md`.


## Tipos de cliente y consignación
Los clientes pueden registrarse como cliente normal o punto de venta. Las notas pueden marcarse como consignación; estas descuentan inventario cuando se surten, pero no generan adeudo hasta convertirse en venta.
