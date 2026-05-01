# Audit Report — aluminiapp

**Fecha**: 2026-05-01
**Branch**: `claude/optimistic-cannon-9c7847`
**Commit base**: `3c8e082`
**Proyecto Supabase**: `flmelenvmvhsogtzjjow`
**Metodología**: 9 subagentes Explore en paralelo, audit estático read-only sobre código fuente. No se ejecutó la app ni edge functions.

---

## Resumen ejecutivo

**Conteo de hallazgos**

| Severidad | Cantidad | Definición |
|-----------|----------|------------|
| Crítico | 16 | Bloquea producción, leak de datos, cálculo financiero incorrecto al cliente, RLS roto |
| Alto | 19 | UX rota, flujo no completable, parse silencioso, console.log en prod |
| Medio | 22 | Edge case sin cubrir, performance, validación faltante, typing débil |
| Bajo | 20 | A11y, copy, dead code, responsive, console.log de debug olvidado |

**Top 5 fixes por impacto × esfuerzo (todos S = ≤30 min, alto impacto)**

1. **RLS `USING (true)` en `user_subscriptions` y `macro_indicators`** — leak de suscripciones/datos macro entre usuarios. Migration nueva con `auth.uid() = user_id`.
2. **`invite-collaborator` usa `onboarding@resend.dev`** en lugar del dominio verificado — afecta deliverability de invitaciones a colaboradores existentes.
3. **`Transactions.tsx:115` no filtra por `user_id`** — confía 100% en RLS. Si una migration desactiva RLS por error, leak total. Añadir `.eq('user_id', currentUser.id)` defensivo.
4. **`StatementUpload.tsx:189` `setTimeout(navigate, 1200)`** corre `applyRulesToStatement` sin esperar — categorización se pierde si tarda >1.2s. Mover navigate a `onSuccess`.
5. **`useReconciliationRules.ts:176-193` N+1 updates** — 100 tx → 101 queries. Reemplazar por bulk `update ... case when`.

**Top 5 módulos incompletos a priorizar**

1. **Datos macro Colombia 2026** (salario mín, UVT, IPC, DTF) — pendiente conocido (memoria Q). Sin esto, Informe Banco entrega ratios con datos 2025. Esfuerzo S.
2. **Vincular abono parcial a factura** — modal existe pero no persiste estado en `invoice_payments`. Impacta cobranza. Esfuerzo L.
3. **Cierre de caja menor** — no hay flujo para conciliar saldo de caja vs saldo bancario. Esfuerzo M.
4. **Comparativa sector aluminio** en Informe Banco — hoy solo tablas absolutas, sin benchmark. Esfuerzo L.
5. **Paginación + exportación Excel/CSV en Transacciones** — carga todo en memoria; falla con clientes >1000 tx/mes. Esfuerzo M.

**Veredicto general**: el codebase está sólido en arquitectura (RLS dominante con `auth.uid() = user_id`, edge functions con verify_jwt manual, error boundary + Sentry, parsers con tests). Los hallazgos críticos son **localizados y todos S/M de esfuerzo** — un sprint de un día limpia los 5 más urgentes. El riesgo más sistémico es el de **N+1 queries** en flujos masivos (apply rules, dashboard Promise.all) — escalará mal con clientes grandes.

---

## 1. Hallazgos por módulo

### 1.1 Auth

**Resumen**: Bien estructurado, flujos signup/login/reset robustos, inactividad 8h, RLS sólida. Sin críticos. Issues menores en console.logs en prod, OAuth race, validaciones faltantes.

| Sev | Archivo:línea | Descripción | Fix sugerido |
|-----|---------------|-------------|--------------|
| Medio | [Login.tsx:159-168](src/pages/Login.tsx:159) | `signInWithOAuth` no maneja race si user clickea 2x; `googleLoading` no se limpia en success | Confirmar disabled funciona y agregar idempotency key |
| Medio | [ResetPassword.tsx:88](src/pages/ResetPassword.tsx:88) | `verifyOtp({ token_hash })` race entre `markReady()` y `markNeedCode()` si timeout coincide con respuesta | Usar `resolved` flag con `useRef` para evitar doble-set |
| Bajo | [Login.tsx:55](src/pages/Login.tsx:55) | State `rememberMe` declarado pero nunca usado en signIn | Remover o implementar persist sesión |
| Bajo | [useAuth.tsx:12-19](src/hooks/useAuth.tsx:12) | `isDev` check imperfecto — si `import.meta.env.MODE` mal, logs filtran a prod | `MODE === 'development' && PROD === false` |
| Bajo | [Signup.tsx:276-286](src/pages/Signup.tsx:276) | `handleResendEmail` sin feedback al usuario (silent success) | Toast "Correo reenviado" |
| Bajo | [inactivityTracker.ts:56](src/lib/inactivityTracker.ts:56) | Sin `last_active_at` retorna sesión activa — fail-open ok pero edge case con localStorage corrupto | Documentar fail-open o invalidar |
| Bajo | [ProtectedRoute.tsx:20](src/components/ProtectedRoute.tsx:20) | `console.log` en cada check (también líneas 58 y SessionExpiredModal:52) | Remover o `if (isDev)` |
| Bajo | [useForcePasswordChange.tsx:28](src/hooks/useForcePasswordChange.tsx:28) | Cast `as never` en select() para `force_password_change` — type-safety risk | Regenerar types desde migrations |

