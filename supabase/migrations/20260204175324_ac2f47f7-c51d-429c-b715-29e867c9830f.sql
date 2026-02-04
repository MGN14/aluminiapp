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

-- Actualizar función check_pdf_upload_limit para bypass de admins
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
  
  -- Obtener suscripción del usuario
  SELECT * INTO v_subscription
  FROM user_subscriptions
  WHERE user_id = p_user_id;
  
  -- Si no existe, crear registro demo
  IF NOT FOUND THEN
    INSERT INTO user_subscriptions (user_id, plan, status)
    VALUES (p_user_id, 'demo', 'active')
    RETURNING * INTO v_subscription;
  END IF;
  
  v_plan := v_subscription.plan;
  
  -- Determinar límites según plan
  CASE v_plan
    WHEN 'demo' THEN
      v_limit := 1;
      v_used := v_subscription.pdf_uploads_total;
      v_can_upload := v_used < v_limit;
      IF NOT v_can_upload THEN
        v_message := 'Ya usaste el extracto gratuito. Para seguir usando AluminIA, suscríbete al plan Básico.';
      END IF;
    WHEN 'basico' THEN
      v_limit := 10;
      v_used := v_subscription.pdf_uploads_this_month;
      v_can_upload := v_used < v_limit;
      IF NOT v_can_upload THEN
        v_message := 'Alcanzaste el límite de 10 PDFs este mes. Espera al próximo ciclo o actualiza al plan Empresarial.';
      END IF;
    WHEN 'empresarial' THEN
      v_limit := -1; -- ilimitado
      v_used := v_subscription.pdf_uploads_this_month;
      v_can_upload := true;
      v_message := '';
    ELSE
      v_limit := 1;
      v_used := v_subscription.pdf_uploads_total;
      v_can_upload := v_used < v_limit;
      v_message := 'Plan no reconocido.';
  END CASE;
  
  RETURN json_build_object(
    'can_upload', v_can_upload,
    'plan', v_plan,
    'limit', v_limit,
    'used', v_used,
    'message', COALESCE(v_message, ''),
    'status', v_subscription.status,
    'is_admin', false
  );
END;
$$;