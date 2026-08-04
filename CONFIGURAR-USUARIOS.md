# Activar usuarios en Firebase

1. Firebase Console → Compilación/Build → Authentication → Comenzar.
2. Proveedores de acceso → Correo electrónico/contraseña → Activar → Guardar.
3. Pestaña Usuarios → Agregar usuario.
4. Crea primero: josegonzalezcarrillo88@gmail.com con una contraseña de al menos 6 caracteres.
5. Abre la app e inicia sesión. Esa cuenta se registra automáticamente como administrador.
6. Para cada vendedor, crea otra cuenta desde Authentication. En su primer acceso se registra como vendedor.
7. Firestore → Reglas: reemplaza las reglas con el contenido de firestore.rules y pulsa Publicar.

Esta entrega agrega inicio de sesión, roles visibles y autoría automática a nuevos clientes, notas, pagos, productos y movimientos de inventario. La separación estricta de datos por vendedor requiere migrar los arreglos compartidos a documentos individuales y se hará en la siguiente fase.