**Faltantes/incompletos**:
- OAuth role-mapping post-signup — admin no puede pre-asignar roles a invitados OAuth. Esfuerzo: M
- `signOut` error handling — si Supabase falla, `clearLastActiveAt()` ejecuta igual dejando stale state. Esfuerzo: S
- Rate limit Login es client-side — podría bypassearse con bots. Esfuerzo: M (mover a edge function)

---

### 1.2 Créditos

**Resumen**: Módulo recién shippeado (10 commits últimos días) con cálculos amortización francesa/alemana/bullet sólidos. **Críticos**: schema mismatch en `transaction_id` y query incompleta en VincularFacturaTxModal pierde costos Fogafin.

| Sev | Archivo:línea | Descripción | Fix sugerido |
|-----|---------------|-------------|--------------|
| Crítico | [useCredits.ts:33](src/hooks/useCredits.ts:33) | `transaction_id` declarado en interfaz `CreditPayment` pero **no existe en schema** — type lie | Remover campo del tipo |
| Crítico | [VincularFacturaTxModal.tsx:154](src/components/reports/VincularFacturaTxModal.tsx:154) | SELECT credits no incluye `additional_costs_pct/label`. `summarizeCredit()` recibe 0 hardcoded (línea 183) → **costo real Fogafin se pierde** en cálculo de `totalCreditCost` | Agregar columnas al SELECT y pasar `Number(c.additional_costs_pct ?? 0)` |
| Crítico | [supabase/migrations/20260429190000_credits.sql](supabase/migrations/20260429190000_credits.sql) | Migración inicial sin `additional_costs_pct/label`. Añadidas en migration posterior — entornos nuevos pueden tener inconsistencia transitoria | Confirmar orden ejecución; ya usan IF NOT EXISTS |
| Alto | [amortization.ts:226](src/lib/amortization.ts:226) | Lógica `recalculada` falsea positivos: `saldoReal < row.saldoRestante + capitalEfectivo - 0.5` con varios pagos puede mostrar ★ erróneamente | Marcar `recalculada=true` solo si `pagadoTotalEnCuota===0` y hay reducción |
| Alto | [RegistrarPagoCreditoModal.tsx:111](src/components/credits/RegistrarPagoCreditoModal.tsx:111) | `newBalance <= 0.5` para marcar `paid` — con redondeos puede dejar 0.49 COP sin pagar y marcar paid | Usar `Math.abs(newBalance) <= 1` |
| Medio | [Creditos.tsx:47](src/pages/Creditos.tsx:47) | Filter `c.credit.status === 'active'` pero status incluye `paid/cancelled`, query trae todos, contador (l.66) cuenta cerrados — semántica inconsistente | Renombrar variable o agregar tab |
| Medio | [amortization.ts:62-63](src/lib/amortization.ts:62) | `r2()` redondea a 2 dec — error acumulable en pagos largos | OK si se revierte en últimas cuotas; monitorear |

**Faltantes/incompletos**:
- Modal "Cancelar crédito" — sin handler claro en Creditos.tsx. Esfuerzo: M
- Integración PYG/calendario DIAN — commits dicen V (shipped) pero búsqueda superficial no halló componentes. Verificar antes de afirmar bug. Esfuerzo: S verificación

---

### 1.3 Conciliación + Reglas

**Resumen**: Parsers excelentes (Bancolombia con tests reales, BOM/CRLF/encoding manejados). **Críticos**: N+1 updates al aplicar reglas + race con navigate post-upload + self-heal de edge function que retorna éxito con datos parciales.

