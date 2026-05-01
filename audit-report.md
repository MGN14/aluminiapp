# Audit Report — aluminiapp (post-fixes)

**Fecha**: 2026-05-01 (segunda pasada)
**Branch**: `claude/optimistic-cannon-9c7847` (sincronizado con `main`)
**Commit base**: `66e42da`
**Proyecto Supabase**: `flmelenvmvhsogtzjjow`

**Metodología**: re-auditoría enfocada en estado actual del código tras 17 fixes shipeados. Usados 7 subagentes Explore en paralelo (Auth devolvió resultados; los otros 6 cayeron por límite de uso → completados con reads + grep estratégicos).

---

## Resumen ejecutivo

**Diferencia vs audit anterior** (commit `3aee5ac`): de los 16 críticos + 19 altos originales, **17 fixes shipeados** (bundles 1-5b) cerraron la mayoría. Quedan algunos altos/medios + módulos faltantes.

**Conteo actual**

| Severidad | Cant | Comentario |
|-----------|------|-----------|
| Crítico | 0 | Ninguno detectado tras los fixes |
| Alto | 4 | UX/data quality |
| Medio | 9 | Hardening + refactor menor |
| Bajo | 7 | Cosmético + a11y |

**Top 3 fixes para priorizar**

1. **Caja Menor `handleDelete` sin reversa** ([CajaMenor.tsx:41-50](src/pages/CajaMenor.tsx:41)) — borra `petty_cash_movements` directo sin chequear si tx bancaria está vinculada. Genera registros huérfanos.
2. **`useReconciliationRules.applyRulesToAllUserTransactions:248-269`** sigue secuencial (N+1). `applyRulesToStatement` se refactorizó pero esta función paralela quedó. 5000 tx × 200ms = timeout.
3. **`InvoiceUploadModal` timeout differentiation** ([InvoiceUploadModal.tsx:280](src/components/invoices/InvoiceUploadModal.tsx:280)) — `MAX_POLLS=45 × 4s = 3min`. Si excede, no diferencia timeout vs error de parse. UX queda en "Procesando..." forever.

---

## 1. Hallazgos por módulo

### 1.1 Auth

**Resumen**: estructura sólida, OAuth + inactivity tracking + force-password-change OK. Issues menores en feedback UX y validación admin solo frontend.

| Sev | Archivo:línea | Descripción | Fix |
|-----|---------------|-------------|-----|
| Medio | [ChangePassword.tsx:82-91](src/pages/ChangePassword.tsx:82) | Al limpiar `force_password_change`, el `refresh()` corre después del `navigate()` — race posible si user recarga rápido | Mover `refresh()` antes de navigate, o guard en ProtectedRoute para `if (forcePasswordChange && !user) skip` |
| Medio | [AdminRoute en App.tsx](src/App.tsx) + [useSubscription.tsx](src/hooks/useSubscription.tsx) | `isAdmin` validado solo frontend. RLS server-side debe garantizar que datos sensibles no leakan si flag se corrompe | Verificar policies en `user_roles` + filtrar admin-only data en queries con `auth.uid() in (admins)` |
| Bajo | [Login.tsx:55](src/pages/Login.tsx:55) | `rememberMe` checkbox renderiza pero estado nunca se usa | Implementar persistencia o remover checkbox |
| Bajo | [useForcePasswordChange.tsx:34](src/hooks/useForcePasswordChange.tsx:34) | `console.error` sin `if (isDev)` guard | Envolver con isDev como en useAuth |
| Bajo | [Signup.tsx:276-286](src/pages/Signup.tsx:276) | `handleResendEmail` sin toast de éxito | Agregar `toast()` en rama success |

**Faltantes**: ninguno. Flujos completos (signup/login/reset/change/force-change).

---

### 1.2 Créditos

**Resumen**: módulo recién shippeado funcional. Quedan refinamientos de UX y un módulo faltante claro.

