# Auditoría — Módulo de Cobranza (2026-08-12)

Ruta: `/reportes/cuentas-por-cobrar` → `src/components/reports/AccountsReceivableReport.tsx`

## Diagnóstico en una línea

**El módulo tiene dos verdades y ninguna es la realidad completa.**

- La **pantalla** (tarjetas + detalle por cliente) calcula cartera desde el banco conciliado
  (`src/lib/clientReceivables.ts`).
- El **cerebro** (Score IA, reporte del lunes, mensaje sugerido al cliente, link de pago Wompi)
  calcula desde `invoices.balance_pending`, un campo de Siigo que **nunca se descuenta cuando
  conciliás un pago**.
- Y la pantalla, además, es una foto **por año calendario** — cuando la cartera es un saldo vivo
  que cruza años.

Por eso "difiere mucho de la realidad": no es un bug puntual, son tres fuentes de verdad
distintas conviviendo en una sola pantalla.

---

## Hallazgos

### H1 — CRÍTICO · El Score IA, el email del lunes, los mensajes de cobro y el link Wompi usan un saldo que nunca baja

El comentario que ya está en el propio código lo dice literal:

> `supabase/functions/mcp/index.ts:431` — *"`invoices.balance_pending` NO se mantiene al día
> (queda ≈ al total facturado)"*

`balance_pending` solo lo escriben `siigo-sync-invoices/index.ts:653` (con el balance que dice
Siigo, o el total si no viene) y `receive-purchase-invoice`. **Ninguna conciliación en la app lo
toca.** Y sin embargo lo leen:

| Superficie | Archivo | Consecuencia |
|---|---|---|
| Score IA (badge del Aging) | `score-collection-clients/index.ts:100-106` | El score está calculado sobre una deuda que ya cobraste |
| Reporte semanal (lunes) | `weekly-collection-report/index.ts:128-134` | El email te da otro total que la pantalla |
| Mensaje de cobro sugerido | `draft-collection-message/index.ts:62-65,81` | **Le pedís al cliente plata que ya pagó** |
| Link de pago Wompi | `create-invoice-payment-link/index.ts:91-97` | El link le cobra ≈ la factura completa otra vez |
| Balance General (CxC) | `src/hooks/useBalanceSheet.ts:34,90` | Balance ≠ Cobranza |

Los dos últimos son los graves: son las únicas superficies que **salen hacia el cliente**.
`create-invoice-payment-link` incluso valida `amount_override > balance_pending` — o sea usa el
valor inflado como techo permitido.

MCP (`mcp/index.ts:429-643`) sí reimplementó la lógica buena en Deno. Existe la solución, solo que
copiada en un solo lugar.

---

### H2 — CRÍTICO · La cartera se calcula por año calendario, pero la deuda es multi-año

`src/lib/clientReceivables.ts:143-176`: las facturas se filtran por `issue_date` entre el 1-ene y
el 31-dic del año elegido, y las transacciones por `date` en la misma ventana.

- Factura de nov-2025 sin pagar → **no existe** en la vista 2026.
- Pago en feb-2026 de una factura de 2025 → entra como `cobrado_banco` del 2026 y, vía el FIFO
  (`clientReceivables.ts:459`), **le baja el saldo a facturas de 2026 que sí están vivas**.
- En la vista 2025 pasa lo inverso: el pago quedó fuera de la ventana, así que la factura de 2025
  sigue figurando pendiente para siempre.

Ningún año muestra la cartera real. El 2026 la subestima por un lado y la maquilla por el otro.

---

### H3 — CRÍTICO · El saldo inicial no tiene fecha y se suma en todos los años

`initial_state_details` (migración `20260306194304`) **no tiene columna de periodo**, y
`clientReceivables.ts:178` la lee sin ningún filtro de año.

El mismo saldo de apertura se suma en 2025, en 2026 y en 2027. Combinado con H2: en la vista 2026
estás contando como deuda viva un saldo de apertura que probablemente cobraste en 2025 — y ese
cobro quedó fuera de la ventana, así que nada lo cancela.

