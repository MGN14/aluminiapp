# Auditoría del HTML "Calculador de costo MGN" + plan del tablero de Importaciones

**Fecha:** 2026-08-31
**Origen:** `Calculador-Costo-MGN.html` (969 líneas, construido a mano con Claude; el artifact
dejó de poder actualizarse).
**Objetivo de Nico:** *"un módulo para ver abonos, saldos, caja que necesito, historial de
contenedores, y toda la información pasada, presente y a futuro para tomar la mejor decisión
cada día."*

**Veredicto en una línea:** el 70% de lo que hace el HTML **ya está en la app y mejor
resuelto** — no hay que reconstruirlo. Lo que falta no son cálculos: es una **vista
consolidada** (hoy todo vive por pedido, hay que entrar a cada uno) y tres piezas de análisis
que el HTML sí tenía.

---

## 1. Qué hacía el HTML

| # | Función | Dónde vive en el HTML |
|---|---|---|
| 1 | Historial de contenedores y variación frente al anterior | `C1` / `C2` hardcodeados, `renderHist()`, bloque "de dónde sale la diferencia" |
| 2 | Costo en COP (mercancía, flete, arancel, aduana), variación por factor, preparación de IVA | `projCost()`, `IVA_RATE=0.1716`, `aranRate≈4,49%`, `fijos=28M` |
| 3 | Mover la TRM del saldo | `TRM_HOY`, `state2()`, `renderSaldo()` |
| 4 | Abonos con su TRM → variación del saldo USD y su equivalente COP | `ABONOS` en localStorage, `calcAbonoUsd()`, `abonoTotals()` |
| + | Simulador de escenarios (SMM / TRM / flete) | `renderSim()`, `totalSim()` |
| + | Tabla de ~130 referencias con costo unitario y comparación vs anterior (`old`) | `ITEMS`, `renderTable()`, export CSV/XLS |

**Datos que el HTML tiene hardcodeados y hay que verificar contra la app:**
- `C1` (2026-1, cerrado): 28.437,4 kg · SMM 3.585 · mercancía 125.104 USD · flete 5.800 ·
  seguro 110 · arancel $20.641.283 · fijos $28M · **total $507.922.913** · IVA $82.358.717.
- `C2` (2026-2, en curso): SMM 3.520 · prima 814 USD/t · flete 5.700 · seguro 110 ·
  **factura 125.028 USD** (confirmada 24-ago-2026) · plan 28.389 kg / 20.985 unds.
- **Abonos de 2026-1** (los del `<table>`): 18-may 8.671@3.800 · 9-jun 58.000@3.573 ·
  22-jun 28.000@3.415 · Mauricio 20.000@3.400 · 6-jul saldo mercancía 10.432@3.353 ·
  6-jul flete 5.800@3.353 → **131.014 USD, TRM ponderada 3.501, $458.634.846**.
- Nota del propio HTML: el Project doc registraba 2026-1 en $497,0M sin el ajuste del tramo
  del 22-jun; la versión reconciliada es **$507,9M**. Verificar cuál quedó en la app.

⚠️ Los abonos del HTML viven en `localStorage` del navegador de Nico. Si no están cargados en
`import_payments`, se pierden al limpiar el browser. **Migrarlos es lo primero.**

---

## 2. Lo que la app YA tiene (no rehacer)