| Sev | Archivo:línea | Descripción | Fix |
|-----|---------------|-------------|-----|
| Medio | [RegistrarPagoCreditoModal.tsx:111](src/components/credits/RegistrarPagoCreditoModal.tsx:111) | Threshold `newBalance <= 0.5` para marcar `paid` — con redondeo acumulado puede dejar 0.49 COP sin pagar | `Math.abs(newBalance) <= 1` |
| Bajo | [amortization.ts:62-63](src/lib/amortization.ts:62) | `r2()` redondea a 2 dec; en pagos largos error acumulable | OK si se revierte en últimas cuotas; monitorear |
| Bajo | [Creditos.tsx:47](src/pages/Creditos.tsx:47) | Filter `c.credit.status === 'active'` pero query trae todos los status (paid/cancelled aparecen mezclados) | Renombrar variable o agregar tab por status |

**Faltantes**:
- **Modal "Cancelar crédito"** — confirmado: 0 matches en grep `cancelar.*credit`. Esfuerzo: M.

---

### 1.3 Conciliación

**Resumen**: post-fixes core sólido. Detector de duplicados sigue siendo módulo faltante.

| Sev | Archivo:línea | Descripción | Fix |
|-----|---------------|-------------|-----|
| Medio | [bancolombiaCsvParser.ts:232-233](src/lib/bancolombiaCsvParser.ts:232) | `totalDebits` acumula amounts negativos sin abs — UI muestra "-85M" en débitos (contra-intuitivo) | `Math.abs(amount)` o renombrar a `totalDebitsAmount` |
| Bajo | [autoRules.ts:106-123](src/lib/autoRules.ts:106) | Orden hardcoded built-in vs no documentado para reglas custom — usuario no sabe cuál aplica primero | Documentar en UI o agregar `priority` field |

**Faltantes**:
- **Detector de duplicados al subir extracto** (mismo banco+fecha+monto+desc). Confirmado: solo hay check de "Período duplicado" en `StatementConfigModal:189`, no detección de tx individuales. Esfuerzo: M.
- **Currency conversion** — parsers hardcoded COP. Esfuerzo: M.

---

### 1.4 Reglas (reconciliation_rules + Nico)

**Resumen**: `applyRulesToStatement` ya usa bulk update por categoría (fix bundle 2). Pero `applyRulesToAllUserTransactions` quedó atrás — sigue secuencial.

| Sev | Archivo:línea | Descripción | Fix |
|-----|---------------|-------------|-----|
| **Alto** | [useReconciliationRules.ts:248-269](src/hooks/useReconciliationRules.ts:248) | `applyRulesToAllUserTransactions` sigue con loop secuencial `for + await`. 5000 tx × 200ms = 1000s = timeout navegador | Aplicar mismo refactor bulk que `applyRulesToStatement` (Map por category_id + 1 UPDATE per category) |
| Bajo | [autoRules.ts](src/lib/autoRules.ts) | No hay tests vitest para autoRules.ts | Agregar test fixtures con casos edge |

**Faltantes**: ninguno crítico.

---

### 1.5 Transacciones

**Resumen**: post-fixes (defensive user_id, sort signed, retentions rounded) lista funcionalmente. Falta exportación, paginación y búsqueda full-text.

| Sev | Archivo:línea | Descripción | Fix |
|-----|---------------|-------------|-----|
| Medio | [Transactions.tsx:200](src/pages/Transactions.tsx:200) | `cutoff.setMonth()` off-by-one fin de mes (31 ene - 1 mes = 3 dic, no 31 dic) | `date-fns subMonths()` |
| Bajo | [TransactionDetailModal.tsx:32](src/components/transactions/TransactionDetailModal.tsx:32) | Cast `(transaction as any).invoice_id` innecesario | Remover cast |

**Faltantes**:
- **Exportación Excel/CSV** — confirmado: 0 matches `export.*xlsx\|csv` en pages. Esfuerzo: M.
- **Paginación** — confirmado: 0 matches `limit\|range\|page` en query. Carga TODO en memoria. Riesgo con clientes >1000 tx/mes. Esfuerzo: L.
- **Búsqueda full-text** descripción/notas. Esfuerzo: M.

---

### 1.6 Dashboard

**Resumen**: charts v2 + mobile UX shipped. Promise.all error checks fixeado en bundle 4. Quedan refinamientos.

