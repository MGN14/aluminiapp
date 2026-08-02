# Auditoría del motor "¿cuándo montar el próximo pedido?" — AluminIA

**Fecha:** 2026-08-02 · **Estado:** un bug crítico encontrado y corregido; quedan preguntas abiertas al final.
**Para:** cualquier IA o persona que quiera revisar, cuestionar o mejorar este cálculo.

---

## 0. Contexto de negocio (necesario para juzgar el modelo)

AluminIA es la app interna de una importadora/distribuidora de **perfilería de aluminio** en Colombia.

- Compra contenedores completos a un proveedor en China (Shandong). Cada contenedor son ~$120–130k USD, ~28 toneladas, ~100–120 referencias distintas.
- El ciclo desde que se monta el pedido hasta que la mercancía está vendible en bodega es de **~85 días** (producción ~32d + tránsito ~36d + nacionalización ~17d).
- Vende a talleres y distribuidores locales. La salida real se registra como **remisión** (nota de despacho), no como factura: la factura va a Siigo/DIAN después y con otro ritmo.
- Las referencias tienen **variantes de color** (mate, blanco `-2`, negro `-3`, crudo `-0`). Siigo solo maneja la referencia "total" (`-5`), sin discriminar color. El control interno real es por variante.

**La pregunta que el módulo debe contestar:** *¿en qué fecha tengo que montar el próximo contenedor para no quedarme sin mercancía?*

Decisión asociada, distinta y explícita del dueño: **"montar pedido" ≠ "mandar a traer"**. Un contenedor ya fabricado y retenido en fábrica se manda a traer (repone en ~53 días); montar uno nuevo tarda 85+. Son dos alertas y dos cálculos.

---

## 1. Arquitectura de datos: qué alimenta qué

Hay **dos mundos de inventario** y confundirlos es la fuente histórica de casi todos los bugs.

| Mundo | Tabla | Qué es | Se mueve con |
|---|---|---|---|
| **Siigo / declarado** | `inventory_products` (referencias `-5`) | Lo que el contador y la DIAN ven | Facturas de venta/compra, sync de Siigo. **Nunca** por remisión (regla explícita del dueño) |
| **Interno / real** | `inventory_variants` + ledger `inventory_variant_movements` | El stock físico real, por color | Entrada: packing list del contenedor al entregarse. Salida: cada remisión |

**Invariante del mundo interno** (`computeVariantDesglose` en `src/lib/variantInventory.ts`):

```
stock = ancla + Σ entradas de contenedor − Σ remisiones   [solo movimientos POSTERIORES al ancla]
```

Donde **ancla** = el conteo físico más reciente (maestra subida o ajuste manual) o, si la referencia nunca se contó, la fecha de arribo del contenedor que la creó.

### Fuentes que consume el motor de reorden (`src/hooks/useReorderSuggestion.ts`)

| Dato | Origen | Notas |
|---|---|---|
| Stock por variante | `inventory_variants.stock` | Fallback al `-5` si la maestra no está sembrada |
| Demanda (ventas) | `remision_items` JOIN `remisiones` (tipo venta, últimos 90d) | Referencia **tal como se despachó**, con sufijo de color |
| Mercancía en camino | `import_items` de pedidos abiertos (packing si existe; si no, proforma) | Se le aplica el sufijo de color desde la columna `color` |
| Fechas / lead time | `imports` + `import_estado_history` | Etapas medidas, no estimadas, cuando hay datos |
| Historia para censura | `inventory_variant_movements` | **← esto se cambió hoy, ver §4** |

---

## 2. El cálculo, paso a paso

### 2.1 Lead time segmentado (`estimateLeadTime`)

No se exige un ciclo completo. Cada etapa se mide por separado con las fechas reales de **todos** los pedidos, incluso los que van por la mitad:

```
producción      = entrada a 'produccion'  → 'listo_fabrica' (o 'transito')
tránsito        = entrada a 'transito'    → 'aduana'
nacionalización = entrada a 'aduana'      → 'entregado'
```

Defaults mientras no haya dato: 35 / 40 / 10 días. Duraciones > 365d se descartan como basura.
**Nota de diseño:** la retención en fábrica (`listo_fabrica` → embarque) **no** cuenta al lead time — es una decisión comercial, no tiempo de abastecimiento.

Valores reales hoy: **producción 32d · tránsito 36d · nacionalización 17d = 85d**.

### 2.2 Consumo diario por variante (`buildVariantPrimitives` en `coverageVariants.ts`)

```
consumo_diario(variante) = (unidades despachadas en 90d / 90) × factorDemanda(familia)
```

