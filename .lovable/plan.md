
# Plan: Rol de Administrador / Usuario Interno

## Resumen
Crear un sistema de roles que permita a usuarios "admin" acceder a todas las funcionalidades sin límites de PDFs y sin requerir suscripción de Stripe. El rol se almacenará en una tabla separada siguiendo las mejores prácticas de seguridad.

---

## Cambios Requeridos

### 1. Base de Datos

**Crear tabla `user_roles`** con función de verificación segura:

```sql
-- Crear tipo enum para roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Tabla de roles (separada de profiles por seguridad)
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Habilitar RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Política: usuarios solo pueden ver su propio rol
CREATE POLICY "Users can view own role" 
ON public.user_roles FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

-- Función SECURITY DEFINER para verificar rol (evita recursión RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Función para verificar si es admin
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'admin'
  )
$$;
```

**Actualizar función `check_pdf_upload_limit`** para ignorar límites si es admin:

```sql
CREATE OR REPLACE FUNCTION public.check_pdf_upload_limit(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription RECORD;
  v_is_admin BOOLEAN;
  v_can_upload BOOLEAN;
  v_limit INTEGER;
  v_used INTEGER;
  v_message TEXT;
  v_plan TEXT;
BEGIN
  -- Verificar si es admin primero
  v_is_admin := public.is_admin(p_user_id);
  
  IF v_is_admin THEN
    -- Admins tienen acceso ilimitado
    RETURN json_build_object(
      'can_upload', true,
      'plan', 'admin',
      'limit', -1,
      'used', 0,
      'message', '',
      'status', 'active',
      'is_admin', true
    );
  END IF;
  
  -- Lógica normal para usuarios regulares...
  -- (resto del código existente)
END;
$$;
```

---

### 2. Edge Function: `check-subscription`

Modificar para detectar admins y retornar plan especial:

```typescript
// Después de autenticar usuario, verificar si es admin
const { data: isAdmin } = await supabaseClient
  .rpc("is_admin", { _user_id: user.id });

if (isAdmin) {
  logStep("User is admin, bypassing Stripe check");
  return new Response(JSON.stringify({
    subscribed: true,
    plan: "admin",
    status: "active",
    is_admin: true,
    pdf_uploads_total: 0,
    pdf_uploads_this_month: 0,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
}

// Continuar con lógica normal de Stripe para no-admins...
```

---

### 3. Frontend: Hook `useSubscription`

Agregar tipo `admin` y estado `isAdmin`:

```typescript
// Actualizar tipos
export type SubscriptionPlan = 'demo' | 'basico' | 'empresarial' | 'admin';

interface SubscriptionState {
  plan: SubscriptionPlan;
  isAdmin: boolean;  // Nuevo campo
  // ... resto igual
}

// En checkSubscription, manejar respuesta admin
setState({
  plan: data.plan || 'demo',
  isAdmin: data.is_admin || false,
  // ...
});

// En getPlanLimits, agregar caso admin
case 'admin':
  return { pdfLimit: -1, bankAccounts: -1, historyMonths: null }; // Sin límites
```

---

### 4. Componentes UI

**PlanBadge.tsx** - Agregar configuración para admin:

```typescript
const config = {
  // ... existentes
  admin: {
    label: 'Enterprise (Internal)',
    icon: Shield,
    variant: 'default' as const,
    className: 'bg-purple-600 text-white',
  },
};
```

**PlanStatusCard.tsx** - Mostrar info especial para admin:

```typescript
const planConfigs = {
  // ... existentes
  admin: {
    name: 'Enterprise (Internal)',
    description: 'Acceso completo sin límites',
    icon: Shield,
    features: ['PDFs ilimitados', 'Todas las funcionalidades'],
  },
};

// No mostrar botón "Gestionar" para admins (no tienen Stripe)
// No mostrar "Actualizar plan" para admins
```

---

### 5. Seguridad

- El rol `admin` NO será seleccionable desde la UI
- Solo asignable manualmente via SQL:
  ```sql
  INSERT INTO user_roles (user_id, role) 
  VALUES ('uuid-del-usuario', 'admin');
  ```
- La verificación es server-side (función SECURITY DEFINER)
- Los usuarios normales no pueden ver/modificar roles de otros

---

## Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| Nueva migración SQL | Crear tabla `user_roles` + funciones |
| `supabase/functions/check-subscription/index.ts` | Detectar admins antes de consultar Stripe |
| `supabase/functions/parse-bancolombia-pdf/index.ts` | Ya usa `check_pdf_upload_limit`, se beneficia automáticamente |
| `src/hooks/useSubscription.tsx` | Agregar tipo `admin` e `isAdmin` al estado |
| `src/components/subscription/PlanBadge.tsx` | Agregar estilo para plan `admin` |
| `src/components/subscription/PlanStatusCard.tsx` | Agregar configuración para `admin` |

---

## Flujo de Verificación

```text
+------------------+
|  Usuario carga   |
|    Dashboard     |
+--------+---------+
         |
         v
+--------+---------+
| check-subscription|
|   Edge Function   |
+--------+---------+
         |
         v
+--------+---------+
|  is_admin(uid)?  |
+--------+---------+
    |         |
   YES        NO
    |         |
    v         v
+-------+  +------------------+
| Plan: |  | Consultar Stripe |
| admin |  | y user_subs      |
+-------+  +------------------+
```

---

## Sección Técnica

### Base de Datos
- Tabla `user_roles` con RLS habilitado
- Función `is_admin()` SECURITY DEFINER para evitar recursión RLS
- Función `check_pdf_upload_limit()` actualizada para bypass de admins

### Edge Functions
- `check-subscription`: Consulta `is_admin()` ANTES de consultar Stripe
- `parse-bancolombia-pdf`: Sin cambios directos (usa `check_pdf_upload_limit`)

### Frontend
- Nuevo tipo de plan `'admin'` en TypeScript
- Nuevo campo `isAdmin: boolean` en contexto de suscripción
- Componentes UI actualizados para mostrar "Enterprise (Internal)"
