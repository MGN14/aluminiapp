-- ============================================================================
-- Cron job: expire-quotations (correr 1x al día)
-- ============================================================================
-- Marca cotizaciones con status='sent' y valid_until < hoy como 'expired'.
--
-- IMPORTANTE: este NO es un migration — es un snippet para correr UNA VEZ
-- en el SQL Editor de Supabase Dashboard, después de:
--   1. Setear las env vars en la edge function:
--        QUOTE_CRON_SECRET=<algo random largo>
--   2. Deployar la edge function expire-quotations:
--        supabase functions deploy expire-quotations
--
-- Patrón replicado de sync-macro-indicators (cron pattern AluminIA).
-- ============================================================================

-- 1) Activar pg_cron + pg_net si no están (idempotente)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2) Programar el job a las 3:00 UTC todos los días (10pm Colombia hora local).
--    Si ya existe un job con este nombre, primero unschedule.
SELECT cron.unschedule('expire-quotations-daily')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'expire-quotations-daily'
);

SELECT cron.schedule(
  'expire-quotations-daily',
  '0 3 * * *',  -- diariamente 3am UTC = 10pm Colombia
  $$
  SELECT net.http_post(
    url := 'https://flmelenvmvhsogtzjjow.supabase.co/functions/v1/expire-quotations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.quote_cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 3) Setear el secret a nivel de DB (lo lee current_setting() arriba).
--    Reemplazar <PEGAR_AQUI_EL_SECRET> por el mismo valor que setes en
--    QUOTE_CRON_SECRET de la edge function.
ALTER DATABASE postgres SET app.quote_cron_secret = '<PEGAR_AQUI_EL_SECRET>';

-- 4) Verificar que el job quedó programado:
--    SELECT jobid, schedule, command, active FROM cron.job WHERE jobname = 'expire-quotations-daily';

-- 5) Disparar manualmente para probar (sin esperar al cron):
--    SELECT net.http_post(
--      url := 'https://flmelenvmvhsogtzjjow.supabase.co/functions/v1/expire-quotations',
--      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', current_setting('app.quote_cron_secret')),
--      body := '{"dryRun": true}'::jsonb
--    );
