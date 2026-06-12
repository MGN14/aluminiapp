# Auditoría de gestión contable y financiera — AluminIA

**Fecha**: 2026-06-11
**Branch**: `claude/nice-kilby-951911`
**Pregunta**: ¿qué le falta a la app para dirigir la empresa contable y financieramente y tomar las mejores decisiones? ¿Hay flujos rotos, módulos sueltos o UI volando?

**Metodología**: 6 auditores en paralelo (contabilidad, finanzas/decisiones, flujos rotos, UI huérfana, cableado de módulos, integridad de cálculos) leyendo el código real. Cada hallazgo fue verificado adversarialmente por un segundo agente contra archivo:línea (37 crudos → 35 confirmados/parciales, 2 refutados). Un crítico de completitud final buscó puntos ciegos. Total: 44 agentes.

---

## Veredicto ejecutivo

**La app está operativamente sana.** El grafo de navegación está íntegro (cero links a rutas inexistentes, cero `moduleKey` inválidos), el modo Gerencial no deja items inalcanzables, y los pilares del día a día (PYG, flujo de caja, conciliación, CxC/CxP, inventario valorizado, caja menor, créditos, cobranza) existen y están conectados.

**Lo que falta es la capa contable formal y la capa de planeación**:

- AluminIA hoy es un **espejo retrovisor excelente** (qué pasó) pero no un tablero de dirección (qué va a pasar, contra qué plan, con qué margen real).
- El número más envenenado es el **costo del aluminio importado**: vive solo en USD, sin landed cost ni TRM, y nunca llega al costo del inventario → margen bruto, rentabilidad por producto y break-even están inflados.
- Hay **1 bug de datos real** (alto): `balance_pending` solo lo escribe Siigo; un cliente que paga por la app sigue figurando como deudor en el scoring de cobranza.

| Severidad | Confirmados |
|-----------|------------|
| Crítico (código) | 0 |
| Crítico (punto ciego conceptual) | 1 — landed cost importaciones |
| Alto | 3 + 3 puntos ciegos |
| Medio | 14 + 2 puntos ciegos |
| Bajo | 18 |

---

## 1. Capa contable — qué hay y qué falta

| Área | Estado | Evidencia |
|------|--------|-----------|
| Estado de resultados (PYG) | ✅ con matices | `PYGReport.tsx` — pero ver §1.1 |
| Flujo de caja (histórico) | ✅ | `CashFlowReport.tsx` — facturas solo como referencia, no doble conteo |
| Conciliación bancaria | ✅ | módulo completo con dedup y reglas |
| CxC / CxP / Anticipos / Cobranza | ✅ | módulos completos |
| Inventario valorizado + costo promedio | ✅ | `recalculate-inventory-costs` |
| IVA / ReteFuente / ReteICA (estimación) | 🟡 parcial | flags + monto por transacción; sin liquidación formal por periodo, sin certificados de retención |
| Calendario tributario DIAN | ✅ | `dianCalendar2026.ts`, obligaciones configurables |
| **Balance General vivo** | ❌ **ALTO** | Solo snapshot inicial manual (`InitialFinancialStateCard.tsx`, `useInitialFinancialState.ts:73-88` — no lee tablas operativas). Ningún reporte recalcula activos/pasivos/patrimonio al día de hoy. |
| **Nómina / provisión de prestaciones** | ❌ | Cero tablas de empleados/salarios/devengados en migraciones. Solo `business_employees_count` (un número) y "nómina" como etiqueta del calendario. |
| **Depreciación de activos fijos** | ❌ | Solo `categories.is_tax_deductible`. Sin tabla de activos. |
| **Información exógena** | ❌ | grep exógena/medios magnéticos = 0 en todo el repo |
| **Cierre de periodo contable** | ❌ | El único cierre es el de caja menor (`close_petty_cash_period`). Transacciones de meses pasados se pueden editar/borrar → los reportes históricos cambian retroactivamente. |
| PUC / partida doble / libro mayor | ❌ | Por diseño (clasificación gerencial por `report_group`). Aceptable si el contador lleva la contabilidad oficial, pero el export no es mapeable a cuentas. |
| Facturación electrónica (emisión) | 🟡 vía Siigo | `validate-cufe` solo consulta el catálogo DIAN; notas crédito solo entran por sync Siigo |

