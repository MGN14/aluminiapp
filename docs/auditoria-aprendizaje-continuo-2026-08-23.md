# Auditoría — aprendizaje continuo y el puente conciliación → recordatorios

**Fecha:** 2026-08-23
**Pregunta que la origina:** ¿la app aprende sola (Nico, reglas, importaciones, alertas,
recordatorios)? ¿Se pueden alimentar los recordatorios con la realidad del negocio que
sale de la conciliación bancaria?

**Respuesta corta:** cuatro de los cinco sistemas aprenden solos y están vivos. El quinto
—recordatorios— es el único que **no aprende nada**: muestra un calendario fiscal fijo. Y el
puente que se pregunta **ya está construido a medias**: el motor que detecta patrones desde
las transacciones existe, calcula predicciones de próxima ocurrencia, y las guarda. Nadie las
muestra. Falta cablear ~200 líneas, no construir un sistema.

---

## 1. Veredicto por sistema

| Sistema | Aprende | Estado |
|---|---|---|
| **Nico IA** | Lecciones 👍 + RAG semántico + evolución de prompt | ✅ Vivo, con cron |
| **Reglas de conciliación** | Sugiere reglas desde patrones e historial; retro-aplica | ✅ Vivo |
| **Importaciones** | Lead times medidos reemplazan defaults por etapa | ✅ Vivo |
| **Alertas** | Umbrales sobre datos reales (no aprenden, pero se recalculan) | ✅ Vivo |
| **Recordatorios** | **Nada.** Calendario DIAN fijo + obligaciones digitadas a mano | ❌ **Hueco** |
| *(motor de patrones)* | Detecta recurrencias y predice fechas | ⚠️ **Vivo pero huérfano** |

---

## 2. Detalle de lo que sí aprende

### Nico IA — tres capas
- `nico_lessons`: cada 👍 destila pregunta/respuesta; el top-10 por `agent_key` entra al system
  prompt. **Colectivas** — lo que aprende con un usuario sirve a todos.
- `nico_knowledge_chunks`: RAG semántico con embeddings Voyage-3 (1024d).
- `nico_prompt_versions`: `nico-prompt-evolution` reescribe el prompt periódicamente (con cron).

### Reglas de conciliación
`reconciliation_rules` + sugerencias desde `business_patterns` e historial
(`conciliacionHistorial.ts`): chips de un clic, alertas con umbral (≥4 casos o ≥75% de
coincidencia), y **retro-aplicación** al abrir. Al crear una regla desde un patrón, ese patrón
se archiva (`status='archived'`) para no volver a sugerirlo. El ciclo cierra bien.

### Importaciones
`reorderSuggestion.ts` mide cada etapa (producción, tránsito, nacionalización) desde las fechas
reales de los pedidos. Cada etapa lleva `fuente: 'medido' | 'default'` y `n` (muestras): apenas
un pedido completa una etapa, **el promedio medido reemplaza el default solo**. `tieneDefaults`
avisa mientras alguna siga estimada. Igual con `diasCotizacion`.

### Alertas
No "aprenden" en sentido estricto — recalculan sobre datos frescos: faltantes/alertas/huecos del
radar de cobertura, huecos de extracto (`statementGaps`), brecha de evasión, inconsistencias de
conciliación. Correcto así.

---

## 3. El hueco: recordatorios

`UpcomingObligationsCard` (Dashboard) arma su lista de **cuatro fuentes, todas fijas o manuales**:

1. Calendario DIAN 2026 hardcoded (`dianCalendar2026.ts`) según dígito de NIT y config fiscal
2. `business_obligations` — obligaciones **digitadas a mano** (nómina, arriendo, parafiscales…)
3. Cuotas de créditos
4. ETAs de importaciones

**Ninguna sale de la conciliación.** Si el arriendo se paga todos los 5 y eso está conciliado y
categorizado hace ocho meses, la app no lo sabe: Nico tiene que digitarlo como obligación manual.

## 4. Lo que ya existe y nadie usa

`update-business-memory` (edge function) hace **exactamente** lo que se pregunta:

- Agrupa transacciones y facturas recurrentes → detecta `frequency_days`, `amount_min/max`,
  `last_occurrence`, `occurrences`, `confidence` → guarda en `business_patterns` (top 30).
- **Calcula predicciones**: para patrones con ≥3 ocurrencias, frecuencia > 0 y confianza ≥ 0.3,
  proyecta la próxima fecha y la guarda en `business_memory.metric_key='predictions'`
  (ventana −7 a +45 días, top 10, ordenadas por proximidad).

Tres problemas la dejan huérfana:

**P1 — No hay cron.** La función se dispara **solo desde el Dashboard**
(`InsightsMiniCards.tsx:98`). Si no abrís el Dashboard, patrones y predicciones se quedan viejos.
Es la única función de su clase sin `x-cron-secret` (las otras diez sí lo tienen).

**P2 — Las predicciones no tienen UI.** Solo las leen `nico-chat` y `cfo-insights`. O sea: el
dato existe, es correcto, y muere en la base salvo que le preguntes a Nico.

**P3 — El detector ignora la conciliación.** Agrupa por **las primeras 4 palabras de la
descripción cruda del banco**:

```js
const words = desc.split(/\s+/).slice(0, 4).join(" ");
const groupKey = `${t.type || "unknown"}_${words}`;
```

…aunque el `select` ya trae `category_id`, `responsible_id` y `categories.name`. La curaduría que
Nico hace a mano en Conciliación —categoría, beneficiario, naturaleza— **está disponible y no se
usa para agrupar**. Consecuencias:

