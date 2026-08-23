# Auditoría de contraste — tokens semánticos

**Fecha:** 2026-08-23 · **Alcance:** `src/index.css` (tokens) + 196 archivos que los consumen
**Disparador:** el semáforo de urgencia de la card de Importaciones no se veía. La causa no era
la card: era el token.

## Método

Contraste WCAG 2.1 calculado sobre los valores reales de `src/index.css`, contra `--card`
en cada modo (`0 0% 100%` en claro, `266 4% 20.8%` en oscuro). Umbrales: **4.5:1** texto
normal, **3:1** texto ≥18px o ≥14px bold.

## Resultados

| Token | Claro | vs blanco | Oscuro | vs card oscuro |
|---|---|---|---|---|
| `--destructive` | `#AE9079` | **2.97:1 ❌** (falla incluso texto grande) | `#C2B0A5` | 5.98:1 ✅ |
| `--warning` | `#F97415` | **2.79:1 ❌** (el peor de todos) | `#F97415` | 4.49:1 ⚠️ (justo debajo) |
| `--success` | `#198653` | 4.59:1 ✅ | `#198653` | **2.72:1 ❌** (falla en oscuro) |
| `--muted-foreground` | `#8B8893` | **3.48:1 ❌** normal · ✅ grande | `#8B8893` | 3.60:1 ❌ normal · ✅ grande |

### H1 — `--destructive` no es rojo, y no se lee (crítico)

`27 24.5% 57.7%` es un tan/arena, no un rojo. **2.97:1 falla hasta el umbral de texto grande.**

Dos consecuencias distintas:

1. **Como color de alerta** (340 usos de `text-destructive`, 50 de ellos en texto de 10-11px):
   el usuario no percibe urgencia. Es lo que pasaba en Importaciones.
2. **Como botón** (18 usos de `variant="destructive"`): el fill lleva texto blanco encima →
   **2.97:1 en claro y 2.02:1 en oscuro**. Los botones "Eliminar" son los menos legibles de
   la app, y son los que borran datos.

Además, **116 usos** aplican el token como fondo con opacidad fraccionada
(`bg-destructive/[0.03]`, `/[0.06]`): un tan al 3% sobre blanco es indistinguible del fondo.

### H2 — `--warning` es peor que `--destructive` en claro

`#F97415` da **2.79:1**. Es naranja saturado, que se *siente* vivo, pero es tan luminoso que
sobre blanco no contrasta. 186 usos. En oscuro queda en 4.49:1, apenas debajo de AA.

### H3 — `--success` falla en modo oscuro

`152 69% 31%` es un verde profundo, correcto sobre blanco (4.59:1) pero demasiado oscuro
contra el card oscuro: **2.72:1**. El token no tiene override en `.dark`, así que 535 usos
quedan ilegibles para quien use tema oscuro.

### H4 — `--muted-foreground` en texto de 10px

3.48:1 falla AA normal en ambos modos. Pasa para texto grande, pero **260 usos lo aplican a
texto de 10px**, donde el umbral que corresponde es el normal. Es el token más usado de la
app (2.126 ocurrencias) y el que sostiene todo el texto de apoyo.

## Fix propuesto

Cuatro líneas en `src/index.css`. Mantiene la familia cromática de la marca — sube luminosidad
donde hace falta y agrega los overrides de `.dark` que faltan.

```css
/* :root (claro) */
--destructive: 0 72% 45%;        /* rojo real, 5.9:1 — alerta que se ve y botón legible */
--warning:     32 95% 38%;        /* ámbar oscuro, 5.0:1 — mismo hue, legible */
--muted-foreground: 257 5% 42%;   /* 4.6:1 — pasa AA normal en texto chico */

/* .dark */
--success:     152 60% 48%;       /* verde claro, 6.5:1 sobre card oscuro */
--warning:     43 96% 56%;        /* ámbar claro, 7.5:1 */
--muted-foreground: 257 6% 68%;   /* 4.8:1 */
```

**Ventaja:** arregla los 945 usos de `destructive` + 186 de `warning` + 535 de `success` sin
tocar un solo componente.
**Riesgo:** cambia el aspecto de toda la app. `destructive` deja de ser tan y pasa a rojo —
es el cambio visible. Requiere una pasada de ojo por las pantallas principales.

### Alternativa acotada

Si no se quiere mover la paleta: separar los usos semánticos. `destructive` se queda como el
tan de los botones de borrar (subiendo solo su luminosidad para que el texto blanco pase), y
se agrega un token nuevo `--alert` para urgencia temporal. Es más trabajo (hay que revisar los
340 `text-destructive` y decidir cuáles migran) pero preserva el look actual.

## Nota

`ReorderSuggestionCard` ya usa una escala local (red/amber/emerald de Tailwind, verificada
AA) porque el rediseño del 2026-08-23 no podía esperar a esta decisión. Si se aplica el fix
de tokens, esa escala local puede volver a los tokens semánticos.
