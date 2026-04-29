-- Cash Movements: hacer description nullable.
-- El form se rediseña para usar responsible_id (beneficiario estructurado)
-- en lugar de description (texto libre). Las filas viejas mantienen su
-- description; las nuevas pueden tener description NULL si solo guardan
-- responsible_id. Migration aditiva, no destructiva.

ALTER TABLE public.cash_movements
  ALTER COLUMN description DROP NOT NULL;

COMMENT ON COLUMN public.cash_movements.description IS 'Texto libre opcional. Legacy: hasta 2026-04-28 era required como texto libre. Ahora se prefiere responsible_id como vinculo estructurado al beneficiario.';