| Sev | Archivo:línea | Descripción | Fix sugerido |
|-----|---------------|-------------|--------------|
| Crítico | [useReconciliationRules.ts:176-193](src/hooks/useReconciliationRules.ts:176) | **N+1 updates**: 1 SELECT + N UPDATE por tx. 100 tx = 101 queries. Sin batch | Bulk UPDATE con CASE WHEN o `Promise.all` por chunks |
| Crítico | [StatementUpload.tsx:189](src/pages/StatementUpload.tsx:189) | `setTimeout(navigate, 1200)` post-upload corre antes de `applyRulesToStatement` — si tarda >1.2s, tx quedan sin categorizar y user ve estado obsoleto | Mover navigate a `onSuccess` de mutation |
| Alto | [parse-bancolombia-csv/index.ts:178-192](supabase/functions/parse-bancolombia-csv/index.ts:178) | Self-heal con `existingTxCount > 0` retorna éxito sin completar inserts. Si insert falla a mitad (50/86), reintento ve 50 y declara éxito | Comparar `existingTxCount === validMovements.length` |
| Alto | [useReconciliationRules.ts:158](src/hooks/useReconciliationRules.ts:158) | Filter rechaza reglas con `category_id=null` pero **silenciosamente** — usuario no sabe que su regla está descartada | Validar al crear regla; loguear warn si se ignora |
| Alto | [useReconciliationRules.ts:47-66](src/hooks/useReconciliationRules.ts:47) | `matchesRule()` no normaliza acentos: "BOGOTÁ" no matchea "BOGOTA". CSV de Bancolombia viene sin tildes | `text.normalize('NFD').replace(/[̀-ͯ]/g, '')` ambos lados |
| Medio | [bancolombiaCsvParser.ts:232-233](src/lib/bancolombiaCsvParser.ts:232) | `totalDebits` acumula amounts negativos sin abs — UI muestra "-85M" en débitos (contra-intuitivo) | `else if (amount < 0) totalDebits += Math.abs(amount)` |
| Medio | [useReconciliationRules.ts:248-269](src/hooks/useReconciliationRules.ts:248) | `applyRulesToAllUserTransactions` loop secuencial con await — 5000 tx × 200ms = 1000s timeout navegador | Chunks de 50-100 con `Promise.all` |
| Medio | [WeeklyCsvUploader.tsx:170-316](src/components/statements/WeeklyCsvUploader.tsx:170) | Sin timeout explícito en edge function call — UX queda en "Uploading..." forever si tarda | `AbortController` con 30s timeout |
| Bajo | [autoRules.ts:106-123](src/lib/autoRules.ts:106) | Orden hardcoded built-in vs no docu reglas custom — usuario no sabe cuál aplica primero | Documentar o priority field |
| Bajo | [parse-bancolombia-csv/index.ts:199-230](supabase/functions/parse-bancolombia-csv/index.ts:199) | Self-heal asume `existingTxCount` confiable pero no valida calidad (NULL desc, amount 0) | Validación post-fetch o constraint DB |

**Faltantes/incompletos**:
- **Detector de duplicados** al subir extracto (mismo banco+fecha+monto+desc) — si user sube 2× mismo PDF, duplica todo. Esfuerzo: M
- Test coverage en edge functions Deno — solo browser parsers tienen vitest. Esfuerzo: M
- Currency conversion — parser hardcoded COP. Esfuerzo: M

---

### 1.4 Transacciones

**Resumen**: Funcionalidad core intacta. **Críticos**: inconsistencia de redondeo en retenciones (ReteICA usa Math.round, IVA no), confianza ciega en RLS sin filtro defensivo, sort por monto pierde signo.

| Sev | Archivo:línea | Descripción | Fix sugerido |
|-----|---------------|-------------|--------------|
| Crítico | [useTransactionEdit.ts:35](src/hooks/useTransactionEdit.ts:35) | ReteICA usa `Math.round()` pero IVA/Retefuente decimales sin redondeo — totales no cuadran a centavos | Consistent rounding (`.toFixed(2)` o Decimal.js) |
| Crítico | [Transactions.tsx:115](src/pages/Transactions.tsx:115) | `fetchTransactions()` **NO filtra por user_id** — confía 100% en RLS. Si RLS rota, leak total | Añadir `.eq('user_id', currentUser.id)` defensivo |
| Crítico | [useTransactionEdit.ts:21-29](src/hooks/useTransactionEdit.ts:21) | `Math.abs(amount ?? 0)` en cálculos retenciones — si amount null, retenciones = 0 sin warning | Validar `amount !== null` antes de cálculo |
| Alto | [Transactions.tsx:294-296](src/pages/Transactions.tsx:294) | Sort por monto: `a.debit \|\| a.credit \|\| 0` pierde signo — egreso 100 == ingreso 100 | `(a.debit ?? 0) - (a.credit ?? 0)` |
| Alto | [useTransactionEdit.ts:61](src/hooks/useTransactionEdit.ts:61) | useEffect deps solo `[initialTransaction.id]` — cambios externos a amount/has_iva no se reflejan | Depender del objeto completo o ref-detect |
| Alto | [InvoiceSelector.tsx:162-163](src/components/InvoiceSelector.tsx:162) | Cast `as never` en queries de credits/credit_payments oculta errores de schema/RLS | Definir tipos reales en supabase codegen |
| Medio | [Transactions.tsx:200](src/pages/Transactions.tsx:200) | `cutoff.setMonth()` off-by-one fin de mes (31 ene - 1 mes = 3 dic, no 31 dic) | `date-fns subMonths()` |
| Bajo | [TransactionDetailModal.tsx:32](src/components/TransactionDetailModal.tsx:32) | Cast `(transaction as any).invoice_id` innecesario | Remover cast |
| Bajo | [PendingTransactionsTable.tsx:44-50](src/components/PendingTransactionsTable.tsx:44) | `formatCurrency` sin locale fallback — riesgo USD si navigator.language ≠ es-CO | Forzar `'es-CO'` |

**Faltantes/incompletos**:
- Exportación Excel/CSV — no implementada. Esfuerzo: M
- Búsqueda full-text descripción/notas — solo filtros estructurados. Esfuerzo: M
- Paginación — carga todo en memoria, scaling risk >1000 tx. Esfuerzo: L

---

### 1.5 Dashboard