| Necesidad del HTML | Ya resuelto en la app | Comentario |
|---|---|---|
| Abonos con TRM | `import_payments` (fecha, `amount_usd`, `trm`, `amount_cop` generado, tipo) + `ImportPaymentsSection` | **Mejor que el HTML:** autocompleta fecha y USD desde la transacción bancaria real. El HTML se digita a mano. |
| TRM ponderada del pedido | `useImportItems.trmPonderada` / `trmEfectiva` | Ya calculada, ya usada por el costeo. |
| Saldo USD y su COP a TRM de hoy | `ExchangeDiffPanel` (saldo, TRM hoy, diferencia en cambio, congela al cerrar) | Cubre el punto 3 del HTML. |
| Costos por concepto | `import_costs`: flete, seguro, arancel, `iva_importacion`, nacionalización, gastos bancarios, otro — con moneda, TRM y `base_asignacion` (peso/valor/cantidad) | Más fino que el `fijos=28M` del HTML. |
| Costo COP por referencia (landed) | `ImportCostingSection` + `lib/landedCost` | Prorratea por peso/valor/cantidad. **Ya excluye el IVA de importación del costeable** (es descontable) — el HTML lo mezclaba. |
| Variación de costo por referencia vs contenedores anteriores | `ImportPriceAnalysis` (series por referencia + `DeltaBadge` con %) | Cubre el `old` de `ITEMS`. |
| Peso y unidades reales | `PackingListImport` | El HTML los deriva de la factura (`KG_DERIV`) porque no tenía packing. |
| Liquidación real de aduana | `AduanaRealCosts` | El HTML solo estima. |
| Futuro (cuándo pedir, cobertura) | `ReorderSuggestionCard` + `CoverageAnalysis` | El HTML no lo tiene. |

**Conclusión:** los cuatro puntos que Nico enumeró están cubiertos a nivel de dato y cálculo.
El problema es de **presentación y consolidación**.

---

## 3. El gap real (5 piezas)

### G1 — No hay vista consolidada *(el gap principal)*
Todo el análisis vive **dentro de un pedido**: para comparar 2026-1 con 2026-2 hay que abrir
uno, anotar, abrir el otro. Las tabs actuales son `Pedidos`, `Análisis de precios`, `Cobertura`
— ninguna responde "cómo voy con TODO".

### G2 — Comparativo contenedor vs contenedor con atribución de drivers
`ImportPriceAnalysis` compara **por referencia**. Falta la cabecera: *"2026-2 cuesta $X más que
2026-1, y de esa diferencia $A es SMM, $B es TRM, $C es flete, $D es peso."* Es el bloque más
valioso del HTML y no tiene equivalente.

### G3 — Simulador de escenarios
Mover SMM / TRM / flete y ver el impacto en el costo total y por referencia **antes** de
cerrar el precio. No existe en la app.

### G4 — "Caja que necesito"
`ExchangeDiffPanel` da el saldo de UN pedido. Falta: *"para cerrar todos los saldos abiertos
necesito $X COP a TRM de hoy, y me vencen así en el tiempo."* Es la pregunta de tesorería que
Nico hace todos los días.

### G5 — Preparación de IVA
El HTML usa `IVA_RATE=0.1716` (tasa efectiva **observada** en 2026-1) para anticipar el IVA
del contenedor en curso. La app registra el IVA real cuando llega la liquidación, pero no
proyecta el esperado ni muestra la tasa efectiva histórica.

---

## 4. Plan para Fable

Cinco fases independientes. **F0 primero y sin excusa** (hay datos en riesgo). F1 y F2 dan el
grueso del valor.

### F0 — Rescatar los datos del HTML · ~medio día
1. Verificar contra la app: ¿existen los pedidos **2026-1** y **2026-2**? ¿Con qué totales?
   Comparar contra los números de §1 (ojo con $497,0M vs $507,9M).
2. Cargar los **6 abonos de 2026-1** en `import_payments` si faltan (fecha, USD, TRM del
   cuadro). Idem los de 2026-2 que Nico tenga en el navegador.
3. Cargar los `import_costs` de 2026-1: arancel $20.641.283 y los fijos $28M **desglosados**
   por concepto (no como un bulto).
4. Confirmar el packing real de 2026-2 (el HTML deriva 28,85 t de la factura porque no lo
   tenía; si ya llegó, cargarlo con `PackingListImport`).

**Verificación:** la TRM ponderada de 2026-1 que calcule la app debe dar **3.501** y el total
de abonos **131.014 USD / $458.634.846**. Si no cuadra, el error está en los datos, no en la
fórmula — resolverlo antes de seguir.

### F1 — Tab "Tablero" (consolidado) · ~2 días · mata G1 y G4
Una tab nueva en `/importaciones` que responda de un vistazo:
- **Fila de KPIs:** saldo USD abierto (todos los pedidos), su COP a TRM de hoy, próximo
  vencimiento, y "caja que necesito este mes".
