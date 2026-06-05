-- ============================================================================
-- Maestro de productos: referencias por color (convención de sufijo Siigo)
-- ============================================================================
-- Los perfiles de aluminio se codifican en Siigo con sufijo `-5`. A partir de
-- esa ref se derivan las referencias por acabado/color:
--
--   ref_siigo:        38x38-5   (base + sufijo Siigo)
--   ref_local:        38x38     (sin el -5)
--   ref_proveedor_a:  38x38-2   (-2 = Blanco)
--   ref_proveedor_b:  38x38-3   (-3 = Negro)
--   ref_proveedor_c:  38x38-0   (-0 = Crudo)
--
-- Solo aplica a refs que terminan en `-5`. Las que no siguen esa convención
-- (vidrios, accesorios, tornillería, etc.) se dejan intactas.
-- NO destructivo: el UPDATE solo rellena ref_local vacío, nunca pisa lo que ya
-- esté cargado a mano.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Backfill de enriquecimiento sobre lo que ya está en el maestro.
-- ----------------------------------------------------------------------------
UPDATE public.product_master
SET ref_local       = regexp_replace(ref_siigo, '-5$', ''),
    ref_proveedor_a = regexp_replace(ref_siigo, '-5$', '') || '-2',
    ref_proveedor_b = regexp_replace(ref_siigo, '-5$', '') || '-3',
    ref_proveedor_c = regexp_replace(ref_siigo, '-5$', '') || '-0',
    updated_at      = now()
WHERE ref_siigo ~ '-5$'
  AND (ref_local IS NULL OR btrim(ref_local) = '');

-- ----------------------------------------------------------------------------
-- 2. Auto-acumulación con las refs de color ya calculadas.
--    Reemplaza la función del trigger creado en 20260605120000 para que cada
--    referencia nueva entre al maestro con ref_local + proveedores A/B/C.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_inventory_to_product_master()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base  text;
  v_local text;
  v_a     text;
  v_b     text;
  v_c     text;
BEGIN
  IF NEW.reference IS NULL OR btrim(NEW.reference) = '' THEN
    RETURN NEW;
  END IF;

  -- Convención de color por sufijo Siigo (-5). Si la ref no termina en -5,
  -- ref_local y proveedores quedan NULL (no se inventa nada).
  IF NEW.reference ~ '-5$' THEN
    v_base  := regexp_replace(NEW.reference, '-5$', '');
    v_local := v_base;
    v_a     := v_base || '-2';  -- Blanco
    v_b     := v_base || '-3';  -- Negro
    v_c     := v_base || '-0';  -- Crudo
  END IF;

  INSERT INTO public.product_master (
    user_id, ref_siigo, description, unit, system, active,
    ref_local, ref_proveedor_a, ref_proveedor_b, ref_proveedor_c
  )
  VALUES (
    NEW.user_id,
    NEW.reference,
    COALESCE(NULLIF(btrim(NEW.name), ''), NEW.reference),
    COALESCE(NULLIF(btrim(NEW.unit), ''), 'und'),
    NEW.system,
    true,
    v_local, v_a, v_b, v_c
  )
  ON CONFLICT (user_id, ref_siigo) DO NOTHING;

  RETURN NEW;
END $$;

-- El trigger sync_inventory_to_product_master_trg ya existe (20260605120000);
-- al ser CREATE OR REPLACE de la función, toma la nueva lógica sin recrearlo.