**Resumen**: Arquitectura sólida (RQ v5, Recharts, customización con localStorage). **Críticos**: tasa de renta hardcoded 35% sin distinguir persona vs empresa, Promise.all sin error handling individual, fallback de useModuleContext potencialmente inseguro.

| Sev | Archivo:línea | Descripción | Fix sugerido |
|-----|---------------|-------------|--------------|
| Crítico | [Dashboard.tsx:586](src/pages/Dashboard.tsx:586) | KPI Renta calcula 35% hardcoded — no distingue persona natural (5-37%) vs empresa (8-37%). Usa periodo UI no cuatrimestre fiscal | Tasa real desde profile, periodo cuatrimestre fiscal |
| Crítico | [Dashboard.tsx:225](src/pages/Dashboard.tsx:225) | `Promise.all([...])` sin check de `error` por query — si una falla (rate limit Free 60 req/s), itera arrays null y crashea | Check `if (error) throw` por query |
| Crítico | [useModuleContext.tsx:58](src/hooks/useModuleContext.tsx:58) | Fallback hardcoded `isDian: true` si context undefined — correcto en happy path, pero si ModuleProvider falla a render, no hay error | Throw en fallback o ASSERT provider activo |
| Alto | [Dashboard.tsx:782-791](src/pages/Dashboard.tsx:782) | `pendingTable` filtra por año entero, no por periodSelection — tooltip dice "Año X" pero debería respetar rango UI | Filtrar por `periodRange.start ≤ date ≤ periodRange.end` |
| Alto | [Dashboard.tsx:252](src/pages/Dashboard.tsx:252) | useEffect con deps `[]` pero llama callbacks que dependen de state — silent staleness | Agregar deps reales o `useCallback` |
| Alto | [Dashboard.tsx:783](src/pages/Dashboard.tsx:783) | Cast `as { operative_receivable_assigned?: ... }` oculta missing field en select y type | Agregar field a `TransactionData` interface |
| Medio | [Dashboard.tsx:329-336](src/pages/Dashboard.tsx:329) | `cashMovements` suma sin validar moneda (asume COP) ni date parsing | Validar `cm.date` antes de `parseLocalDate()` |
| Medio | [Dashboard.tsx:166-180](src/pages/Dashboard.tsx:166) | Reteica yearlyCard oculta tarjeta si suma=0 — silent failure si query mal calcula | Loguear si se oculta cuando debería mostrar |
| Medio | [IncomeVsExpenseChart.tsx:56-60](src/components/dashboard/IncomeVsExpenseChart.tsx:56) | `formatDelta()` retorna `+∞` si prev=0 — overflow en tooltip | Retornar "N/A" o "+999%+" |
| Bajo | [Dashboard.tsx:14-41](src/pages/Dashboard.tsx:14) | 25 imports de componentes sin code-splitting — bundle pesado en mobile | `lazy()` + `Suspense` para charts no críticos |
| Bajo | [DashboardCustomizeModal.tsx:39-41](src/components/dashboard/DashboardCustomizeModal.tsx:39) | Pin button sin feedback — silent persistence | Toast o animación |

**Faltantes/incompletos**:
- A11y en charts — sin `<title>` ni tabla alternativa. Esfuerzo: M
- Mobile responsive: charts overflow <375px. Esfuerzo: S
- Rate limit handling (60 req/s Free) en Promise.all chains. Esfuerzo: M

**Nota**: ModuleContext.tsx:26-32 fuerza `isDian` si `!isAdmin && mode==='gerencial'` — protección correcta de Gerencial contra stale localStorage post-logout-admin.

---

### 1.6 Informes (DIAN + Banco)

**Resumen**: Lógica financiera robusta, tests exhaustivos (40+ casos en evasionPenalties/Gap), tasas DIAN 2026 correctas. **Único crítico**: posible inconsistencia UVT 2026 en CategoriesDeductibleSettings (badge dice $5.237.000 = 100 × $52.370, pero UVT 2026 oficial podría ser $49.799 — verificar).

| Sev | Archivo:línea | Descripción | Fix sugerido |
|-----|---------------|-------------|--------------|
| Crítico | [evasionPenalties.ts:56,59](src/lib/evasionPenalties.ts:56) + CategoriesDeductibleSettings.tsx | UVT 2026 inconsistente: badge muestra `100 UVT = $5.237.000` (= $52.370/UVT) pero comentario en evasionPenalties menciona $49.799. Diferencia $258K en límite deducibilidad | Confirmar UVT 2026 contra resolución DIAN. Centralizar en constante única |
| Medio | [useInformeBancoData.ts:209](src/hooks/useInformeBancoData.ts:209) | Rotación inventario usa `facturadoCompraAno / valorInventario` en vez de COGS aproximado — si hay descarte/robo, ratio engañoso | Usar `facturadoVenta × margenOperativoPct / valorInventario` |
| Medio | [useInformeBancoData.ts:227-229](src/hooks/useInformeBancoData.ts:227) | Punto equilibrio retorna 0 si `margenOperativoPct ≤ 0` — semáforo (l.349) asume `>0` | Retornar `null` y manejo explícito en semáforo |
| Bajo | [informeBancoPdf.ts:18-20](src/lib/informeBancoPdf.ts:18) | jsPDF sin `addFont('helvetica')` — caracteres ñ/acentos posibles glitches en envs | `doc.addFont('helvetica', 'normal', 'Helvetica')` |
| Bajo | [useInformeBancoData.ts:186-189](src/hooks/useInformeBancoData.ts:186) | DSO simplificado: `cartera = facturado − cobrado año actual` sesga si hay deuda años previos | Comentar simplificación en PDF |
| Bajo | [informeBancoPdf.ts:289](src/lib/informeBancoPdf.ts:289) | Dead code: `setFill(doc, [...semColor, 0.06] as never)` sobreescrito en línea siguiente | Eliminar línea o aplicar tintado |
| Bajo | [informeBancoPdf.ts:164-167](src/lib/informeBancoPdf.ts:164) | "Acerca del negocio" >250 chars puede truncar sin overflow a página 2 | `if (y > pageH - 40) doc.addPage()` |