- **Timeline de pedidos** por estado (producción / tránsito / aduana / entregado), con ETA y
  saldo de cada uno. Reusar `useImports` y las fechas que ya existen.
- **Curva de abonos**: USD comprado por fecha y la TRM de cada uno contra la TRM del día —
  se ve si Nico compró bien o mal. Datos de `import_payments`, cero cálculo nuevo.
- **Caja proyectada**: los saldos pendientes ordenados por fecha esperada de giro, a TRM de
  hoy y a TRM +/− escenarios. Es G4.

Reglas: nada de recalcular lo que ya está en `useImportItems` / `useImportPayments`;
la tab consume, no duplica.

### F2 — Comparador de contenedores con drivers · ~1,5 días · mata G2
Selector de dos pedidos → tabla de descomposición. Fórmula del HTML (`renderHist` + drivers),
generalizada a cualquier par:

```
Δ total = Δ mercancía + Δ flete + Δ arancel + Δ fijos + Δ TRM
  Δ mercancía  = (smm₂+prima₂)·tons₂ − (smm₁+prima₁)·tons₁   → separar efecto PRECIO de efecto PESO
  Δ TRM        = usd_total₂ · (trm_pond₂ − trm_pond₁)
```
Mostrar cada driver en COP y en %, con el signo claro. Reusar `trmPonderada` y los
`import_costs` por tipo — todo el input ya está en la base.

**Verificación:** con 2026-1 vs 2026-2 los drivers deben sumar exactamente la diferencia de
totales. Test unitario con los números de §1.

### F3 — Simulador de escenarios · ~1 día · mata G3
Sobre el pedido abierto: sliders de SMM (USD/t), TRM y flete → recalcula total COP y landed
por referencia en vivo. **Reusar `lib/landedCost` tal cual**, pasándole los valores simulados;
si hay que tocar esa lib, es señal de estar duplicando. Marcar visualmente que es simulación
(no persiste). Respetar el piso FOB (`PISO_FOB_ALUMINIO_USD_KG`).

### F4 — Preparación de IVA · ~medio día · mata G5
- Tasa efectiva de IVA **observada** por contenedor cerrado (IVA real / base gravable) y su
  promedio histórico — el `0.1716` del HTML, pero calculado, no hardcodeado.
- IVA **esperado** del contenedor en curso = base estimada × tasa efectiva histórica, marcado
  como estimado hasta que llegue la liquidación.
- Enlazar con el calendario DIAN que ya existe (`useUpcomingObligations`) para que el IVA de
  importación aparezca como obligación próxima.

---

## 5. Lo que NO hay que portar del HTML

- **La tabla de ~130 `ITEMS` hardcodeada.** Ya vive en `import_items` + `landedCost`. Portarla
  sería duplicar la fuente de verdad — justo lo que Nico pidió evitar.
- **`localStorage`.** Todo va a la base (y encima el cache persistido de la app no tolera
  estructuras raras — ver `feedback_no_maps_en_queries`).
- **`fijos = 28M` como un bulto.** La app ya desglosa por concepto; mantener el desglose.
- **El precio de venta sugerido (`t` en ITEMS).** Eso pertenece al ciclo comercial /
  cotizaciones, no al módulo de importaciones. Si Nico lo quiere, va como feature aparte
  alimentando `aluminum_catalog`.

## 6. Riesgos

- **Doble fuente de verdad.** El mayor riesgo es que el tablero recalcule por su cuenta y
  empiece a diferir de la vista por pedido. Regla: la tab consume los hooks existentes.
- **Números del HTML sin conciliar.** El propio HTML admite dos versiones de 2026-1 ($497,0M
  vs $507,9M). No construir encima sin cerrar eso en F0.
- **Peso derivado vs real.** 2026-2 usa peso derivado de la factura. Cuando entre el packing
  real, todos los costos unitarios se mueven — el tablero debe mostrar de dónde viene el peso
  (derivado / packing) como ya hace el motor de reorden con `fuente: medido | default`.
