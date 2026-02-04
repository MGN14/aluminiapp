

# Plan de Lanzamiento: AluminIA

## Estado Actual

La aplicación tiene una base sólida con la mayoría de funcionalidades core implementadas:

| Área | Estado |
|------|--------|
| Autenticación | Completo (login, registro, recuperación de contraseña) |
| Páginas legales | Completo (términos, privacidad, contacto) |
| SEO y metadatos | Completo (OpenGraph, Twitter Cards, robots.txt) |
| Flujo principal | Completo (subir PDF → transacciones → dashboard → exportar) |
| Suscripciones Stripe | Completo (checkout, portal, verificación) |
| Página de ajustes | Completo (cuenta, empresa, seguridad) |
| Edge Functions | 4 desplegadas y funcionando |

---

## Pendientes Críticos (Bloquean Lanzamiento)

### 1. Habilitar Protección de Contraseñas Filtradas
El linter de seguridad detectó que la protección contra contraseñas comprometidas está deshabilitada. Esto es importante para usuarios B2B.

**Acción**: Habilitar "Leaked password protection" en la configuración de autenticación.

### 2. Formulario de Contacto No Funcional
El formulario de `/contact` simula el envío pero no envía realmente los mensajes.

**Acción**: Crear edge function `send-contact` que envíe emails reales (usando Resend o guardando en base de datos).

### 3. Dominio Personalizado
El index.html tiene `https://aluminia.app` como dominio canónico, pero aún no está configurado.

**Acción**: 
- Registrar dominio `aluminia.app`
- Configurarlo en Lovable (Settings → Domains)

---

## Pendientes Recomendados (No Bloquean, Pero Mejoran)

### 4. Imagen OpenGraph en formato PNG
La imagen OG actual es un SVG, que no todos los servicios procesan correctamente.

**Acción**: Convertir `og-image.svg` a `og-image.png` (1200×630px) y actualizar referencias.

### 5. Favicon Actualizado
Actualmente usa un favicon genérico. Debería reflejar el logo de AluminIA.

**Acción**: Generar favicon desde el nuevo logo/avatar.

### 6. Email de Bienvenida
Los nuevos usuarios no reciben confirmación de registro.

**Acción**: Personalizar la plantilla de email de confirmación con branding de AluminIA.

### 7. Google Analytics / Métricas
Sin tracking de usuario para medir adopción.

**Acción**: Agregar Google Analytics 4 o Plausible para analytics básicos.

---

## Checklist de Publicación

```text
+----------------------------------------------------+
|              ANTES DE PUBLICAR                     |
+----------------------------------------------------+
| [x] Rutas protegidas funcionando                   |
| [x] Flujo de pago Stripe configurado               |
| [x] Páginas legales (términos, privacidad)         |
| [x] Página de contacto                             |
| [x] Página de precios                              |
| [x] SEO básico configurado                         |
| [x] robots.txt configurado                         |
| [ ] Protección de contraseñas filtradas            |
| [ ] Formulario de contacto funcional               |
| [ ] Dominio personalizado                          |
+----------------------------------------------------+
|              DESPUÉS DE PUBLICAR                   |
+----------------------------------------------------+
| [ ] Probar flujo completo en producción            |
| [ ] Verificar emails de Stripe funcionando         |
| [ ] Verificar OG image en redes sociales           |
+----------------------------------------------------+
```

---

## Plan de Difusión (Post-Publicación)

### Semana 1: Lanzamiento Suave
1. **Publicar la app** con el dominio configurado
2. **Invitar 5-10 usuarios beta** (empresarios de confianza)
3. Recopilar feedback inicial

### Semana 2-3: Iteración
1. Corregir bugs reportados
2. Agregar testimonios reales a `/login`
3. Crear contenido para redes

### Mes 1: Difusión
1. **LinkedIn**: Posts sobre el problema que resuelve AluminIA
2. **Grupos de empresarios**: Foros de PyMEs colombianas
3. **WhatsApp Business**: Canal de soporte y novedades

---

## Implementación Técnica

### Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| Configuración Auth | Habilitar leaked password protection |
| `supabase/functions/send-contact/index.ts` | Nueva edge function para emails |
| `src/pages/Contact.tsx` | Conectar al edge function real |
| `index.html` | Cambiar og-image.svg → og-image.png |
| `public/og-image.png` | Nueva imagen rasterizada |
| `public/favicon.ico` | Nuevo favicon con logo AluminIA |

### Configuración Externa

1. **Dominio**: Registrar aluminia.app y apuntar DNS
2. **Stripe Portal**: Verificar que esté activo en modo producción
3. **Supabase Auth**: Habilitar protección de contraseñas

---

## Resumen Ejecutivo

| Esfuerzo | Tiempo Estimado |
|----------|-----------------|
| Pendientes críticos | 1-2 horas de desarrollo |
| Dominio | 24-48 horas (propagación DNS) |
| Pendientes recomendados | 2-3 horas adicionales |

**La app está lista al 90%.** Los pendientes críticos son menores y pueden completarse en una sesión de trabajo. Una vez configurado el dominio, puedes comenzar a difundir.