**Faltantes/incompletos**:
- **Datos macro Colombia 2026** (salario mín, UVT, IPC, DTF) — pendiente conocido en memoria. Esfuerzo: S
- Comparativa sector aluminio — solo absolutas, sin benchmark. Esfuerzo: L (requiere tabla sector)
- Email compartición Informe Banco — solo descarga local. Esfuerzo: M (Resend está configurado)
- Charts en PDF — hoy solo tablas. Esfuerzo: M (html2canvas + jsPDF)

---

### 1.7 Operaciones (Facturas, Remisiones, Caja Menor, Inventarios)

**Resumen**: 4 submódulos auditados. **Crítico único**: factura permite descoherencia base+IVA≠total. **Altos**: stock negativo permitido, parse PDF stuck en timeout, tool_choice sin fallback en Gemini.

| Sev | Archivo:línea | Descripción | Fix sugerido |
|-----|---------------|-------------|--------------|
| Crítico | [InvoiceValidationForm.tsx:359-371](src/components/invoices/InvoiceValidationForm.tsx:359) | User puede setear `subtotal_base`, `iva_amount`, `total_amount` independientes — total guardado puede no coincidir con base+iva | Validar `total === base + iva − retenciones` ±1 COP en `handleConfirm` |
| Alto | [useInventoryData.ts:211-217](src/hooks/useInventoryData.ts:211) | `addMovement` resta sin validar — `newStock < 0` se guarda. Dos ventas concurrentes mismo producto = inconsistencia | Validar `newStock >= 0`; trigger DB |
| Alto | [InvoiceUploadModal.tsx:358-480](src/components/invoices/InvoiceUploadModal.tsx:358) | Si parse-invoice-pdf timeout (>3min poll), modal stuck, sin retry/feedback | Diferenciar timeout vs error parsing; botón Reintentar |
| Alto | [parse-invoice-pdf/index.ts:136-191](supabase/functions/parse-invoice-pdf/index.ts:136) | `tool_choice` fuerza function call; si Gemini responde solo en `content`, asume `toolCall.function.arguments` que es null | Validar `toolCall`; fallback a parse de `content` |
| Medio | [Remisiones.tsx:45-92](src/pages/Remisiones.tsx:45) | `calcScore()` asume `remision_invoices` existe — si join falla, lógica rota | `(remision.remision_invoices ?? []).map(...)` |
| Medio | [CajaMenor.tsx:41-50](src/pages/CajaMenor.tsx:41) | `handleDelete` sin reversa — si tx bancaria está vinculada, queda huérfana | Buscar `bank_transaction.petty_cash_movement_id` antes de delete |
| Medio | [useRemisionPaymentStatus.ts:46-59](src/hooks/useRemisionPaymentStatus.ts:46) | Tolerancia 0.01 COP en sum de pagos — con muchos pagos, error acumula >1 COP | Tolerancia ±1 COP, log si >1 |
| Medio | [Inventory.tsx:31-65](src/pages/Inventory.tsx:31) | Siigo sync no atómico — si insert ok pero recalc falla, productos sin costo | Transaction o flag `synced_cost = false` |
| Bajo | [InvoiceValidationForm.tsx:359-407](src/components/invoices/InvoiceValidationForm.tsx:359) | Inputs IVA/retenciones sin `max` — user puede tipear `999%` | `max="100"` y clamp |

**Faltantes/incompletos**:
- **Vincular abono parcial a factura** — modal existe pero no persiste. Esfuerzo: L
- **Cierre de caja menor** — sin botón de cierre/conciliación con saldo banco. Esfuerzo: M
- **Conversión remisión → factura nueva** — solo vincula existente. Esfuerzo: M

**Nota**: `InvoicesVenta.tsx`/`InvoicesCompra.tsx` son wrappers thin de `InvoiceListPage.tsx` — patrón correcto, no hay legacy muerto. `parse-invoice-pdf` usa Gemini OpenAI-compat correctamente (memoria validada).

---

### 1.8 Admin & IA (Colaboradores, Ajustes, Nico, Cartera Operativa, Reportes)