Es exactamente el problema que la **Fase 2 de Cierre de Año** (roll-forward de apertura
versionada) iba a resolver. Sigue pendiente, y la cartera es quien lo paga.

---

### H4 — ALTO · La tarjeta "Total cartera" y la fila TOTAL del Aging no dan lo mismo

Dos números en la misma pantalla, calculados distinto:

- KPI: `Σ saldo_neto > 0` → `AccountsReceivableReport.tsx:93`
- Aging: `Σ effective_pending` por factura → `agingBuckets.ts:111`

Cuadran solo mientras `cobrado + anticipos ≥ cxc_inicial`. Cuando no:
`clientReceivables.ts:458` **reserva el saldo inicial del pool FIFO** (para que el crédito no
"pague" facturas nuevas dejando viva la deuda vieja), pero el Aging solo recorre facturas — así que
ese saldo inicial no cae en ningún bucket y **desaparece del aging**. El fallback de
`agingBuckets.ts:118` solo cubre el caso "cliente sin ninguna factura pendiente".

Doble daño: los totales no cuadran, y **la deuda más vieja no aparece en el bucket +90**, que es
justo el único que importa para cobrar.

---

### H5 — ALTO · Sin paginación: pasando 1.000 filas la cartera se infla sola

`clientReceivables.ts:155-179` dispara 7 queries sin un solo `.range()`. El API corta en 1.000
filas por defecto y devuelve 200 OK — sin error, sin aviso.

El codebase ya sabe de esto y lo maneja bien en otros lados
(`useProfitability.ts:65` y `variantInventory.ts:222`, con `const PAGE = 1000` y loop).

La que revienta primero es `invoice_transaction_matches` (línea 177): se trae **sin ningún
filtro**, todos los años, toda la historia. Si se corta, los pagos vinculados manualmente dejan de
atribuirse → cartera para arriba, en silencio.

---

### H6 — ALTO · Cualquier ingreso con beneficiario cuenta como cobro de cartera

`clientReceivables.ts:170-176` filtra `type='ingreso'` y nada más. No mira `movement_nature` ni
categoría. El resto de la app sí lo hace: `useFinancialActuals.ts:79`, `useBreakeven.ts:90`
(`isOperativo(movement_nature)`), `txBucket.ts:79` (traspasos aparte).

Entonces un traslado entre cuentas propias, un desembolso de crédito o una devolución de un
tercero que también es cliente → **le baja la cartera a ese cliente**.

---

### H7 — ALTO · Los cobros en efectivo no bajan la cartera de nadie

`cash_movements` **tiene** `responsible_id` (migración `20260428220000`), o sea el dato existe y
está estructurado. `clientReceivables.ts` nunca lo lee.

Lo único que hay es `AccountsReceivableReport.tsx:94`:
`carteraReal = totalPending − TODO el efectivo del año`, solo en vista Gerencial y a nivel global.
Resta efectivo que puede no ser de clientes, y no le baja el saldo a nadie en particular.

**En la vista normal — la que usás vos — el cliente que te pagó en efectivo sigue debiendo.**

---

### H8 — MEDIO · Vinculás un pago y el Aging de arriba no se entera

La pantalla corre `calculateAllClientReceivables()` **dos veces**, con dos claves de cache
distintas:

- `['accounts-receivable-by-client', user, year]` → `AccountsReceivableReport.tsx:67`
- `['collection-data', user, year]` → `useCollectionData.ts:60`

`VincularPagoModal` solo dispara el `refetch()` de la primera
(`AccountsReceivableReport.tsx:369`). El Aging Report queda con el número viejo hasta que
recargues la página.

El patrón correcto ya existe: `useBankInvoiceMatches.ts:154-156` invalida las dos claves. Solo
falta aplicarlo en el resto. Costo extra: todo el dataset se descarga y procesa dos veces.

---

### H9 — MEDIO · Las promesas de pago no vuelven al módulo

- "Acordar cobro" escribe `expected_payments` vía `AcordarPagoModal.tsx:33` — y ni el Aging ni el
  detalle por cliente las muestran nunca.
