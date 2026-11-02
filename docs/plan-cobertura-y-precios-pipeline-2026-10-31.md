# Plan — Cobertura y Análisis de precios con el pipeline completo (llegado · embarcado · en fábrica)

**Fecha:** 2026-10-31 · **v1 aprobada e implementada el mismo día** (Nico: "Dale, implementala", con las opciones propuestas en §6) · implementó: Claude Code.

**Pedido de Nico:** "mejorá cómo se calcula cobertura y análisis de precios; ya hay suficiente
información para hacer un verdadero análisis, con lo que ha llegado, lo que viene en tránsito y
está en fabricación".

---

## 0. Diagnóstico en dos líneas

- **Cobertura** ya suma lo que viene (packing/proforma de los pedidos abiertos, a su fecha de
  llegada a bodega), pero lo muestra como UN número ("En tránsito") sin distinguir lo que está en
  el agua de lo que sigue en fábrica, no muestra cuándo llega cada lote, y no mira lo que YA llegó
  (último contenedor, cuánto trajo, cuánto se vendió). La auditoría del 2 de agosto dejó esta
  pregunta abierta (§6.4): *"si el pedido en producción se retiene en fábrica, la proyección queda
  optimista y la cobertura no lo penaliza"*.
- **Análisis de precios** solo mira pedidos que ya tienen TRM de abonos: un pedido en fábrica o en
  tránsito sin giros **no existe** para la pestaña, y uno con abonos parciales aparece como si
  fuera real, valorado a la TRM de lo ya pagado (no del saldo que falta comprar). No cruza el costo
  con el stock que hay en bodega ni con la lista de precios: dice "este contenedor salió 6% más
  caro que el anterior", no "con lo que viene, el inventario me queda a $X y el margen a lista
  actual baja a Y%".

---

## 1. Qué ya existe (verificado en el código, no rehacer)

| Pieza | Dónde | Se reusa para |
|---|---|---|
| Llegada a bodega por pedido, según etapa | `reorderSuggestion.estimateDisponibilidad` + `useReorderSuggestion.disponibilidadPorImport` | fecha de cada lote en camino |
| Proyección de quiebre con reposiciones | `reorderSuggestion.projectQuiebres` (pura) | segunda corrida "solo embarcado" |
| Cobertura por variante de color | `coverageVariants.buildVariantPrimitives` | se mantiene intacta |
| Items de contenedores entregados + ventas desde la entrega (FIFO) | `containerSellThrough` (lo usa ReportesBodega) | "último llegado · vendido desde que llegó" |
| Landed cost por referencia | `landedCost.computeLandedCost` | landed proyectado de los pedidos abiertos |
| TRM mixta (pagado a su TRM + saldo a TRM vigente) | `importCosting.computeImportBreakdown.trmMixta` / `importScenario.escenarioVigente` | TRM de los pedidos abiertos |
| Margen mayorista a lista actual, precio necesario, refs en riesgo | `priceImpact.computePriceImpact` + `useListaPrecios` | margen actual vs proyectado |
| TRM de hoy | `useMacroIndicators` (Importaciones.tsx ya la lee como `trmHoy`) | saldos sin girar |
| Costo promedio del stock por variante | `inventory_variants.avg_cost` (fallback `inventory_products.cost_per_unit`) | costo promedio proyectado |

Nada de esto requiere migraciones ni tocar `supabase/`. Todo el dato ya está en la base.

---

## 2. Cobertura — qué cambia

### 2.1 El pipeline, por etapa y por lote

Hoy el motor recibe cada lote como `TransitoItem { reference, cantidad, fechaDisponible }`. Se le
agrega `etapa` (`'fabrica'` = producción o listo en fábrica · `'embarcado'` = tránsito o aduana) y
`pedido` (el label del contenedor). `QuiebreProducto` devuelve además `llegadas[]` (fecha,
cantidad, etapa, pedido) y los totales `enFabrica` y `enEmbarcado`. `enTransito` sigue existiendo
(suma de ambos) para no romper nada.

En la tabla, la columna **En tránsito** se parte en dos:

- **Embarcado** — lo que ya está en el agua o en puerto (tránsito + aduana). Es lo **seguro**: la
  fecha de llegada se conoce; a lo sumo se corre unos días.
- **En fábrica** — producción + listo en fábrica. Es lo **probable**: puede retenerse (caso real de
  los 2 contenedores simultáneos).

Cada celda muestra el total y, al pasar el mouse, lote por lote:
`2026-3 · 1.100 und · llega ≈ 24 nov (aduana)`.

### 2.2 Cobertura en dos lecturas

- **Cobertura** (como hoy): días hasta el agote contando TODO el pipeline. Es la que alimenta la
  fecha del banner y **no cambia**.
- **Solo embarcado** (nueva): días hasta el agote contando bodega + embarcado, SIN fábrica. Sale de
  una segunda corrida de `projectQuiebres` con los lotes de fábrica filtrados (función pura, costo
  cero).

