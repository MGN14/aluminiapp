-- El valor residual no puede superar el valor de compra (defensa de datos:
-- evita activos que nunca se deprecian por un dato mal cargado). Migración
-- aparte para no editar la ya aplicada.
ALTER TABLE public.fixed_assets
  DROP CONSTRAINT IF EXISTS fixed_assets_residual_le_compra;
ALTER TABLE public.fixed_assets
  ADD CONSTRAINT fixed_assets_residual_le_compra CHECK (valor_residual <= valor_compra);

NOTIFY pgrst, 'reload schema';