`factorDemanda` combina tres señales, todas calculadas a nivel **familia** (todos los colores juntos):

| Señal | Qué mide | Cota |
|---|---|---|
| **Censura** | "vendí en solo 21 de 90 días porque estuve agotado → mi demanda real es 90/21 veces mayor" | 1 – 5 (*tope agregado hoy*) |
| **Tendencia 30d** | tasa de los últimos 30 días ÷ tasa de la ventana | 0,5 – 2,0 |
| **Estacionalidad** | promedio del mes objetivo ÷ promedio general, ponderado por madurez (meses/12) | 0,6 – 1,8 |

Factor combinado acotado a **6** (antes: sin tope).

### 2.3 Proyección del quiebre (`projectQuiebres`)

Por cada variante se camina la línea de tiempo:

1. Se arranca del stock actual y se consume a tasa constante.
2. Cada llegada en tránsito **repone**, aunque caiga después del agote (lo que está en el agua siempre cuenta).
3. Si el stock toca 0 antes de que llegue una reposición ya en camino → se marca **hueco corto** (alerta operativa, no dispara pedido).
4. La **fecha de quiebre teórica** es el agote final, después de sumar todo el pipeline.

### 2.4 La fecha (`computeReorderSuggestion`)

```
quiebre grupal = caminar los quiebres teóricos en orden de fecha, acumulando
                 consumo diario, hasta juntar ≥20% del consumo total Y ≥3 referencias
fecha límite   = quiebre grupal − lead time (85d) − colchón (15d)
                 (nunca en el pasado: si da antes de hoy, la respuesta es HOY)
```

**Regla dura, aprendida a los golpes (§3):** el ancla del quiebre grupal se calcula sobre **todas** las referencias con consumo. Etiquetas como "faltante" o "alcanzable" son informativas y **nunca** filtran el ancla.

Si el quiebre grupal cae a más de 400 días → "cobertura sobrada", sin fecha (evita "montá pedido en 2046").

### 2.5 Cuánto pedir (`suggestOrderQty`)

```
sugerido = consumo_diario × horizonte − (stock + en tránsito)
horizonte = lead time (85) + ciclo entre pedidos (34) + colchón (15) = 134 días
```

---

## 3. Historial de bugs — el patrón importa más que los casos

Todos ocurrieron el **mismo día** (2026-08-02), en cadena, y todos comparten una raíz: **filtrar o mezclar poblaciones de datos**.

| # | Síntoma | Causa real |
|---|---|---|
| 1 | "Montá pedido en 2036" con el grueso agotado | Las refs ya quebradas se excluían del ancla por "inalcanzables"; el grupal se calculaba solo con las sobrevivientes lentas |
| 2 | "Montá pedido HOY" con 40k unidades en camino | Al corregir (1), el gate disparaba con refs que **sí** tenían reposición en camino |
| 3 | "Montá HOY" otra vez | Al corregir (2) con "faltantes secos", volvió a partirse la masa de consumo |
| 4 | **Consumos inflados ×36** (§4) | La censura se calculaba con datos del mundo Siigo mientras la demanda venía del mundo interno |

**Conclusión metodológica:** cada filtro que se le agregó al ancla movió la fecha a un extremo. La regla final es **no filtrar el ancla**; corregir la *calidad del insumo*, no la selección de la muestra.

---

## 4. 🔴 EL BUG PRINCIPAL (encontrado y corregido hoy)

### Síntoma

En la pestaña Cobertura, con datos de producción:

| Referencia | Demanda que mostraba | Demanda real (90d) | Inflado |
|---|---|---|---|
| GL4102 mate | **872,3 und/día** | ~24 und/día | **×36** |
| COL14-0 | 869,0 und/día | — | ~×36 |
| MN-46 | 357,0 und/día | — | — |
| T077A | 257,8 und/día | — | — |

Consecuencia: **136 de 162 referencias** clasificadas como "faltante real", fecha límite = hoy, y una recomendación de montar pedido que el dueño sabía falsa — con dos contenedores ya comprados en camino.

### Causa raíz

La corrección por censura se calculaba así (`useReorderSuggestion.ts`, versión anterior):

```ts
// stockActual = suma de inventory_products.stock_physical   ← mundo SIIGO
// movimientos = inventory_movements                          ← mundo SIIGO
const demanda = computeFamilyDemand({ stockActual, movimientos, ... });
const censura = demanda.consumoDiario / demanda.consumoDiarioSimple;  // sin tope
// …y ese factor multiplicaba la demanda que venía de remision_items ← mundo INTERNO
```