**Resumen**: Gerencial bien protegido (frontend + backend + RLS). **Crítico único**: invite-collaborator usa `onboarding@resend.dev` en lugar del dominio verificado, afectando deliverability.

| Sev | Archivo:línea | Descripción | Fix sugerido |
|-----|---------------|-------------|--------------|
| Crítico | [invite-collaborator/index.ts:138](supabase/functions/invite-collaborator/index.ts:138) | Email a usuarios existentes usa `onboarding@resend.dev` en lugar del dominio verificado — afecta deliverability | `RESEND_FROM_EMAIL` env o `invitaciones@aluminiapp.com` |
| Alto | [InviteCollaboratorModal.tsx:19-49](src/components/collaborators/InviteCollaboratorModal.tsx:19) | Presets cubren 3 roles pero módulos nuevos (caja_menor, remisiones, creditos, informe_dian, informe_banco) sin templates | Agregar "Contabilidad Completa", "Operaciones", "Reportería" |
| Alto | [useCollaborators.ts:54-74](src/hooks/useCollaborators.ts:54) | `DEFAULT_PERMISSIONS` define 6 módulos como 'none' pero edge function no valida valor del enum (acepta basura) | Validar `'none'\|'view'\|'edit'` en línea 117-120 de invite-collaborator |
| Medio | [Settings.tsx:240-254](src/pages/Settings.tsx:240) | Botón a `/pricing` sin feedback de carga ni verificación de subscription | Pre-check sub state, loading state |
| Medio | [NicoAgentChat.tsx:99-104](src/components/nico/NicoAgentChat.tsx:99) | Edge function `nico-chat` recibe `pageContext` sin validación de tamaño — tabla de 10k filas excede payload | Truncar a 50KB cliente; validar server |
| Bajo | [useModuleContext.tsx:28-31](src/hooks/useModuleContext.tsx:28) | Safety net correcto pero AppSidebar puede renderizar items gerenciales en fallback undefined | Verificar `isGerencial===false` antes de items |

**Faltantes/incompletos**:
- Días de mora en Cartera Operativa — feature roadmap. Esfuerzo: S
- Validación de enum de permisos en `invite-collaborator`. Esfuerzo: S

**Nota**: Cartera Operativa, Nico IA, Reportes funcionan sin críticos. Streaming Nico funcional, RLS por user_id correcto. Memoria validada: Resend configurado, Gerencial admin-only.

---

### 1.9 Cross-cutting

#### A. Backend Supabase

**Resumen**: 91 migraciones bien estructuradas. **Críticos**: 2 policies con `USING (true)` (RLS débil en user_subscriptions y macro_indicators). 8 CREATE TABLE sin `IF NOT EXISTS`.

| Sev | Archivo:línea | Descripción | Fix sugerido |
|-----|---------------|-------------|--------------|
| Crítico | [supabase/migrations/20260203184554_*.sql:42](supabase/migrations/20260203184554_0a5bd620-f18a-4055-8c1f-dbbd06e6bac3.sql:42) | Policy UPDATE en `user_subscriptions` con `USING (true)` — usuarios pueden actualizar suscripciones ajenas | `USING (auth.uid() = user_id)` |
| Crítico | [supabase/migrations/20260423140000_macro_indicators.sql:35](supabase/migrations/20260423140000_macro_indicators.sql:35) | Policy `USING (true)` en `macro_indicators` — leak entre users (si tabla tiene user_id) o exponer datos macro | Confirmar si datos son globales (read-only); si sí, dejar pero documentar |
| Alto | múltiples migrations | 8 CREATE TABLE sin `IF NOT EXISTS`: inventory_import_logs, nico_messages, financial_health_scores, profiles, bank_statements, transactions, inventory_products, invoices | Re-run en entorno nuevo fallará. Agregar `IF NOT EXISTS` |
| Alto | [supabase/config.toml](supabase/config.toml) | Los 27 edge functions con `verify_jwt = false` — auth manual en cada uno; auditar individual | Confirmar cada function valida `getUser(token)` o `x-cron-secret` |
| Medio | [supabase/migrations/20260302133612_*.sql](supabase/migrations/20260302133612_6b9a24ff-6329-4169-9ecd-e8e78efb80d1.sql) | `DELETE FROM` en migration dentro de function deleteUserData — destructivo en prod | Confirmar safe; usar `ON DELETE CASCADE` |

#### B. Frontend transversal

**Resumen**: ErrorBoundary a nivel root (bueno), Sentry inicializado, sin imports circulares ni links rotos. Múltiples `console.log` de debug olvidados sin condicional.

