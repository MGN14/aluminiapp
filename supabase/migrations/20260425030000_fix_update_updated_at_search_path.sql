-- Fix Supabase Security Advisor warning: "Function Search Path Mutable"
-- en public.update_updated_at_column.
--
-- Origen del bug: la migration 20260419000000_create_fiscal_and_business_obligations.sql
-- hizo CREATE OR REPLACE FUNCTION sin SET search_path, sobrescribiendo la
-- versión segura definida originalmente en 20260202025130. Sin search_path
-- fijo, un atacante con permiso de crear objetos podría inyectar tablas
-- con el mismo nombre en otro schema y secuestrar el comportamiento del
-- trigger.
--
-- Fix: redefinir la función con SET search_path = public, pg_temp.
-- pg_temp se incluye al final como buena práctica (evita que el plan
-- usuario malicioso la antesponga).

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