El mundo Siigo **no registra salidas por remisión** (regla dura del negocio) pero **sí registra entradas** de contenedor. Al reconstruir el stock hacia atrás (`stock(d-1) = stock(d) + salidas − entradas`), con salidas ≈ 0 y entradas grandes, el stock se hacía negativo → se clampeaba a 0 → **casi todos los días quedaban marcados "sin stock"** → `diasConStock ≈ 2` de 90 → censura ×36.

En una frase: **se medía "cuántos días hubo stock" en una tabla que no ve las ventas, y se aplicaba a ventas que viven en otra tabla.**

### Corrección aplicada

1. La censura ahora se calcula con el **ledger por variante** (`inventory_variant_movements`: entradas de contenedor + salidas de remisión) agrupado por familia, y con el **stock por variante**. Misma población que la demanda.
2. Los movimientos `inicial` y `ajuste` se excluyen: son anclas de conteo, no flujo real.
3. La censura queda **acotada a ×5** y el factor combinado a **×6** (el resto de los índices ya tenían cotas; este no).
4. Fallback al comportamiento anterior si el ledger de variantes está vacío (instalación sin sembrar).

---

## 5. Estado actual y qué falta verificar

**Datos de producción al momento de la auditoría:**
- 162 variantes activas · ~11.400 unidades · $216M a costo landed.
- 2 contenedores abiertos: uno **listo en fábrica** (llega ≈24 sep si se manda a traer ya) y uno **en producción** (≈29 sep). Ambos con proforma cargada (~230 líneas de tránsito).
- Lead time medido: 85d. Ciclo entre pedidos: 34d.

**Pendiente de validar tras el fix** (requiere recargar con datos reales):
- Que la demanda por referencia baje a valores creíbles (GL4102 debería quedar en el orden de 24–120 und/día según censura real).
- Que el número de "faltantes reales" caiga drásticamente desde 136.
- Que la fecha límite deje de ser "hoy" y pase a una fecha futura coherente con el corte de inventario.

---

## 6. Preguntas abiertas / dónde puede seguir fallando

Para quien quiera revisar esto con ojo crítico:

1. **¿La censura debería existir?** Es la corrección más agresiva del modelo y la que más ruido metió. Alternativa: medir demanda solo sobre días con stock **por variante** (no por familia) o eliminarla y usar consumo plano con un colchón mayor.

2. **Granularidad mezclada.** La demanda se mide por variante (color), pero censura/tendencia/estacionalidad se calculan por familia y se aplican a todas sus variantes por igual. Un color que rota y otro que no comparten factor.

3. **Ventana de 90 días con historia de ~3 meses.** La estacionalidad está al 25% de madurez (3/12 meses). ¿Vale la pena tenerla activa o agrega ruido?

4. **`enTransito` y fechas estimadas.** La llegada de un pedido "en producción" sin ETA se estima con el lead time promedio. Si ese pedido se retiene en fábrica (caso real y frecuente), la proyección queda optimista. Hoy se mitiga con la alerta "mandá a traer", pero el cálculo de cobertura no lo penaliza.

5. **Umbrales elegidos a mano:** 3 referencias mínimo, 20% de la masa de consumo, colchón de 15 días, horizonte de 400 días. Ninguno está calibrado contra resultados históricos (no hay suficiente historia todavía).

6. **Referencias sin cruzar.** Hoy hay 3 (`MGN1103`, `B`, `MGN91`) que aparecen en remisiones pero no en inventario — se excluyen del análisis y se listan aparte. Son errores de digitación en la remisión, pero mientras existan, esa demanda no se cuenta.

7. **El conteo físico como ancla.** Se acaba de agregar un flujo de "cierre de inventario" (borrador → revisión de diferencias → confirmación del admin) que re-ancla el stock **sin borrar el ledger**, justamente para que este motor no pierda la historia de rotación. Falta ver cómo se comporta el modelo después de un cierre real.

---

## 7. Archivos relevantes

```
src/lib/reorderSuggestion.ts    → motor: lead time, proyección de quiebre, fecha límite
src/lib/coverageVariants.ts     → consumo y stock por variante de color; re-anclaje del tránsito
src/lib/demandModel.ts          → censura, tendencia 30d, estacionalidad anual
src/hooks/useReorderSuggestion.ts → orquestación: qué tabla alimenta qué (aquí estaba el bug)
src/lib/variantInventory.ts     → ledger por variante, invariante del stock, conciliación
src/components/imports/ReorderSuggestionCard.tsx → presentación de las dos decisiones
src/lib/reorderSuggestion.test.ts → 26 tests, incluidos los casos de regresión de §3
```