| Sev | Archivo:línea | Descripción | Fix |
|-----|---------------|-------------|-----|
| Medio | [Dashboard.tsx:329-336](src/pages/Dashboard.tsx:329) | `cashMovements` suma sin validar moneda (asume COP) ni date parsing | Validar `cm.date` antes de `parseLocalDate()` |
| Medio | [IncomeVsExpenseChart.tsx:56-60](src/components/dashboard/IncomeVsExpenseChart.tsx:56) | `formatDelta()` retorna `+∞` si prev=0 — overflow tooltip | Retornar "N/A" o "+999%+" |
| Bajo | [Dashboard.tsx:14-41](src/pages/Dashboard.tsx:14) | 25+ imports sin code-splitting — bundle pesado en mobile | `lazy()` + `Suspense` para charts no críticos |
| Bajo | [DashboardCustomizeModal.tsx:39-41](src/components/dashboard/DashboardCustomizeModal.tsx:39) | Pin button sin feedback visual | Toast o animación |

**Faltantes**:
- **A11y en charts** — sin `<title>` ni tabla alternativa para screenreaders. Esfuerzo: M.
- **Mobile responsive <375px** — charts overflow. Esfuerzo: S.

---

### 1.7 Informes (DIAN + Banco)

**Resumen**: lógica robusta, tests exhaustivos en evasion. Promise.all error checks fixeado en bundle 5b. UVT 2026 centralizado pero pendiente verificar valor oficial.

| Sev | Archivo:línea | Descripción | Fix |
|-----|---------------|-------------|-----|
| **Alto** | [src/lib/uvt.ts:14](src/lib/uvt.ts:14) | `UVT_2026 = 52_370` con TODO de verificar contra resolución DIAN nov-2025. Si oficial es $52.846, 100 UVT en CategoriesDeductibleSettings difiere $47.600 | Verificar resolución DIAN y actualizar constante |
| **Alto** | [useInformeBancoData.ts:209](src/hooks/useInformeBancoData.ts:209) | Rotación inventario usa `facturadoCompraAno / valorInventario` (mide salidas por factura, no COGS) — engañoso si hay descarte/robo | `facturadoVenta × margenOperativoPct / valorInventario` para aprox COGS |
| Medio | [useInformeBancoData.ts:227-229](src/hooks/useInformeBancoData.ts:227) | Punto equilibrio retorna 0 si `margenOperativoPct ≤ 0` — semáforo asume `>0` | Retornar `null` y manejar explícito |
| Medio | [useInformeBancoData.ts:186-189](src/hooks/useInformeBancoData.ts:186) | DSO simplificado `cartera = facturado − cobrado año` sesga si hay deuda años previos | Comentar simplificación en PDF |
| Bajo | [informeBancoPdf.ts:18-20](src/lib/informeBancoPdf.ts:18) | jsPDF sin `addFont('helvetica')` explícito — caracteres ñ/acentos potenciales glitches | `doc.addFont('helvetica', 'normal', 'Helvetica')` al inicio |
| Bajo | [informeBancoPdf.ts:289](src/lib/informeBancoPdf.ts:289) | Dead code: `setFill(doc, [...semColor, 0.06])` sobreescrito por línea siguiente | Eliminar línea |
| Bajo | [informeBancoPdf.ts:164-167](src/lib/informeBancoPdf.ts:164) | Texto largo "Acerca del negocio" puede truncar sin overflow a página 2 | `if (y > pageH - 40) doc.addPage()` |

**Faltantes**:
- **Datos macro Colombia 2026** (UVT oficial, salario mín $1.423.500, IPC, DTF, IBR) — pendiente confirmado. `useInformeBancoData` solo lee `business_description` de profile, no consume tabla `macro_indicators`. Esfuerzo: S si Nico provee valores; M si requiere Firecrawl/scraping.
- **Comparativa sector aluminio** — confirmado: 0 matches. Solo absolutas, sin benchmark. Esfuerzo: L (requiere tabla referencia).
- **Email compartición Informe Banco** — confirmado: 0 matches. Solo descarga local. Esfuerzo: M (Resend ya configurado).
- **Charts en PDFs** — hoy solo tablas. Esfuerzo: M (html2canvas + jsPDF).

