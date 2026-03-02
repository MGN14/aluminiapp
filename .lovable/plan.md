

# Auditoria de Planes: Huecos Encontrados

Tras revisar minuciosamente cada feature prometida contra la implementacion real, encontre los siguientes problemas:

---

## HUECOS CRITICOS

### 1. Coach financiero (Nico) NO esta restringido por plan
- **Promesa**: Basico promete "Analisis financiero con IA" y Empresarial promete "Coach financiero con IA" y "Reportes avanzados con IA"
- **Realidad**: Nico (`/nico`) esta disponible para TODOS los usuarios sin ninguna restriccion de plan. Un usuario Demo o con trial expirado puede usar Nico igual que uno Empresarial.
- **Tu pedido**: Agregar "Coach financiero" al plan Basico tambien. Si ambos planes (Basico y Empresarial) lo incluyen, entonces se debe bloquear para Demo y trial expirado.
- **Accion**: Agregar gate en `/nico` que bloquee acceso a usuarios Demo (trial expirado). Usuarios en trial activo, Basico y Empresarial si pueden acceder.

### 2. Reportes (`/reports`) NO esta restringido por plan
- **Promesa**: Solo Empresarial promete "Reportes avanzados con IA"
- **Realidad**: La pagina de Reportes (PyG) esta abierta para todos los planes sin restriccion.
- **Accion**: Si Reportes es exclusivo de Empresarial, agregar gate. Si Basico tambien debe tener un reporte basico, definir la diferencia.

### 3. Historial de 2 anos del plan Basico NO se aplica
- **Promesa**: Basico tiene "Historial hasta 2 anos"
- **Realidad**: `historyMonths` esta definido como `6` en `getPlanLimits()` para Basico (6 meses, no 24). Ademas, este valor **nunca se usa en ningun componente** para filtrar datos. Es un numero muerto.
- **Accion**: Cambiar `historyMonths` a `24` para Basico y realmente implementar el filtro en las queries de transacciones/dashboard.

### 4. Limite de PDFs del Basico: dice 2 pero aplica 10
- **Promesa**: Basico promete "2 PDFs mensuales"
- **Realidad**: `getPlanLimits()` retorna `pdfLimit: 10` para Basico.
- **Accion**: Cambiar a `pdfLimit: 2` para alinear con lo prometido, o actualizar el texto del plan.

### 5. Plan "pro" fantasma en el codigo
- **Realidad**: El codigo tiene un plan `pro` con `pdfLimit: -1, bankAccounts: 2` que no existe en la pagina de pricing. El modulo de Facturas DIAN verifica `isPro = plan === 'pro'` como condicion de acceso.
- **Problema**: Si un usuario tiene plan `basico` en la BD, NO puede ver Facturas DIAN porque `isPro` no incluye `basico`. Esto es correcto segun los planes (Facturas DIAN es solo Empresarial), pero el plan `pro` deberia limpiarse del codigo ya que no se vende.
- **Accion**: Reemplazar la logica `isPro` por `isEmpresarial` que incluya `empresarial` y `admin`. El plan `basico` NO debe tener acceso a Facturas DIAN segun la promesa.

### 6. Exportacion a Excel NO esta restringida
- **Promesa**: Demo incluye "Exportacion a Excel", Basico tambien. Ambos la tienen.
- **Realidad**: `/export` esta abierto para todos. Esto esta CORRECTO ya que ambos planes pagados y Demo la incluyen.
- **Estado**: OK (no hay hueco).

### 7. Cuentas bancarias: Empresarial dice 2 pero codigo dice 3
- **Promesa**: Empresarial promete "Hasta 2 cuentas bancarias"
- **Realidad**: `getPlanLimits()` retorna `bankAccounts: 3` para Empresarial.
- **Accion**: Cambiar a `bankAccounts: 2`, o ademas el limite nunca se verifica al subir extractos.

### 8. Limite de cuentas bancarias NUNCA se verifica
- **Promesa**: Demo = 1 cuenta, Basico = 1 cuenta, Empresarial = 2 cuentas
- **Realidad**: El valor `bankAccounts` se define en `getPlanLimits()` pero **no se usa en ningun lugar** del codigo para bloquear uploads de diferentes cuentas.
- **Accion**: Implementar verificacion real al subir extracto, contando cuentas bancarias distintas (`account_number`) del usuario.

---

## RESUMEN DE ACCIONES

| # | Problema | Severidad | Accion |
|---|---------|-----------|--------|
| 1 | Nico sin restriccion de plan | Alta | Gate para Demo/trial expirado |
| 2 | Reportes sin restriccion | Media | Gate para planes que no lo incluyen |
| 3 | Historial Basico: 6 meses en vez de 24 | Alta | Corregir a 24 y aplicar filtro |
| 4 | PDF limit Basico: 10 en vez de 2 | Alta | Corregir a 2 |
| 5 | Plan "pro" fantasma | Media | Limpiar, usar solo demo/basico/empresarial |
| 6 | Exportacion Excel | N/A | OK, sin hueco |
| 7 | Cuentas bancarias Empresarial: 3 en vez de 2 | Media | Corregir a 2 |
| 8 | Limite cuentas bancarias no verificado | Alta | Implementar verificacion real |

---

## PLAN DE IMPLEMENTACION

### Paso 1: Corregir `getPlanLimits()` en `useSubscription.tsx`
- Basico: `pdfLimit: 2`, `historyMonths: 24`, `bankAccounts: 1`
- Empresarial: `bankAccounts: 2`
- Eliminar caso `pro` (o mapearlo a `empresarial`)

### Paso 2: Agregar gate a Nico (`/nico`)
- Bloquear acceso si `trialExpired` y plan es `demo`
- Mostrar pantalla de upgrade similar a la de Facturas DIAN

### Paso 3: Agregar gate a Reportes (`/reports`)
- Si "Reportes avanzados con IA" es solo Empresarial, restringir
- Si quieres un reporte basico para Basico, definir cuales

### Paso 4: Limpiar referencia a plan "pro"
- En `Invoices.tsx`: cambiar `isPro` a verificar `empresarial || admin`
- En `PlanStatusCard.tsx`: eliminar caso `pro`
- En `useSubscription.tsx`: eliminar o mapear `pro` a `empresarial`

### Paso 5: Implementar historyMonths como filtro real
- Aplicar filtro de fecha en queries de transacciones para plan Basico (ultimos 24 meses)

### Paso 6: Implementar verificacion de cuentas bancarias
- Al subir extracto, contar `account_number` distintos del usuario y comparar con limite

### Paso 7: Agregar "Coach financiero con IA" al plan Basico
- Actualizar `pricingPlans.ts` para incluir esta feature en el plan Basico

