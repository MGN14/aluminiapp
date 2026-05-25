-- Email campaigns: registro de campañas masivas enviadas vía Resend.
-- MVP: solo founder puede crear y disparar.

CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Contenido
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text NULL,
  from_name text DEFAULT 'AluminIA',
  reply_to text NULL,

  -- Destinatarios: snapshot del scope al momento del envío
  audience_type text NOT NULL CHECK (audience_type IN (
    'all_active_users', 'by_plan', 'custom_list', 'single_test'
  )),
  audience_filter jsonb NULL, -- ej: {"plans": ["empresarial"]} o {"emails": ["a@b.com"]}
  recipient_count integer NULL,

  -- Estado del envío
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sending', 'sent', 'failed', 'partial')),
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,

  -- Tracking
  scheduled_at timestamptz NULL,
  sent_at timestamptz NULL,
  error_log text NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_campaigns_created_by_idx
  ON public.email_campaigns(created_by, created_at DESC);

COMMENT ON TABLE public.email_campaigns IS
  'Campañas de email masivas (MVP solo founder). Cada row = una campaña con su scope y stats.';

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

-- Solo el founder/admin puede ver/crear campañas. Mutación vía edge function service_role.
DROP POLICY IF EXISTS "email_campaigns_admin_select" ON public.email_campaigns;
CREATE POLICY "email_campaigns_admin_select"
  ON public.email_campaigns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

DROP TRIGGER IF EXISTS set_email_campaigns_updated_at ON public.email_campaigns;
CREATE TRIGGER set_email_campaigns_updated_at
  BEFORE UPDATE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabla de envíos individuales (1 row por destinatario por campaña)
CREATE TABLE IF NOT EXISTS public.email_campaign_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  recipient_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'bounced')),
  resend_email_id text NULL,
  error_message text NULL,
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_campaign_sends_campaign_idx
  ON public.email_campaign_sends(campaign_id, status);
CREATE INDEX IF NOT EXISTS email_campaign_sends_user_idx
  ON public.email_campaign_sends(recipient_user_id, sent_at DESC)
  WHERE recipient_user_id IS NOT NULL;

ALTER TABLE public.email_campaign_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_sends_admin_select" ON public.email_campaign_sends;
CREATE POLICY "campaign_sends_admin_select"
  ON public.email_campaign_sends FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
