
# Plan de Lanzamiento: AluminIA

## Estado Actual

La aplicación tiene una base sólida con la mayoría de funcionalidades core implementadas:

| Área | Estado |
|------|--------|
| Autenticación | ✅ Completo (login, registro, recuperación de contraseña) |
| Páginas legales | ✅ Completo (términos, privacidad, contacto) |
| SEO y metadatos | ✅ Completo (OpenGraph, Twitter Cards, robots.txt) |
| Flujo principal | ✅ Completo (subir PDF → transacciones → dashboard → exportar) |
| Suscripciones Stripe | ✅ Completo (checkout, portal, verificación) |
| Página de ajustes | ✅ Completo (cuenta, empresa, seguridad) |
| Edge Functions | ✅ 5 desplegadas y funcionando |

---

## Pendientes Críticos

### ✅ 1. Protección de Contraseñas Filtradas
**Estado**: COMPLETADO
La protección contra contraseñas comprometidas está habilitada.

### ✅ 2. Formulario de Contacto Funcional
**Estado**: COMPLETADO
- Tabla `contact_messages` creada en la base de datos
- Edge function `send-contact` desplegada
- Formulario `/contact` conectado al backend real

### ⏳ 3. Dominio Personalizado
**Estado**: PENDIENTE (requiere acción del usuario)

**Acción requerida**: 
1. Registrar dominio `aluminia.app`
2. Ir a Settings → Domains en Lovable
3. Agregar el dominio y seguir instrucciones DNS:
   - A record para `@` apuntando a `185.158.133.1`
   - A record para `www` apuntando a `185.158.133.1`
   - TXT record `_lovable` con el valor proporcionado

---

## Mejoras Completadas

### ✅ 4. Imagen OpenGraph en formato PNG
- Nueva imagen `og-image.png` generada (1200×630px)
- Referencias actualizadas en `index.html`

### ✅ 5. Favicon Actualizado
- Nuevo `favicon.png` con el logo de AluminIA
- Referencia actualizada en `index.html`

---

## Checklist de Publicación

```text
+----------------------------------------------------+
|              ANTES DE PUBLICAR                     |
+----------------------------------------------------+
| [x] Rutas protegidas funcionando                   |
| [x] Flujo de pago Stripe configurado               |
| [x] Páginas legales (términos, privacidad)         |
| [x] Página de contacto funcional                   |
| [x] Página de precios                              |
| [x] SEO básico configurado                         |
| [x] robots.txt configurado                         |
| [x] Protección de contraseñas filtradas            |
| [x] Formulario de contacto funcional               |
| [x] Imagen OG en PNG                               |
| [x] Favicon actualizado                            |
| [ ] Dominio personalizado (acción del usuario)     |
+----------------------------------------------------+
|              DESPUÉS DE PUBLICAR                   |
+----------------------------------------------------+
| [ ] Probar flujo completo en producción            |
| [ ] Verificar emails de Stripe funcionando         |
| [ ] Verificar OG image en redes sociales           |
+----------------------------------------------------+
```

---

## Próximo Paso

**El único pendiente crítico es configurar el dominio `aluminia.app`.**

Una vez configurado el dominio:
1. Publicar la app
2. Invitar usuarios beta
3. Comenzar difusión
