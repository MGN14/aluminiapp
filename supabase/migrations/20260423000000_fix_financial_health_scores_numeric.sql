-- Fix: financial_health_scores columns must be NUMERIC, not INTEGER.
-- El frontend envia decimales (ej 19.3, 8.2); el schema original en Lovable
-- tenia NUMERIC, pero la migration 20260306165813 las definio como integer.
-- Resultado: HTTP 400 / 22P02 "invalid input syntax for type integer: 8.2"

ALTER TABLE public.financial_health_scores
  ALTER COLUMN score_total         TYPE numeric USING score_total::numeric,
  ALTER COLUMN score_conciliacion  TYPE numeric USING score_conciliacion::numeric,
  ALTER COLUMN score_facturacion   TYPE numeric USING score_facturacion::numeric,
  ALTER COLUMN score_impuestos     TYPE numeric USING score_impuestos::numeric,
  ALTER COLUMN score_cartera       TYPE numeric USING score_cartera::numeric,
  ALTER COLUMN score_clasificacion TYPE numeric USING score_clasificacion::numeric;
