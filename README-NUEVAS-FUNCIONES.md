# Nuevas funciones de administración

- Inventario muestra demanda de todas las notas con estado `pedido`, existencia y piezas faltantes.
- Administración permite registrar compras de proveedores, adjuntar PDF/imágenes pequeños y consultar inversión, ventas y resultado por mes.
- Despliega `firestore.rules` actualizado antes de usar compras en producción.
- Los adjuntos están limitados a 650 KB porque se guardan dentro de Firestore. Para documentos grandes se recomienda integrar Firebase Storage.
- “Resultado” es ventas menos compras del periodo; no es utilidad contable completa.