---

## 2. Edge cases Supabase consolidados

### 2.1 RLS — estado actual
- Dominante correcto: `auth.uid() = user_id` en core.
- Gap fixeado en bundle 1: `user_subscriptions` UPDATE policy con `USING(true)` → DROP en migration `20260501120000`. Service_role bypassea, SECURITY DEFINER funcs siguen ok.
- `macro_indicators` con `USING(true)` SELECT — intencional (datos públicos globales).
- Defensa en profundidad agregada en `Transactions.tsx` + `useCollaborators` + Promise.all error checks en hooks de informes.

### 2.2 Concurrencia
- Stock: validación `newStock >= 0` ya agregada en bundle 3 (cliente). Falta trigger SQL para race entre tabs/users.
- N+1 queries: `applyRulesToStatement` ya bulk; `applyRulesToAllUserTransactions` aún N+1 (alto, ver 1.4).

### 2.3 Validaciones
- Facturas: coherencia base+iva=total fixeada en bundle 3.
- Inventarios: stock<0 fixeado en bundle 3.
- Reglas: acentos normalizados en bundle 3.
- Inputs financieros: `safeParseFloat`/`safeParsePercent`/`safeParseDays` en `lib/numberUtils.ts`.

### 2.4 Caja Menor (atención)
- `handleDelete` (1.7-h1 abajo) no reversa transacción bancaria vinculada. Sí es bug medio.

---

## 3. Fixes pendientes priorizados (impacto × esfuerzo)

| # | Fix | Impacto | Esfuerzo | Sprint |
|---|-----|---------|----------|--------|
| 1 | UVT 2026 verificar valor oficial DIAN nov-2025 | Alto | S | Hoy |
| 2 | `applyRulesToAllUserTransactions` → bulk update | Alto | M | Esta semana |
| 3 | Caja Menor `handleDelete` chequear tx bancaria vinculada antes de borrar | Medio | M | Esta semana |
| 4 | `InvoiceUploadModal` timeout differentiation (botón Reintentar) | Medio | M | Esta semana |
| 5 | `bancolombiaCsvParser` totalDebits con abs() | Medio | S | Esta semana |
| 6 | `RegistrarPagoCreditoModal` threshold `<= 1` para paid | Medio | S | Esta semana |
| 7 | `Transactions.tsx:200` cutoff con date-fns subMonths | Medio | S | Sprint próximo |
| 8 | Dashboard `cashMovements` validar fechas | Medio | S | Sprint próximo |
| 9 | `useInformeBancoData` rotación inventario con COGS aprox | Alto | S | Sprint próximo |
| 10 | `IncomeVsExpenseChart` formatDelta sin Infinity | Medio | S | Sprint próximo |
| 11 | jsPDF addFont helvetica + dead code cleanup en informeBancoPdf | Bajo | S | Cuando toque |
| 12 | Auth: ChangePassword refresh race + console.error guard | Medio+Bajo | S | Cuando toque |

**Bundle del día**: items 1, 5, 6, 8 (todos S, ~30 min total).

---

## 4. Módulos faltantes

| # | Módulo | Por qué importa | Esfuerzo |
|---|--------|-----------------|----------|
| 1 | Datos macro Colombia 2026 (UVT, salario mín, IPC, DTF, IBR) en Informe Banco | Cliente entrega ratios al banco contra benchmarks 2025 | S si valores manuales / M si scraping |
| 2 | Modal cancelar crédito | Workflow incompleto (status `cancelled` en schema pero sin UI) | M |
| 3 | Cierre caja menor (conciliación con banco) | Saldo no conciliable sin cierre | M |
| 4 | Conversión remisión → factura nueva | Hoy solo vincula existente | M |
| 5 | Detector duplicados extracto upload | User sube 2× = duplica todo | M |
| 6 | Email compartición Informe Banco/DIAN | Cliente envía manual hoy | M (Resend listo) |
| 7 | Charts en PDFs | Banco prefiere visual | M (html2canvas) |
| 8 | Paginación + búsqueda + export Transacciones | Scaling >1000 tx/mes rompe UX | M-L |
| 9 | Comparativa sector aluminio en Informe Banco | Cliente real elogió este informe; falta benchmark | L (requiere tabla) |
| 10 | A11y en charts (title + tabla alternativa) | Compliance básico | M |
| 11 | Mobile responsive <375px Dashboard | UX degrada en celulares chicos | S |