### 1.1 Matices del PYG (medio)

- **Margen bruto no usa COGS real**: `PYGReport.tsx:416,446` — "Utilidad Bruta" = Ingresos − categoría `costos_operacionales`. Depende de cómo el usuario nombró sus categorías. El COGS desde inventario YA existe pero solo en `useInformeBancoData.ts:255-281` (no en el PYG).
- **Estado de resultados es de caja, no de causación**: suma egresos categorizados del banco; no cruza movimientos de inventario.

---

## 2. Capa financiera / soporte a decisiones

| Área | Estado | Evidencia |
|------|--------|-----------|
| Dashboard KPIs (ingresos/egresos/resultado) | ✅ | 27 componentes: CFO Insights, salud financiera, GMF, retenciones, obligaciones próximas, macro ticker |
| Forecast de caja confidence-weighted | ✅ | `forecast_cashflow` (mig 20260530120000) + `CashflowForecastPanel` |
| Concentración de clientes | ✅ | `cfo-insights/index.ts:484-511` |
| Alertas proactivas | ✅ | cfo-insights + weekly reports |
| **Presupuesto vs Real** | ❌ **ALTO** | grep budget/presupuest = 0 en src+migraciones+functions. Solo hay comparación vs año anterior. Sin plan no hay dirección, solo reacción. |
| **Rentabilidad por producto/cliente** | 🟡 | `cost_per_unit` y `sale_price` existen en `inventory_products` (types.ts:1062,1070) pero NINGUNA vista cruza margen. El dashboard muestra quién factura más, no quién deja más plata. |
| **Razón corriente / endeudamiento / capital de trabajo / ciclo de caja** | ❌ | Solo DSO existe (`useInformeBancoData.ts:235`). Cero ratios de liquidez/solvencia. |
| **KPIs enterrados en /informe-banco** | 🟡 medio | `useInformeBancoData` calcula margen operativo, YoY, DSO, rotación de inventario, break-even — y SOLO se ven en Informe para Banco, no en el dashboard del lunes. |
| Variación vs periodo anterior en KPI cards | ❌ | `Dashboard.tsx:546-590` — números absolutos sin delta % |
| Estacionalidad (YoY mensual) | 🟡 casi | `BilledByMonthChart` YA implementa el toggle "Comparar año anterior" (líneas 54-98) pero `Dashboard.tsx:847` no le pasa `prevYearData` → feature construida e invisible |
| Nico IA con forecast | 🟡 | `nico-chat` no inyecta `forecast_cashflow` ni rentabilidad por referencia en su contexto |
| Costos fijos vs variables / margen de contribución | ❌ | punto ciego — ver §6 |

---

## 3. Flujos rotos (los reales)

1. **[ALTO] `balance_pending` solo lo escribe Siigo** — `siigo-sync-invoices/index.ts:570` es el ÚNICO write en todo el repo. Pero `score-collection-clients/index.ts:46,105,143` y `forecast_cashflow` (mig 20260530120000:88-89) LEEN ese campo. Un cliente que paga por la app (conciliación/remisiones) sigue con deuda en el scoring de cobranza y el forecast hasta el próximo sync de Siigo. **Fix**: derivar `balance_pending` vía trigger o función SQL que reste pagos registrados en la app.

2. **[MEDIO] Item "Importaciones" rebota a colaboradores** — `AppSidebar.tsx:92` sin `permKey` → visible para todo colaborador; `App.tsx:197` lo envuelve en `AdminRoute` → clic = expulsión silenciosa a /dashboard. Parece bug al usuario. **Fix**: flag `adminOnly` en el item + filtro en `SidebarSection` (igual que `founderOnly`).

