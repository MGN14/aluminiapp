-- Pre-llenar datos de empresa para el usuario fundador (Nicolas) con la info
-- vista en su hoja membretada. Solo aplica si los campos estan vacios — no
-- sobreescribe ediciones manuales que ya haya hecho.

UPDATE public.profiles
SET
  company_name    = COALESCE(NULLIF(company_name, ''),    'MGN GLOBALTRADE SAS'),
  company_nit     = COALESCE(NULLIF(company_nit, ''),     '901445759'),
  company_city    = COALESCE(NULLIF(company_city, ''),    'Bogotá D.C.')
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'niko14_gomez@hotmail.com');