Si las dos difieren, la referencia **depende de la fábrica**: chip "depende de fábrica" cuando
"solo embarcado" queda ≤ 45 días y la cobertura total no. Responde "¿qué me pasa si el contenedor
de China se demora?" **sin tocar el ancla del pedido** (regla de la auditoría: etiquetas sí,
filtros del ancla no).

### 2.3 Lo que ya llegó: último contenedor por variante

Columna nueva **Último llegado**: unidades que trajo el último contenedor entregado con esa
variante, fecha de entrega y pedido — y debajo, **vendido desde que llegó** en unidades y %:
`1.200 und · 15 jul (2026-2) · vendido 900 (75%)`.

Sirve para dos cosas al montar el pedido: comparar el **Sugerido** contra lo que se pidió la última
vez, y ver si lo que llegó rotó o se quedó. Fuente: `import_items` de los pedidos entregados o
cerrados (packing manda; si no, proforma — hoy solo se consultan los abiertos) + remisiones desde
la fecha de entrega (`fechaEntregaImport`). Se consultan los últimos 3 entregados para que cada
variante encuentre su último lote (no todas vienen en todos los contenedores).

### 2.4 Lo que NO cambia en Cobertura

- Demanda (censura × tendencia × estacionalidad × merma), fecha del banner, ancla del quiebre
  grupal, umbrales, `suggestOrderQty`. El sugerido sigue descontando todo el pipeline (lo pedido no
  se vuelve a pedir).
- `CoverageAlertsReport` y `ReorderSuggestionCard`: a lo sumo ganan los chips "X und embarcadas ·
  Y en fábrica" en el detalle (opcional).

### 2.5 Cómo se vería la tabla

```
Referencia  Color  Dem/día  Bodega  Embarcado        En fábrica         Cobertura  Solo embarcado   Último llegado               Sugerido  ≈kg
LIV-40-3    negro  24,1     1.103   +1.100 · 24 nov  +2.300 · ≈18 dic   142d       91d              1.200 · 15 jul · 75% vend.   1.480     612
GL4102      mate   19,8     410     —                +1.500 · ≈18 dic   96d        21d  ⚠ fábrica   2.000 · 15 jul · 92% vend.   2.120     —
```

Exportar Excel incluye las columnas nuevas.

---

## 3. Análisis de precios — qué cambia

### 3.1 Real vs proyectado, los dos en la misma serie

Cada punto de la serie por referencia lleva `estado` (entregado · aduana · tránsito · fábrica) y
`proyectado: boolean`.

- **Real** = pedidos entregados o cerrados, como hoy (landed con la TRM ponderada de los abonos).
- **Proyectado** = pedidos abiertos (hoy invisibles si no tienen abonos):
  - **TRM** = mixta, la misma regla que Escenarios: lo ya girado a la TRM de cada abono + el saldo a
    la **TRM de hoy**. Sin abonos, TRM de hoy. Se marca "TRM hoy".
  - **Costos de nacionalización** = los del pedido si ya los tiene (incluidas las filas "estimado"
    que escribe Escenarios). Si no tiene ninguno, se estiman con la **estructura del último
    entregado** en COP/kg (el mismo criterio de "molde" de `columnaHoy`). Declarado como supuesto
    en pantalla.
  - Arancel e IVA: **excluidos del costeable** igual que hoy (`landedCost` ya lo hace; no se toca).

### 3.2 Costo promedio proyectado del inventario

Por referencia (familia -5, porque el precio de lista vive ahí):

```
costo proyectado = (stock en bodega × costo promedio actual + Σ unidades en camino × landed proyectado del lote)
                   ÷ (stock en bodega + Σ unidades en camino)
```

Stock y costo actual: `inventory_variants` (stock + avg_cost) sumados por familia; fallback al `-5`
de `inventory_products` (stock_physical × cost_per_unit) si la maestra no está sembrada.
**Es el número que manda para la lista de precios**: lo que te va a costar el inventario cuando
todo esté en bodega, no lo que costó el último contenedor.

### 3.3 Margen a lista de hoy: actual → proyectado

Con `useListaPrecios` (sale_price por familia) y `computePriceImpact`:

- margen mayorista hoy = (lista sin IVA − costo actual) ÷ lista
- margen proyectado = (lista sin IVA − costo proyectado) ÷ lista
- precio necesario para volver al 15,25 % y % de ajuste
- refs en riesgo (< 8 %) y a pérdida, **con lo que viene**

Toggle "la lista incluye IVA" igual al de Impacto en lista (misma llave de localStorage, así queda
coherente entre pestañas).

### 3.4 KPIs (4, reemplazan los actuales)

| Hoy | Propuesto |
|---|---|
| Referencias costeadas | **Últimas compras vs histórico** (real, se queda) |
| Últimas compras vs histórico | **Lo que viene vs lo que tengo**: Δ % ponderado por unidades, landed proyectado vs costo actual del stock |
| Más subió | **Margen a lista de hoy**: actual → proyectado (ponderado por valor) |
| Más bajó | **Refs en riesgo con lo que viene**: cuántas bajan de 8 % o quedan a pérdida, y la peor |

"Más subió / Más bajó" no se pierden: la tabla se ordena por Δ con click en el encabezado (como en
Cobertura).

### 3.5 Cómo se vería la tabla

