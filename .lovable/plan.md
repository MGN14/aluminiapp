## Plan: Módulo de Inventarios AluminIA

### 1. Base de datos (migración)
Crear 3 tablas con RLS:
- **`inventory_products`**: referencia, nombre, unidad, stock_sistema, stock_fisico, costo_unitario, precio_venta, ultimo_conteo, user_id
- **`inventory_movements`**: product_id, tipo (entrada/salida/ajuste), cantidad, invoice_id (opcional), notas, fecha, user_id
- **`inventory_counts`**: product_id, cantidad_fisica, cantidad_sistema, diferencia, fecha_conteo, user_id

### 2. Página de Inventarios (`src/pages/Inventory.tsx`)
Reemplazar placeholder con módulo completo:
- **Header Nico**: insights dinámicos calculados del inventario
- **Métricas clave**: 5 cards (valor total, días inventario, rotación, % sin movimiento, diferencias)
- **Gráfico evolución**: curva con glow de stock en el tiempo
- **Tabla operativa**: referencias con estados (crítico/exceso/sano), acciones rápidas

### 3. Componentes nuevos
- `src/components/inventory/InventoryMetrics.tsx` - cards métricas
- `src/components/inventory/InventoryChart.tsx` - gráfico evolución
- `src/components/inventory/InventoryTable.tsx` - tabla operativa
- `src/components/inventory/InventoryInsights.tsx` - sección Nico
- `src/components/inventory/AddProductModal.tsx` - agregar/editar producto
- `src/components/inventory/AdjustStockModal.tsx` - ajuste de inventario
- `src/hooks/useInventoryData.ts` - hook datos + cálculos

### 4. Diseño visual
- Estilo dark con degradados azul oscuro
- Efectos glow en gráficos y estados
- Cards con backdrop-blur y transparencia
- Mucho espacio, tipografía grande, badges de estado

### 5. NO incluido (futuro)
- Carga Excel (mencionado pero se deja para siguiente iteración)
- Conexión automática con facturas
- Equivalencias por proveedor