- Dos pagos del mismo arriendo con referencia distinta caen en grupos distintos → no se detecta
  la recurrencia.
- Traspasos y préstamos (`movement_nature`) contaminan los patrones: no se filtran.
- `entities` se llena con el beneficiario pero **después** de agrupar, así que no ayuda.

Esta es la respuesta técnica a la pregunta: **la conciliación ya es la fuente de verdad del
negocio; el detector simplemente no la lee.**

---

## 5. Plan para Fable

Cuatro fases independientes, cada una entregable sola. F1 y F2 dan el 80% del valor.

### F1 — Que el detector use la conciliación (backend, sin UI) · ~1 día

En `supabase/functions/update-business-memory/index.ts`:

1. **Cambiar la llave de agrupación**: preferir `category_id + responsible_id` cuando ambos
   existan; caer a las 4 palabras solo si la transacción no está categorizada. Un patrón
   agrupado por "Arriendo · Inmobiliaria XYZ" es infinitamente más sólido que uno por texto.
2. **Filtrar por naturaleza**: excluir `movement_nature` no operativo (traspasos, préstamos,
   aportes) — mismo criterio que `isOperativo` en `types/transaction.ts`. Reusar, no reescribir.
3. **Guardar la procedencia** en el patrón: `source: 'conciliado' | 'texto'` y la confianza
   más alta para los conciliados. Requiere una columna nueva en `business_patterns` (o meterlo
   en `entities`/jsonb si se prefiere no migrar).
4. **Cron**: agregar `x-cron-secret` copiando el patrón de `sync-macro-indicators`, y programar
   diario 6am. Dejar el disparo desde el Dashboard como está (no molesta).

**Verificación:** con datos reales de MGN, los patrones detectados deberían pasar de agrupados
por texto de banco a agrupados por categoría/beneficiario. Comparar el antes/después del conteo
y revisar a ojo que "arriendo", "nómina", "parafiscales" aparezcan como patrones únicos.

### F2 — Recordatorios que salen del negocio real (UI) · ~1-2 días

1. **Hook `usePredictedObligations`**: lee `business_memory.predictions`, mapea cada predicción a
   la forma de `CalendarEvent` de `useUpcomingObligations` (tipo nuevo: `'predicho'`).
2. **Unificar en `useUpcomingObligations`**: los eventos predichos entran al mismo stream que
   DIAN, obligaciones manuales, créditos e importaciones. Ordenados por fecha, como ya están.
3. **Distinguirlos visualmente** en `UpcomingObligationsCard`: badge "estimado" + confianza
   ("se repitió 8 veces, cada ~30d"). Nunca mezclar un predicho con una fecha DIAN sin marcarlo:
   una es ley, la otra es estadística.
4. **Deduplicar contra las manuales**: si ya existe una `business_obligation` que coincide en
   categoría/beneficiario, el predicho no se muestra (o se muestra como confirmación del monto).

**Verificación:** el arriendo de MGN debería aparecer solo en el Dashboard, con su monto
promedio y su fecha estimada, sin que nadie lo digite.

### F3 — Cerrar el ciclo de feedback · ~1 día

Un predicho es una hipótesis. Que el usuario pueda:
- **"Sí, es fijo"** → crea la `business_obligation` real con los datos del patrón (un clic
  reemplaza el formulario). El patrón pasa a `status='confirmed'`.
- **"No, ignoralo"** → `status='dismissed'`, no vuelve a proponerse.

Es el mismo patrón de las reglas sugeridas de conciliación, que ya funciona: copiar de
`useReconciliationRules.createRule` (archiva el patrón fuente al crear la regla).

### F4 — Nico proactivo · ~medio día

`nico-chat` ya lee `predictions`. Con F1-F3, el reporte semanal del lunes puede abrir con
"esta semana te caen ~$X en gastos recurrentes" y cruzarlo contra la posición de caja
(`cash_position` del MCP). Es cablear, no construir.

---

## 6. Riesgos

- **Falsos positivos.** Tres ocurrencias no son un patrón fijo. Los umbrales actuales
  (`occurrences>=3`, `confidence>=0.3`) son laxos para mostrarlos como recordatorio en el
  Dashboard. Recomendación: subir a `>=4` y `>=0.5` **solo para lo que se muestra**, dejando el
  umbral bajo para Nico y cfo-insights.
- **Ruido en el Dashboard.** El card ya compite con muchos otros. Máximo 3 predichos,
  colapsables.
- **No inventar obligaciones fiscales.** Un predicho jamás debe presentarse como vencimiento
  DIAN. Badge distinto, sección distinta si hace falta.

---

## 7. Referencias

| Qué | Dónde |
|---|---|
| Motor de patrones + predicciones | `supabase/functions/update-business-memory/index.ts` (detección ~L190-330, predicciones L345-380) |
| Único disparo hoy | `src/components/dashboard/InsightsMiniCards.tsx:98` |
| Recordatorios actuales | `src/hooks/useUpcomingObligations.ts`, `src/components/dashboard/UpcomingObligationsCard.tsx` |
| Obligaciones manuales | `src/hooks/useBusinessObligations.ts` |
| Patrón de feedback a copiar | `src/hooks/useReconciliationRules.ts:105-130` |
| Naturaleza operativa | `src/types/transaction.ts` (`isOperativo`) |
| Patrón de cron | `supabase/functions/sync-macro-indicators`, ver memoria `project_cron_pattern` |
