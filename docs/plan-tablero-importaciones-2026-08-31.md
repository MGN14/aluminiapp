# Plan — pestaña "Escenarios" en Importaciones

**Fecha:** 2026-08-31 · **v2** (corregida con las 4 observaciones de Nico)
**Para:** que lo implemente Fable.

> **Cambios respecto de la v1** — los cuatro puntos que Nico corrigió:
> 1. Los **escenarios editables (TRM · SMM · flete)** pasan de última prioridad a **F1, lo primero**. Y deben cubrir DOS contenedores: el vigente y el siguiente.
> 2. El IVA es **19% sobre (base + arancel)**, con la base formada por lo ya pagado a la TRM de cada abono **+ el saldo a TRM vigente**. La v1 proponía una "tasa efectiva observada" — estaba mal.
> 3. **Se elimina el F0 de cargar datos de 2026-1.** Esa información ya está en la app y ya fue corregida; volver a meterla es riesgo de dañar datos buenos sin ganancia.
> 4. La pestaña va **aparte** porque muestra **lo real**, no solo lo que entra por contabilidad.

---

## 1. Qué ya existe (verificado en el código, no rehacer)

La auditoría del HTML `Calculador-Costo-MGN` contra la app dio que casi todo el cálculo ya
está resuelto — y en dos puntos, mejor que en el HTML:

| Pieza | Dónde | Nota |
|---|---|---|
| Abonos con su TRM | `import_payments` + `ImportPaymentsSection` | Autocompleta desde la transacción bancaria real; el HTML se digita a mano. |
| TRM ponderada | `useImportItems.trmPonderada` / `trmEfectiva` | Ya alimenta el costeo. |
| Saldo USD y diferencia en cambio | `ExchangeDiffPanel` | Congela al cerrar el pedido. |
| **Arancel e IVA** | `lib/importCosting.computeImportBreakdown` | **Ya calcula lo que pide Nico:** `arancel = cifAduana × arancel%` y `iva = (cifAduana + arancel) × iva%`. Aplica **piso FOB** (`PISO_FOB_ALUMINIO_USD_KG`) y prefiere los valores REALES cuando la liquidación ya está cargada. |
| **Comparativo entre contenedores** | `lib/importComparison` (376 líneas, con tests) | Compara último entregado · en curso · **"si montara uno hoy"**. `columnaHoy()` usa el último entregado como molde y le cambia solo dólar y aluminio, dejando los `supuestos` declarados. |
| Landed cost por referencia | `ImportCostingSection` + `lib/landedCost` | Excluye el IVA de importación del costeable (es descontable) — el HTML lo mezclaba. |
| Costo por referencia vs anteriores | `ImportPriceAnalysis` | Cubre el `old` de los ITEMS del HTML. |
| Peso y unidades reales | `PackingListImport` | El HTML deriva el peso de la factura porque no lo tenía. |

**Consecuencia:** F1 y F2 de abajo **no construyen motores nuevos** — hacen editable y visible
lo que `importComparison` + `importCosting` ya calculan y ya están testeados.

---

## 2. Lo que falta

| # | Falta | Por qué importa |
|---|---|---|
| **G1** | Que los supuestos del comparativo sean **editables a mano** (TRM, SMM, flete) | Hoy `columnaHoy()` los toma del mercado automáticamente. Nico necesita mover los tres y ver el efecto — es su decisión diaria. |
| **G2** | Escenarios sobre **dos** contenedores a la vez: el **vigente** (¿cuánto me falta pagar y a qué me expone el dólar?) y el **siguiente** (¿cuánto me costaría montarlo hoy?) | `columnaHoy` ya hace el "siguiente"; el vigente con saldo abierto no está cubierto con supuestos móviles. |
| **G3** | **TRM mixta** en la base de impuestos: lo ya pagado a la TRM real de cada abono **+** el saldo a TRM vigente | Hoy `computeImportBreakdown` recibe **una sola** TRM para todo. Con abonos a 3.800 y 3.353, valorar todo a una TRM única desvía la base del IVA y del arancel. |
| **G4** | **Caja que necesito**: los saldos abiertos de todos los pedidos, a TRM de hoy y bajo escenarios | Existe por pedido; falta el consolidado y su proyección en el tiempo. |

---

## 3. Regla de oro de la pestaña: es **lo real**, no la contabilidad

Decisión de Nico. La pestaña vive aparte porque responde una pregunta distinta a la del
registro contable:

- **Contabilidad** = lo causado, lo facturado, lo que ya pasó por un documento.
- **Esta pestaña** = lo real para decidir hoy: el saldo que todavía no se giró, el contenedor
  que todavía no se pidió, el dólar que todavía no se movió.

Por lo tanto:

1. **NO escribe nunca** en `import_costs`, `import_payments`, `transactions` ni `imports`.
   Es solo lectura + cálculo en memoria.
2. **No crea pedidos.** El "contenedor siguiente" es una simulación con nombre, no una fila
   en `imports`. Si Nico decide montarlo, usa el flujo normal de Nueva importación.