- Un touchpoint con outcome `prometio_pago` **no crea la promesa**. El propio SQL lo admite:
  `collection_module.sql:35` → *"(crear expected_payment aparte)"*.

Registrás "me prometió pagar el 15" en dos lados que no se hablan, y ninguno alimenta el forecast
de caja.

---

### H10 — MEDIO · Notas crédito parciales inflan el saldo

`clientReceivables.ts:169` incluye las `void_type='partial'` (correcto) pero después usa
`total_amount` completo. La columna `voided_amount` existe (migración `20260514120000`) y **no se
resta nunca**. La factura queda pendiente por el bruto aunque la NC ya bajó una parte.

---

### H11 — MEDIO · El scorer y la pantalla agrupan clientes distinto

- La pantalla canonicaliza por `responsible_aliases` (`clientReceivables.ts:210-215`).
- `score-collection-clients/index.ts:125` agrupa por `responsible_id` crudo, o por nombre en
  minúscula sin normalizar (sin quitar S.A.S. / Ltda. / tildes, que es lo que hace
  `normalizeName()` en `clientReceivables.ts:30`).

Un cliente unificado por alias en la pantalla se queda **sin badge de score**. Y el scorer excluye
`voided_at IS NOT NULL` (`:106`) mientras la pantalla incluye las parciales → universos de
facturas distintos sobre el mismo cliente.

---

### H12 — BAJO · Deuda técnica que muerde

- `score-collection-clients/index.ts:235`: `onConflict: "user_id"` no matchea el índice único real
  (`collection_module.sql:115-116`, que es sobre `user_id + COALESCE(responsible_id, '__name:'…)`).
  **Cada upsert falla** y cae al camino `delete + insert` del catch. Funciona de casualidad, con el
  doble de queries y un warning por cliente.
- `collection_touchpoints` y `client_collection_scores` tienen RLS `auth.uid() = user_id` puro, y
  no están en la lista de tablas compartidas con colaboradores
  (`20260507120000_collaborators_share_owner_data.sql:85`). Un colaborador ve la cartera pero **no
  ve los contactos ni los scores**.
- `AgingReportTable.tsx:192`: `<>` sin `key` dentro del `.map()` → warning de React.
- `useCollectionData.ts:45`: exporta `clientKey()` que nadie importa, y con regla de normalización
  distinta a la de `clientReceivables`. Trampa cargada para el próximo que la use.
- `agingBuckets.ts:61`: usa `new Date(iso)` (UTC) mientras la UI usa `parseLocalDate` — riesgo de
  correr un día en los bordes de bucket.

---

## Plan por fases

### Fase 0 — Medir antes de tocar (medio día)

SQL de diagnóstico para poner número a cada hallazgo con datos reales, y decidir el orden por
plata, no por teoría. Ver `docs/auditoria-cobranza-sql.md`.

Salidas esperadas:
- Cuánto se separa `balance_pending` del saldo real, factura por factura (H1).
- Cuánta cartera 2025 sigue viva hoy y no aparece en ninguna vista (H2).
- Cuánto vale el `cxc_inicial` que se está contando doble (H3).
- Cuántas filas devuelven las 7 queries (¿ya tocamos el techo de 1.000?) (H5).
- Cuánto ingreso del año está sin conciliar — el número que explica el resto (H6).

### Fase 1 — Una sola fuente de verdad (2-3 días) · mata H1, H11

1. Extraer la lógica de cartera a `supabase/functions/_shared/receivables.ts` — el mismo patrón de
   copia `src/lib` ↔ `_shared` que ya usa el parser UBL. La implementación de referencia ya está
   escrita en `mcp/index.ts:429-643`.
2. Apuntar a esa función: `score-collection-clients`, `weekly-collection-report`,
   `draft-collection-message` y **`create-invoice-payment-link`** (este primero: es el que le cobra
   al cliente).
3. Dejar `balance_pending` como lo que es — el dato crudo de Siigo — y renombrar el comentario de
   la columna para que nadie más lo lea como saldo. Que la Fase 0 diga si conviene además
   mantenerlo al día por trigger.
