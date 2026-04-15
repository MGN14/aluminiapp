ALTER TABLE remisiones ADD COLUMN IF NOT EXISTS module_origin text NOT NULL DEFAULT 'gerencial' CHECK (module_origin IN ('gerencial', 'dian'));