3. **[MEDIO] Permiso `dashboard` es decorativo** — `App.tsx:137` usa `ProtectedRoute`, no `RequireModule`. Un colaborador con dashboard='none' no ve el item pero entra por URL (y RequireModule redirige justamente a /dashboard al denegar otros módulos). **Fix**: dejar dashboard siempre-on y quitarlo de los toggles, o envolverlo en RequireModule con destino de denegación distinto.

✅ Verificado OK: ningún `navigate()`/`Link`/`Navigate` apunta a ruta inexistente; los 19 `moduleKey` de RequireModule existen en MODULE_KEYS; el modo Gerencial no deja huérfanos; `productos-terminados` compartiendo permiso `cotizaciones` es intencional (mismo hub con tabs).

---

## 4. UI huérfana / dropdowns sueltos / componentes volando

### Construido pero desconectado (alto valor, conectar)

| Componente | Qué pasa | Fix |
|-----------|----------|-----|
| `Export.tsx:584,605` — botones "Generar informe para banco" y "Generar informe DIAN" | toast "Próximamente"… **pero las features YA existen** (`/informe-banco` con PDF y `/visita-dian`) | Cambiar el toast por `navigate('/informe-banco')` / `navigate('/financial-health')` |
| `SaveStatusIndicator.tsx` (conciliación) | Componente completo (spinner/check/error por fila), 0 imports. `TransactionRow.tsx:59` ya obtiene `status`/`errorMessage` de `useTransactionEdit` | Renderizarlo en TransactionRow. Si un guardado falla por red/RLS hoy el usuario no se entera |
| `BusinessAboutSection.tsx` (settings) | Form de contexto del negocio nunca montado, pero `useInformeBancoData.ts:112,469-474` LEE esos campos → siempre null, degrada informe banco y contexto de Nico | Montarlo en /settings junto a TaxSettingsCard |
| `FixDatesButton` (`StatementPeriodEditor.tsx:15`) | El RPC `fix_transaction_dates_for_statement` existe en DB; ningún botón lo invoca. Extracto con mes/año mal = reportes por periodo distorsionados sin corrección posible | Exponerlo en StatementConfigModal o en la fila del extracto |
| `BilledByMonthChart` comparativo YoY | Implementado completo; `Dashboard.tsx:847` no pasa `prevYearData` | Pasar el fetch del año anterior |

### Controles que mienten

- `Login.tsx:636` — checkbox **"Recordarme" no hace nada** (nunca se pasa a signIn; Supabase persiste igual en ambos casos). Wirear o quitar.

### Código muerto (borrar cuando haya un rato)

- `DIANConnectionCard.tsx` + `useDIANConnection` + posiblemente edge `dian-connect` (superados por el pivot a portal on-demand)
- `ReteicaSettings.tsx`, `AutoRulesButton.tsx`, `TaxRecalculationButton.tsx`, `AluminumCatalogModal.tsx` (superados por TaxSettingsCard/ConfiguracionView)
- `src/pages/Invoices.tsx` (0 imports; el routing usa InvoicesVenta/InvoicesCompra)
- `TransactionTable.tsx`, `PeriodSelector.tsx`, `MonthlySummaryTable.tsx`, `InvoiceMicroSummary.tsx`, `PlanStatusCard.tsx`, `SecurityFeatures.tsx`, `TestimonialReviews.tsx`
- `TrialExpiredOverlay.tsx` — ojo: es el bloqueador de trial vencido y nunca se monta → la expiración solo aplica a subida de PDFs, no a edición general. Decidir si endurecer el paywall o borrar.
- Branch `authNavItems` de `MobileNav.tsx:25-33` (rutas viejas `/invoices`, `/reports`; nunca se renderiza autenticado — trampa futura)
- Rutas: `/coming-soon` (nadie la linkea), `/financial-health-legacy`, `/admin` (página founder sin ningún enlace — redirigir a /founder como se hizo con /admin/analytics)

---

## 5. Cableado módulos ↔ permisos (menores)

- 3 items del sidebar gatean inline con `hasModule()` en vez de `permKey` (`AppSidebar.tsx:457,491,582` — Nico IA, Dashboard, Créditos). Funciona, pero dos fuentes de verdad. Migrar Créditos a NavItem con permKey.
- Label del módulo `cotizaciones` debería decir "Cotizaciones y productos terminados" (`useCollaborators.ts:21`) para que el admin entienda el alcance al invitar.