```
Referencia  Desemb.  Prom. real  Último real  En camino                   Δ vs último  Costo prom. proy.  Lista s/IVA  Margen hoy → proy.  Ajuste
LIV-40      3        $18.400     $19.100      $20.300 [fábrica · TRM hoy] +6,3%        $19.700            $23.000      17,0% → 14,3%       +1,1%
T077A       2        $31.200     $32.900      $31.800 [aduana]            −3,3%        $32.100            $35.500      7,3% → 9,6%  ⚠      —
```

Fila expandible: todos los lotes, reales y proyectados, con fecha, proveedor, SMM, FOB USD/kg,
prima sobre SMM, TRM (marcada "hoy" si es estimada), landed y Δ — lo que ya muestra hoy, más los
proyectados con chip de etapa.

Línea de supuestos arriba de la tabla:
`Proyectado con TRM hoy $4.1xx para saldos sin girar · nacionalización estimada con la estructura
de 2026-2 ($1.2xx/kg) en los pedidos sin costos cargados`.

### 3.6 Lo que NO cambia

`landedCost`, `importCosting`, `priceImpact`, Escenarios, Impacto en lista por contenedor. La
pestaña sigue siendo **solo lectura**: no escribe en `imports`, `import_costs` ni `import_payments`.

---

## 4. Dónde vive cada cosa

| Capa | Archivo | Cambio |
|---|---|---|
| lib | `src/lib/reorderSuggestion.ts` | `TransitoItem.etapa/pedido`, `QuiebreProducto.llegadas/enFabrica/enEmbarcado`. Opcionales, compatibles hacia atrás. |
| lib (nuevo) | `src/lib/ultimaLlegada.ts` | último contenedor por variante + vendido desde la entrega. Pura, con tests. |
| lib (nuevo) | `src/lib/costoProyectado.ts` | serie real/proyectado por referencia, costo promedio proyectado, margen actual vs proyectado. Pura, con tests. |
| hook | `src/hooks/useReorderSuggestion.ts` | etiqueta la etapa de cada lote, segunda corrida sin fábrica, query de items de los últimos 3 entregados |
| hook | `src/hooks/useReferenceCostHistory.ts` | incluye pedidos abiertos con TRM mixta/hoy y los marca proyectados; recibe TRM hoy |
| hook (nuevo) | `src/hooks/usePrecioProyectado.ts` | junta serie + stock/costo por familia + lista de precios |
| UI | `CoverageAnalysis.tsx`, `ImportPriceAnalysis.tsx` | columnas, KPIs, tooltips, export |
| tests | `reorderSuggestion.test.ts` (+casos), `ultimaLlegada.test.ts`, `costoProyectado.test.ts` | las ~570 existentes siguen verdes sin modificarlas |

Sin cambios en `supabase/`, sin migraciones, sin `Map`/`Set` en datos de queries (arrays planos,
índice armado al usar).

---

## 5. Verificación (lo que vas a revisar en la vista previa)

1. **Cobertura:** para una referencia con lote en fábrica, Embarcado + En fábrica = el "En tránsito"
   de hoy (ni una unidad cambia de lugar). "Solo embarcado" ≤ Cobertura, siempre.
2. La fecha del banner "¿Cuándo montar?" queda **idéntica** antes y después (no se tocó el ancla).
3. **Precios:** un pedido entregado da el mismo landed que hoy. Un pedido abierto sin abonos aparece
   marcado "TRM hoy"; uno con abonos parciales usa la mixta y el número cuadra con el saldo de
   Escenarios.
4. Costo proyectado de una referencia sin nada en camino = su costo actual (el promedio no se mueve
   solo).
5. Claro y oscuro, tabla a ancho de laptop.

---

## 6. Preguntas para vos (decidilas antes de que arranque)

1. **Dos canastas o tres.** Propongo Embarcado (tránsito + aduana) y En fábrica. ¿Querés aduana
   aparte?
2. **Costo actual del stock.** Uso `inventory_variants.avg_cost` (el mundo real) con fallback al
   `-5`. ¿Confiás en ese avg_cost, o preferís el `cost_per_unit` del kardex?
3. **KPIs.** ¿Va el reemplazo de "Más subió / Más bajó" por los dos de margen, o los dejo y agrego
   una segunda fila?
4. **Costos estimados** de un pedido sin costos cargados: ¿estructura del último entregado (COP/kg)
   o un % fijo sobre FOB?
5. **Último llegado:** ¿solo el último contenedor que trajo esa variante (propuesto) o la suma de
   los dos últimos?

---

## 7. Riesgos

- **Doble fuente de verdad.** Cobertura y Precios consumen los mismos hooks que ya usan el banner y
  Escenarios. Si un número difiere entre pestañas, es bug, no decisión.
- **Confundir proyectado con real.** Todo proyectado lleva chip y la línea de supuestos. Un costo
  estimado leído como real es peor que no tenerlo.
- **Ancho de tabla.** Cobertura pasa de 9 a 12 columnas; en pantallas chicas scrollea horizontal
  (ya lo hace). Si molesta, "Último llegado" puede ir a fila expandible.