3. **Todo supuesto se declara en pantalla** (de dónde salió cada número y si es real, medido
   o asumido) — el patrón que `importComparison.supuestos` ya usa.
4. Los escenarios **se pueden guardar** para volver a mirarlos, pero en su propia tabla
   (`import_scenarios`), nunca mezclados con los datos contables.

---

## 4. Plan

### F1 — Escenarios editables sobre vigente + siguiente · ~2 días · mata G1 y G2

Pestaña nueva **"Escenarios"** en `/importaciones`.

**Tres controles arriba, siempre visibles:** `TRM`, `SMM (USD/ton)`, `Flete (USD)`. Arrancan
con los valores vigentes (TRM de hoy, último SMM cerrado, flete del último pedido) y un botón
"volver a hoy".

**Dos columnas, mismo motor:**

| | Contenedor **vigente** | Contenedor **siguiente** |
|---|---|---|
| Qué es | El pedido abierto con saldo | Simulación: "si lo monto hoy" |
| Mercancía | La factura real ya confirmada | SMM simulado × toneladas estimadas |
| Lo ya pagado | Abonos reales, cada uno a **su** TRM | — |
| Saldo | `total − pagado`, valorado a la **TRM simulada** | Todo el monto a la TRM simulada |
| Salida | Cuánto COP necesito para cerrarlo · arancel · IVA · costo/kg | Costo total · costo/kg · cuándo llegaría |

Implementación: extender `columnaHoy()` / `buildComparativo()` de `lib/importComparison` para
aceptar **overrides opcionales** de trm/smm/flete. Si no se pasan, se comporta exactamente
como hoy (los tests existentes deben seguir pasando sin tocarlos).

**Verificación:** con los overrides en los valores actuales, la columna "vigente" debe dar el
mismo saldo que muestra hoy `ExchangeDiffPanel` en ese pedido. Si difiere, hay doble fuente de
verdad.

### F2 — TRM mixta en la base de impuestos · ~1 día · mata G3

Hoy `computeImportBreakdown({ trm })` valora todo a una sola TRM. Cambio:

```
base_cop = Σ (abono_usd × trm_de_ese_abono)        ← lo ya pagado, TRM real e inmutable
         + (saldo_usd × trm_vigente_o_simulada)     ← lo que falta, expuesto al dólar
arancel  = base_aduana × arancel%                   (con piso FOB, como ya hace)
iva      = (base_aduana + arancel) × 19%
```

- Agregar a `computeImportBreakdown` un parámetro opcional `trmMixta?: { pagadoCop, saldoUsd }`.
  Sin él, el comportamiento actual no cambia (los tests siguen pasando).
- El IVA sigue **excluido del costeable** en `landedCost` — no tocar eso.
- Mostrar en pantalla los dos pedazos por separado: *"ya pagaste $X a TRM promedio 3.501; te
  faltan USD Y que a TRM de hoy son $Z"*. Es la lectura que Nico hace todos los días.

**Verificación:** un pedido totalmente pagado debe dar exactamente lo mismo que hoy (saldo 0 →
la TRM del saldo no aplica). Un pedido sin abonos, también (todo va a TRM vigente). Los tests
tienen que cubrir los dos extremos y un caso mixto.

### F3 — Caja que necesito (consolidado) · ~1 día · mata G4

Bloque en la misma pestaña: todos los pedidos con saldo abierto, ordenados por fecha esperada
de giro, con el COP necesario a TRM de hoy y bajo la TRM simulada. Total abajo: *"para cerrar
todo lo abierto necesito $X"*. Consume `useImports` + `useImportPayments`; nada nuevo que
calcular.

### F4 — Guardar escenarios (opcional) · ~medio día

Tabla `import_scenarios` (nombre, supuestos, fecha, notas) para volver a un escenario guardado
y compararlo con lo que efectivamente pasó. Es el enganche natural con el **libro de aciertos**
(`prediction_log`): un escenario guardado es una predicción y puede confrontarse con la
realidad.

---

## 5. Lo que NO se hace

- **No se cargan datos de 2026-1** (ni de ningún contenedor histórico) desde el HTML. Ya están
  en la app y ya fueron corregidos. El HTML queda como referencia de lectura, nada más.
- **No se porta la tabla de ~130 ITEMS.** Vive en `import_items` + `landedCost`.
- **No se usa `localStorage`.** Todo en base o en memoria.
- **No se toca `landedCost`** para meter simulación: se le pasan valores simulados, no se le
  agrega lógica de escenarios.
- **No se porta la "tasa efectiva de IVA" del HTML (17,16%).** Es 19% sobre base + arancel, que
  es lo que la app ya hace bien.

## 6. Riesgos

- **Doble fuente de verdad.** Si la pestaña recalcula por su cuenta, va a empezar a diferir de
  la vista por pedido. Regla: consume `importComparison`, `importCosting`, `useImportPayments`.
- **Confundir simulado con real.** Todo número simulado debe estar visualmente marcado. Un
  escenario que se lee como dato contable es peor que no tenerlo.
- **Romper los tests de `importComparison`.** Los overrides van como opcionales; si un test
  existente hay que modificarlo, es señal de que se cambió el comportamiento por defecto.