| Sev | Archivo:línea | Descripción | Fix sugerido |
|-----|---------------|-------------|--------------|
| Alto | [ProtectedRoute.tsx:20,58](src/components/ProtectedRoute.tsx:20) | `console.log('[AUTH] ProtectedRoute')` en cada render | Remover o `if (isDev)` |
| Alto | [CFOInsights.tsx:156,168](src/components/dashboard/CFOInsights.tsx:156) | `console.log('[CFOInsights] Fetching/Received...')` en useEffect | Remover o condicional |
| Alto | [SessionExpiredModal.tsx:52](src/components/auth/SessionExpiredModal.tsx:52) | `console.log('[AUTH] session_expired_modal_login')` sin condicional | Remover o condicional |
| Medio | [types/invoice.ts:39](src/types/invoice.ts:39) | `extracted_data: any \| null` — deserialización PDF AI sin tipo | Crear interface ExtractedInvoiceData |
| Medio | [InvoiceUploadModal.tsx:27](src/components/invoices/InvoiceUploadModal.tsx:27) | `mapExtracted(draft, ed: any)` — param sin tipo | Tipar desde invoice.ts |
| Medio | [DIANSummary.tsx:42,47](src/components/invoices/DIANSummary.tsx:42) | CustomTooltip con `payload: any` | `TooltipProps<number, string>` de recharts |
| Bajo | [InvoiceListPage.tsx:288,393,418](src/pages/InvoiceListPage.tsx:288) | console.error/warn con debug parcialmente justificado | Limpiar los que sean debug |

**Apéndices**:
- **Imports rotos/circulares**: ninguno detectado.
- **Links rotos**: todas las rutas navegadas existen en App.tsx.
- **TS errors nuevos** (fuera de los pre-existentes ignorados): ninguno detectado.
- **Tablas sin RLS**: ninguna detectada (todas las core tienen RLS habilitada).

---

## 2. Edge cases Supabase consolidados

### 2.1 Rate limits (Free tier — 60 req/s, 500MB DB, 1GB storage)
- **Dashboard**: `Promise.all` paralelo sin batching — riesgo en cuentas grandes. Considerar RPC functions o vistas materializadas.
- **applyRulesToAllUserTransactions**: 5000 tx × await secuencial = timeout navegador y rate limit DB.
- **Edge functions**: parse-bancolombia-csv puede tomar >30s; sin AbortController el cliente no sabe.

### 2.2 Sesión sin expiry nativo
- `useAuth.tsx` + `inactivityTracker.ts` 8h custom — funciona pero fail-open si localStorage corrupto.
- Refresh token errors no tienen handler explícito en signOut.

### 2.3 RLS
- **Dominante correcto**: `auth.uid() = user_id` en tablas core (transactions, invoices, credits, reconciliation_rules, profiles).
- **Gaps detectados**: `user_subscriptions` y `macro_indicators` con `USING (true)` (críticos arriba).
- **Sin gaps adicionales**: ninguna tabla core sin RLS habilitada.
- **Defensa en profundidad faltante**: `Transactions.tsx` confía 100% en RLS, sin `.eq('user_id', ...)` defensivo. Si una migration desactiva RLS por error, leak total.

### 2.4 Validaciones cliente vs server
- **Facturas**: validación de coherencia (base+iva=total) **solo cliente** — usuario malicioso o bug puede persistir descoherencia.
- **Inventarios**: `newStock >= 0` no validado ni cliente ni server — escenario de stock negativo posible.
- **Créditos**: validaciones de tasa/plazo razonables cliente; backend depende de constraints de DB no auditados.
- **Reglas reconciliación**: `category_id` puede quedar null en cliente, no validado en server.

### 2.5 Concurrencia
- **Stock**: dos ventas simultáneas mismo producto → inconsistencia. Necesita `SELECT FOR UPDATE` en RPC o trigger.
- **Reglas**: `applyRulesToStatement` no es atomic — si user A y user B aplican mismo set, posibles updates inconsistentes (mitigado por RLS pero no por orden).
- **Suscripciones**: `user_subscriptions` con USING(true) abre puerta a interferencia inter-user.

---

## 3. Fixes pendientes priorizados (impacto × esfuerzo)

| # | Fix | Impacto | Esfuerzo | Sprint |
|---|-----|---------|----------|--------|
| 1 | RLS `USING(true)` → `auth.uid()=user_id` (user_subscriptions, macro_indicators) | Crítico | S | Hoy |
| 2 | invite-collaborator usa dominio verificado (no resend.dev) | Crítico | S | Hoy |
| 3 | `Transactions.tsx:115` añadir `.eq('user_id')` defensivo | Crítico | S | Hoy |
| 4 | `StatementUpload.tsx:189` mover navigate a onSuccess | Crítico | S | Hoy |
| 5 | useReconciliationRules N+1 → bulk update | Crítico | M | Esta semana |
| 6 | parse-bancolombia-csv self-heal: comparar count exacto | Alto | S | Esta semana |
| 7 | InvoiceValidationForm: validar coherencia base+iva=total | Crítico | S | Esta semana |
| 8 | useInventoryData: validar `newStock >= 0` + trigger DB | Alto | M | Esta semana |
| 9 | useTransactionEdit: redondeo consistente retenciones | Crítico | S | Esta semana |
| 10 | UVT 2026 unificar constante (verificar valor oficial) | Crítico | S | Esta semana |
| 11 | Dashboard Promise.all: chequear error por query | Crítico | M | Sprint próximo |
| 12 | matchesRule normalizar acentos | Alto | S | Sprint próximo |
| 13 | Console.logs olvidados (ProtectedRoute, CFOInsights, SessionExpiredModal) | Alto | S | Sprint próximo |
| 14 | 8 CREATE TABLE sin IF NOT EXISTS | Alto | S | Sprint próximo |
| 15 | InvoiceUploadModal timeout differentiation | Alto | M | Sprint próximo |
| 16 | parse-invoice-pdf: fallback content si tool_call null | Alto | S | Sprint próximo |
| 17 | Inputs IVA/retenciones max=100 | Bajo | S | Cuando toque |
| 18 | jsPDF addFont helvetica | Bajo | S | Cuando toque |