---

## 6. Puntos ciegos (crítico de completitud)

1. **[CRÍTICO] Landed cost de importación no alimenta el costo del inventario.** `imports` vive en USD (`monto_total_usd`, `precio_smm_cerrado_usd_ton`) sin arancel/flete/seguro/nacionalización, y nada reparte esos costos al `cost_per_unit` de `inventory_products`. Para una comercializadora de aluminio importado, el COGS está subvaluado → margen bruto, rentabilidad por producto y break-even inflados.
2. **[ALTO] Diferencia en cambio (TRM).** Sin campo TRM/COP en imports ni import_payments. Una CxP en USD debe registrarse a TRM de la fecha y reconocer diferencia en cambio (NIIF + renta). Nico IA no puede responder "¿cuánto me costó la subida del dólar?".
3. **[ALTO] Maestro único de terceros.** `responsibles` existe pero convive con NIT free-text en invoices (`counterparty_nit`); sin dedup ni validación de dígito de verificación. Es el cimiento de la exógena (1001/1007/1008), cartera por cliente y rentabilidad por cliente.
4. **[ALTO] Provisión de prestaciones sociales.** Cesantías+intereses+prima+vacaciones ≈ 21.83% sobre nómina, se causan mes a mes y revientan en junio/diciembre. Hoy ni el forecast de caja ni el patrimonio lo ven. No requiere nómina completa: capturar valor de nómina mensual y provisionar.
5. **[MEDIO] Saldo a favor de IVA y retenciones que TE practicaron.** La app estima lo que debés, no lo recuperable (anticipo de renta).
6. **[MEDIO] Fijos vs variables.** Sin ese flag en `categories` no hay margen de contribución ni break-even real en pesos/toneladas.

---

## 7. Plan priorizado

| # | Qué | Por qué | Esfuerzo |
|---|-----|---------|----------|
| 1 | **Fix `balance_pending` derivado** (trigger/función que reste pagos de la app) | Bug con clientes reales: cobranza y forecast mienten | Bajo-medio |
| 2 | **Quick wins de UI ya construida**: botones Export → navigate a informes reales; SaveStatusIndicator en conciliación; BusinessAboutSection en settings; prevYearData al chart; FixDatesButton; quitar/wirear "Recordarme"; fix item Importaciones para colaboradores | Ratio impacto/esfuerzo altísimo — todo ya está codeado | Bajo |
| 3 | **Landed cost + TRM en importaciones** → alimentar `cost_per_unit` | Sin esto, todo número de margen está inflado | Alto |
| 4 | **Subir KPIs gerenciales al dashboard** (margen, DSO, rotación, break-even, delta % vs periodo anterior) — ya se calculan en useInformeBancoData | De "se calculan y nadie las ve" a verlas el lunes | Bajo |
| 5 | **Balance General vivo** (estado inicial + transactions + CxC/CxP + inventario valorizado + créditos) + razón corriente, endeudamiento, capital de trabajo | "¿Cuánto vale mi empresa y puedo endeudarme?" | Medio-alto |
| 6 | **Presupuesto vs Real** (tabla budgets + vista sobre la estructura del PYG) | De reaccionar a dirigir; habilita a Nico IA a explicar desvíos | Medio |
| 7 | **Provisión de prestaciones** en forecast de caja + pasivo | Causa #1 de "tenía caja en pantalla y no alcanzó" | Medio |
| 8 | **Maestro de terceros por NIT** (backfill responsible_id, dígito verificación, vista 360) | Cimiento de exógena + rentabilidad por cliente | Medio |
| 9 | Flag fijo/variable en categories → margen de contribución y break-even real | "¿Cuánto tengo que vender para no perder?" | Bajo-medio |
| 10 | Activos fijos + depreciación lineal; cierre/bloqueo de periodo mensual | Riesgo DIAN + reportes históricos inmutables | Medio |
| 11 | Limpieza de código muerto (§4) | Mantenibilidad | Bajo |
