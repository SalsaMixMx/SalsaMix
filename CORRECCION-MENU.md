# Corrección del menú

Se corrigió el problema en el que el encabezado cambiaba a **Ventas**, pero el contenido seguía mostrando Clientes o Adeudos.

La causa era que faltaba la función `renderVentasTab()` en `js/app.js`.

## Prueba
1. Abre con Live Server.
2. Cambia entre Clientes, Ventas, Adeudos e Inventario.
3. Comprueba que el contenido cambie junto con el título y el botón activo.