**Bundle del día sugerido**: items 1-4 (todos S, todos críticos, todos defensivos) — un solo PR de RLS + email + filtro defensivo + race fix. ~1-2h de trabajo.

---

## 4. Módulos faltantes o incompletos

| # | Módulo | Por qué importa | Esfuerzo |
|---|--------|-----------------|----------|
| 1 | Datos macro 2026 (salario mín, UVT, IPC, DTF) en Informe Banco | Cliente entrega ratios al banco con números 2025 — riesgo reputacional | S |
| 2 | Cierre de caja menor (conciliación con banco) | Caja menor sin cierre = saldo no conciliable | M |
| 3 | Vincular abono parcial a factura | Cobranza incompleta sin parciales — bloquea PYG real | L |
| 4 | Conversión remisión → factura nueva | Hoy solo vincula existente — workflow incompleto | M |
| 5 | Detector de duplicados en upload extracto | User sube 2× = duplica todo | M |
| 6 | Comparativa sector aluminio en Informe Banco | Cliente real elogió este informe; falta benchmark | L |
| 7 | Email compartición Informe Banco/DIAN (Resend) | Cliente envía manual hoy — fricción | M |
| 8 | Charts (PNG) en PDFs | Hoy tablas crudas — banco prefiere visual | M |
| 9 | Paginación + búsqueda full-text + export CSV en Transacciones | Scaling >1000 tx/mes rompe UX | M |
| 10 | Modal "Cancelar crédito" | Sin handler claro — flujo incompleto | M |
| 11 | OAuth role-mapping post-signup | Admin no pre-asigna roles en invitaciones OAuth | M |
| 12 | Tests Vitest en edge functions Deno | Solo browser parsers cubiertos | M |
| 13 | Currency conversion en parsers (no solo COP) | Clientes con cuentas USD no soportados | M |
| 14 | A11y en charts (title, tabla alternativa) | Compliance básico | M |
| 15 | Mobile responsive <375px en Dashboard charts | UX degrada | S |

---

## 5. Apéndices

### 5.1 Imports rotos / circulares
Ninguno detectado. Imports relativos consistentes. Sin loops A↔B en `lib/` o componentes.

### 5.2 Botones sin handler / con TODO
Ninguno crítico detectado. Casos limítrofes (signOut error handler, paginación) cubiertos en sección 3.

### 5.3 Console errors / logs olvidados
- [ProtectedRoute.tsx:20,58](src/components/ProtectedRoute.tsx:20) — sin condicional
- [CFOInsights.tsx:156,168](src/components/dashboard/CFOInsights.tsx:156) — sin condicional
- [SessionExpiredModal.tsx:52](src/components/auth/SessionExpiredModal.tsx:52) — sin condicional
- [InvoiceListPage.tsx:288,393,418](src/pages/InvoiceListPage.tsx:288) — debug parcial dentro de error handling

### 5.4 useEffect sin cleanup
Sin hallazgos sistémicos. Casos puntuales:
- [Dashboard.tsx:252](src/pages/Dashboard.tsx:252) — deps incompletas
- [useTransactionEdit.ts:61](src/hooks/useTransactionEdit.ts:61) — solo `[id]`, ignora cambios externos

### 5.5 TS errors no pre-existentes
Ninguno detectado fuera de los 6 pre-existentes ignorados (PendingTransactionsTable, InvoiceUploadModal:35-36, PaymentsLogReport, useFinancialHealthScore, Dashboard:702, MaestroProductos).

### 5.6 Tablas sin RLS
Ninguna. Todas las tablas core tienen `ENABLE ROW LEVEL SECURITY`. Riesgo en `user_subscriptions` y `macro_indicators` no es por falta de RLS sino por policies con `USING (true)` (sección 1.9 críticos).

### 5.7 Notas operacionales
- **Audit estático** — no se ejecutó la app ni edge functions. Hallazgos son de lectura de código. Para confirmar bugs runtime (console errors, network races, memory leaks reales), correr la app con DevTools como segunda pasada.
- **Falsos positivos esperables**: agentes leen sin contexto completo, especialmente en componentes grandes (Dashboard 48KB, Remisiones 33KB). Spot-check abriendo archivo:línea antes de aplicar fix.
- **Memorias validadas en este audit**: Gerencial admin-only ✓, Resend dominio verificado (uso parcial — fix #2) ✓, parse-invoice-pdf con Gemini OpenAI-compat ✓, RLS con `auth.uid()=user_id` dominante ✓.