4. Alinear el criterio de anuladas: `void_type='total'` fuera, `partial` adentro, en todos lados.

**Evidenciar:** mismo cliente, mismo número en pantalla, en el badge de score, en el email del
lunes y en el link Wompi.

### Fase 2 — Cartera viva, no foto anual (3-4 días) · mata H2, H3, H4

1. Cambiar el eje: en vez de `year`, **saldo abierto a la fecha**. Traer toda factura de venta con
   saldo > 0 sin importar el año, y todo pago desde el inicio (o desde el último cierre de año
   confirmado).
2. El selector de año pasa a ser un filtro de *emisión* dentro de la vista, no la ventana del
   cálculo.
3. Enganchar con **Cierre de Año Fase 2**: el saldo de apertura se ancla a un cierre versionado con
   fecha, y deja de sumarse en todos los años.
4. Hacer que el Aging cubra el 100% del KPI: el remanente de saldo inicial cae en el bucket +90
   (que es lo que es), y agregar un test que falle si `Σ buckets ≠ Σ saldo_neto>0`.

**Evidenciar:** la tarjeta "Total cartera" y la fila TOTAL del Aging dan idéntico, y una factura de
2025 impaga aparece en +90.

### Fase 3 — Que el cobro real llegue al módulo (2-3 días) · mata H5, H6, H7, H10

1. Paginar las 7 queries de `clientReceivables` (`PAGE = 1000` + loop, como `useProfitability`), y
   acotar `invoice_transaction_matches` a las facturas relevantes.
2. Filtrar ingresos por `isOperativo(movement_nature)` — mismo criterio que PyG y Punto de
   Equilibrio.
3. Sumar `cash_movements` con `responsible_id` al `cobrado` de cada cliente, y **borrar** el hack
   global `carteraReal = totalPending − efectivo`.
4. Restar `voided_amount` en las facturas con NC parcial.

**Evidenciar:** un cliente que te pagó en efectivo baja su saldo; un traspaso entre cuentas propias
deja de bajarle cartera a nadie.

### Fase 4 — Cerrar el ciclo operativo (2 días) · mata H8, H9, H12

1. Una sola query para toda la pantalla: `useCollectionData` como fuente única; el detalle por
   cliente consume de ahí. Se acaba la doble descarga y la desincronización.
2. Toda mutación (vincular pago, acordar cobro, registrar contacto) invalida `['collection-data']`
   y `['accounts-receivable-by-client']` — el patrón de `useBankInvoiceMatches.ts:154`.
3. Touchpoint con `prometio_pago` → crea el `expected_payment` en la misma transacción, con fecha y
   monto.
4. Columna "Promesa" en el Aging: *"prometió $X para el 15/08"*, en rojo si ya venció sin pagar.
5. Arreglar el `onConflict` del scorer, sumar las dos tablas a la lista de colaboradores, y el
   `key` del fragment.

**Evidenciar:** vinculás un pago y el Aging cambia sin recargar; una promesa registrada aparece en
el Aging y en el forecast de caja.

### Fase 5 — Que la IA opere sobre datos buenos (2 días)

1. Re-scorear todo desde cero una vez terminada la Fase 1 (los scores actuales están calculados
   sobre deuda inexistente — no sirven).
2. Alimentar al scorer con lo que ahora sí tiene: días de pago históricos por cliente
   (ya calculados en el motor de conciliación, fases 4+5), promesas cumplidas vs incumplidas,
   y aging real.
3. **KPI de confianza en la pantalla**: *"$X de ingresos del año sin conciliar — la cartera puede
   estar sobrestimada en hasta ese monto"*. Es la respuesta directa a "siento que no me muestra la
   realidad": que el módulo te diga cuánto de su propio número es incierto.

---

## Orden recomendado

**Fase 0 → Fase 1 → Fase 2** son la columna vertebral: sin eso, cualquier mejora de UI decora un
número equivocado.

Dentro de la Fase 1, `create-invoice-payment-link` va primero y suelto: hoy puede generarle a un
cliente un link de pago por una plata que ya te pagó.