---

## 5. Apéndices

### 5.1 Falsos positivos confirmados (no reportar)
- `ProtectedRoute.tsx:20,58` y `SessionExpiredModal.tsx:52` ya tienen `if (isDev)` envoltura.
- `tourState.ts:29` JSON.parse dentro de try/catch.
- `BulkUploadModal.tsx:95` jsonRows[0] validado por `if (length < 2)`.
- `CalendarioTributario:172` nit validado por `if (length > 0)`.
- `ReteicaSettings:172` regex filter protege.
- `RegistrarPagoCreditoModal:84-86` parseFloat validado en l.87.
- `AdjustStockModal` inputs ya tienen `min={0}`.
- `InvoiceSummaryCards:124-127` Date trick con month 1-12 funciona por overflow JS.
- `InvoiceSummaryCards:204` Promise.all con fail-soft `if (!error)` deliberado.
- `parse-invoice-pdf` tool_choice ya tiene fallback a content+regex JSON (líneas 220-228).
- `useOperativeReceivables` y `usePettyCashMovements` ya tienen .error checks.
- `Dashboard.tsx:586` renta 35% es decisión consciente (Art 240 ET).

### 5.2 TS errors pre-existentes (no auditar)
PendingTransactionsTable, InvoiceUploadModal:36 (legacy), PaymentsLogReport, useFinancialHealthScore:63, Dashboard:710, MaestroProductos, jspdf module errors.

### 5.3 Cleanup técnico ya shipeado
- 12 deps removidas del package.json
- 11 archivos UI shadcn orphan borrados
- Shared libs creados: `formatters.ts`, `constants.ts`, `stringUtils.ts`, `numberUtils.ts`, `uvt.ts` + extension a `dateUtils.ts`
- Migrations a libs: IVA_RATE/RETEFUENTE_RATE (3 archivos), MONTH_LABELS (6 archivos), normalizeForMatch (2 archivos), getYearRange (4 archivos), safeParseFloat (1 archivo)
- `formatCurrency` migration mass — SKIP (40 archivos, ROI bajo, lib creado para uso futuro)

### 5.4 Tracking de commits del audit (sesión 2026-05-01)
1. `559d71f` — bundle 1 críticos S (RLS, email, tx defensivo)
2. `acb0349` — bundle 2 (N+1 → bulk, redondeo, UVT, self-heal)
3. `b8c087e` — bundle 3 (Fogafin, coherencia factura, stock, acentos, logs)
4. `c30d383` — bundle 4 (Promise.all error, periodo, sort, Siigo, comment renta)
5. `3c46f12` — bundle 5a (useCollaborators N+1, InvoiceValidationForm clamp)
6. `ec2d989` — bundle 5b (defensive hardening 13 archivos)
7. `e7a41ad` — chore: remove 12 deps + 11 orphan UI
8. `5073196` — chore: shared libs creation
9. `c314414` — refactor: IVA_RATE
10. `19416c1` — refactor: MONTH_LABELS
11. `b9bd515` — refactor: normalizeForMatch
12. `bfb1b5b` — refactor: getYearRange
13. `2d68933` — refactor: safeParseFloat
14. `a2da458` — fix(react): key={index}
15. `66e42da` — fix(build): vite.config (Vercel deploy fix)

### 5.5 Notas operacionales
- Audit ejecutado contra branch sincronizada con `main` post commit `66e42da`.
- 6 de 7 subagentes paralelos cayeron por límite de uso; análisis completado con reads + grep estratégicos basados en audit anterior + verificación de fixes shipeados.
- Próxima auditoría: dejar pasar al menos un sprint para que módulos faltantes prioritarios se shippeen.
