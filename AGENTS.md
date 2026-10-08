# AGENTS.md — AluminIA

Guía para agentes de código (Codex, Claude Code). Leela entera antes de cambiar algo.

## Qué es

SaaS financiero y operativo para distribuidoras de aluminio en Colombia: conciliación bancaria, facturas DIAN, cartera, inventario por variante, importaciones, créditos. Está en producción con clientes reales en https://aluminiapp.com. La marca se escribe **AluminIA** (IA en mayúsculas).

## Stack

- Vite 5 + React 18 + TypeScript 5 + Tailwind 3 + shadcn/ui (Radix) + Recharts 2 + TanStack Query 5.
- El cache de React Query se persiste en localStorage (sobrevive recargas y deploys).
- Backend: Supabase (Postgres con RLS + Edge Functions en Deno), proyecto `flmelenvmvhsogtzjjow`.
- Frontend en Vercel: team `mgn-aluminia`, proyecto `aluminiapp`, conectado a este repo.

## Cómo se despliega (automático)

- Push o merge a `main` → Vercel publica en producción (aluminiapp.com) en unos 2 minutos.
- Push de cualquier otra rama → Vercel genera una vista previa; el link aparece en el PR y en el estado del commit.
- `main` no tiene protección: un push directo sale a producción con clientes usándola. Para diseño: trabajar en una rama, revisar la vista previa con sesión iniciada, y recién después mergear.
- Supabase no se despliega con Vercel. Las migraciones (`supabase/migrations`) las aplica el dueño a mano y las edge functions se publican con `supabase functions deploy <nombre>`. Un cambio de diseño no debería tocar `supabase/`.

## Comandos

```bash
npm install
npm run dev            # http://localhost:8080
npx tsc --noEmit -p tsconfig.app.json
npm test               # vitest, ~570 pruebas
npm run build
```

Antes de mergear: `tsc` sin errores nuevos, pruebas en verde y build OK. Hay 3 errores de tipos pre-existentes que se ignoran: `PendingTransactionsTable.tsx(103)` y `useFinancialHealthScore.ts(65)` y `(167)`.

## Variables de entorno

`.env` está versionado y solo tiene las 4 claves públicas del cliente (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`, `VITE_TURNSTILE_SITE_KEY`), que igual viajan en el bundle. **El repo es público: nunca commitear claves privadas** (service_role de Supabase, Anthropic, Gemini, Resend, Wompi, Siigo). Esas viven en los secrets de Supabase.

## Dónde vive el diseño

- Tokens: `src/index.css` (variables CSS de claro y oscuro; el modo oscuro es la clase `.dark` en `<html>`) y `tailwind.config.ts`.
- Primitivas: `src/components/ui` (shadcn).
- Estructura: `src/components/layout` (AppLayout, AppSidebar, AppHeader, MobileNav).
- Kit del Dashboard: `src/components/dashboard/cardKit.tsx` (tarjetas, filas en dos líneas, píldoras de urgencia) y `chartKit.tsx` (cromado de gráficas y tabla gemela "Ver como tabla").
- Colores de gráficas: tokens `--viz-*` en `src/index.css` y roles en `src/lib/chartColors.ts`. La paleta está validada para daltonismo y contraste; no cambiar colores de gráficas a ojo.
- Páginas: `src/pages`.

## Reglas

- Textos en español de Colombia con voseo ("Cargá", "Subí", "Revisá"), como el resto de la app.
- Diseño es presentación. No cambiar lógica de negocio en `src/lib` (cartera, IVA, inventario, costeo de importaciones, créditos: tienen pruebas y cifras auditadas con el dueño) ni hooks de datos en `src/hooks`, salvo que se pida explícitamente.
- No tocar `src/integrations/supabase/types.ts` (generado), `supabase/migrations` ni `supabase/functions`.
- Nunca guardar `Map` o `Set` en datos de React Query: el cache persistido es JSON y la app se rompe al recargar. Usar arrays u objetos planos.
- Texto mínimo de 12px en la UI. Números de tablas con `tabular-nums`.
- Cada cambio visual se revisa en claro y en oscuro, y a 4 columnas del Dashboard (tarjetas de ~300px), que es donde más se aprieta el texto.
- La app exige login. Para revisar sin credenciales: montar el componente con datos de muestra en una página temporal servida por `npm run dev`, envuelta en `QueryClientProvider` + `AuthProvider` (de `src/hooks/useAuth`) + `MemoryRouter`, y borrarla antes de commitear. Si el navegador no dispara `requestAnimationFrame`, Recharts deja las barras en cero.
- Commits en español explicando el porqué. Cambios chicos y agrupados: el dueño opera la app en vivo y cada deploy recarga a todos los usuarios.
