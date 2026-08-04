# Tickets de venta v2

La impresión ahora utiliza un documento aislado dentro de la aplicación. Esto evita imprimir el modal completo y reduce el tiempo de espera en Safari, iPhone y PWA.

## Diseño
- Formato compacto para 58 mm.
- Formato más amplio para 80 mm y PDF.
- Encabezado SalsaMix, folio, cliente, vendedor, productos, totales, saldo y estado.
- Diseño monocromático para ahorrar tinta y mejorar la impresión térmica.

## Uso
1. Abre una nota.
2. Pulsa Ticket 58 mm o Ticket 80 mm / PDF.
3. Selecciona la impresora o Guardar como PDF.

En iPhone, la impresora debe ser compatible con AirPrint o utilizar su aplicación oficial.


## Logotipo en tickets
La impresión usa `assets/img/logo-ticket.png`, una versión negra y optimizada del logotipo real. También se incrusta en el documento de impresión para evitar rutas rotas en Live Server, GitHub Pages y la PWA instalada.
