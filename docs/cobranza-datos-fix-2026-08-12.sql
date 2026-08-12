-- ============================================================================
-- COBRANZA — corrección de datos confirmada por Nico (2026-08-12)
-- Correr en el SQL Editor de Supabase DESPUÉS de aplicar la migración
-- 20260812150000 y deployar las functions. Todo en una transacción.
--
-- Qué hace (en orden):
--   1. Saldo inicial de caja 2025 no declarado: $20.260.738 (con fecha
--      2025-12-31 para que NO cuente como ingreso 2026).
--   2. Ingreso de caja faltante: $2.771.400 de Ingealuminios (cierra al peso
--      la consignación del 29-may y el saldo de FV-2-283 vs Siigo).
--   3. Egresos de caja por las 2 consignaciones de mayo (legalización).
--   4. Los 2 depósitos en el banco pasan a TRASPASO (no son ingreso nuevo)
--      y se desvinculan de FV-2-283.
--   5. Beneficiario en el efectivo: Ingealuminios (2) y Nancy (1).
--   6. Retenciones de FV-2-283: $1.648.200 (= retefuente 2.5% + reteICA
--      ~11.04‰ sobre base $45.730.756 — coincide AL PESO con el saldo que
--      Siigo muestra abierto). Con esto FV-2-283 queda en $0 = PAGA.
--      ⚠️ Confirmar con el contador que Ingealuminios sí practicó retención;
--      si no la practicó, saltate el paso 6 y el cliente debe $1.648.200.
--
-- Cuadre final de caja: 20.260.738 + 64.621.400 (ingresos caja 2026)
--   + 3.889.262 (caja menor) − 52.771.400 (consignaciones) = $36.000.000
--   = $25M efectivo + $11M Nequi que Nico contó hoy. ✓
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Saldo inicial de caja 2025 (fecha 2025-12-31 → fuera de KPIs 2026)
-- ---------------------------------------------------------------------------
INSERT INTO cash_movements (user_id, date, type, amount, description, notes)
VALUES (
  '1449c077-7182-4311-91af-74013a9fa5da',
  '2025-12-31',
  'ingreso',
  20260738,
  'Saldo inicial de caja 2025',
  'Efectivo no declarado del 2025, cuadrado contra conteo físico del 2026-08-12 ($25M efectivo + $11M Nequi). Auditoría cobranza.'
);

-- ---------------------------------------------------------------------------
-- 2. Ingreso de caja faltante: Ingealuminios $2.771.400
-- ---------------------------------------------------------------------------
INSERT INTO cash_movements (user_id, date, type, amount, description, notes, responsible_id)
VALUES (
  '1449c077-7182-4311-91af-74013a9fa5da',
  '2026-05-29',
  'ingreso',
  2771400,
  'Ingealuminios — efectivo adicional',
  'Complemento del pago en efectivo de FV-2-283: la consignación del 29-may fue $22.771.400 y solo había $20M registrados de este cliente. Cierra al peso contra Siigo.',
  (SELECT id FROM responsibles WHERE user_id = '1449c077-7182-4311-91af-74013a9fa5da' AND name ILIKE '%ingealum%' LIMIT 1)
);

-- ---------------------------------------------------------------------------
-- 3. Egresos de caja: las 2 consignaciones de mayo (legalización)
-- ---------------------------------------------------------------------------
INSERT INTO cash_movements (user_id, date, type, amount, description, notes)
VALUES
  (
    '1449c077-7182-4311-91af-74013a9fa5da',
    '2026-05-22',
    'egreso',
    30000000,
    'Consignación a banco — Volante Oficina',
    'Legalización: espejo del depósito bancario del 22-may. El ingreso real ya está contado en caja.'
  ),
  (
    '1449c077-7182-4311-91af-74013a9fa5da',
    '2026-05-29',
    'egreso',
    22771400,
    'Consignación a banco — Volante Oficina',
    'Legalización: espejo del depósito bancario del 29-may.'
  );

-- ---------------------------------------------------------------------------
-- 4. Depósitos del banco → traspaso (misma plata que ya entró por caja).
--    Beneficiario pasa a "Otros" (mismo patrón que el traspaso interbanc
--    del 21-ene); si no existe, conserva el actual. Se desvinculan de la
--    factura: el pago real de FV-2-283 es el efectivo, no la consignación.
-- ---------------------------------------------------------------------------
UPDATE transactions
SET movement_nature = 'traspaso',
    invoice_id = NULL,
    responsible_id = COALESCE(
      (SELECT id FROM responsibles WHERE user_id = '1449c077-7182-4311-91af-74013a9fa5da' AND lower(name) = 'otros' LIMIT 1),
      responsible_id
    )
WHERE user_id = '1449c077-7182-4311-91af-74013a9fa5da'
  AND type = 'ingreso'
  AND deleted_at IS NULL
  AND (
    (date = '2026-05-22' AND amount = 30000000 AND description ILIKE 'Deposito Efectivo con Volante%')
    OR
    (date = '2026-05-29' AND amount = 22771400 AND description ILIKE 'Deposito Efectivo con Volante%')
  );

-- ---------------------------------------------------------------------------
-- 5. Beneficiario en el efectivo ya registrado
-- ---------------------------------------------------------------------------
UPDATE cash_movements
SET responsible_id = (SELECT id FROM responsibles WHERE user_id = '1449c077-7182-4311-91af-74013a9fa5da' AND name ILIKE '%ingealum%' LIMIT 1)
WHERE user_id = '1449c077-7182-4311-91af-74013a9fa5da'
  AND type = 'ingreso'
  AND responsible_id IS NULL
  AND description ILIKE '%ingealum%';

UPDATE cash_movements
SET responsible_id = (SELECT id FROM responsibles WHERE user_id = '1449c077-7182-4311-91af-74013a9fa5da' AND name ILIKE '%nancy%amaya%' LIMIT 1)
WHERE user_id = '1449c077-7182-4311-91af-74013a9fa5da'
  AND type = 'ingreso'
  AND responsible_id IS NULL
  AND date = '2026-04-28'
  AND amount = 10000000
  AND description ILIKE '%nancy%';

-- ---------------------------------------------------------------------------
-- 6. Retenciones de FV-2-283 (⚠️ confirmar con el contador — ver cabecera)
-- ---------------------------------------------------------------------------
UPDATE invoices
SET retefuente_cliente_amount = 1143269,
    reteica_amount = 504931
WHERE user_id = '1449c077-7182-4311-91af-74013a9fa5da'
  AND invoice_number = 'FV-2-283'
  AND type = 'venta';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN (correr después del COMMIT, solo lectura)
-- ============================================================================

-- a) Caja neta registrada — debe dar 36.000.000
select
  (select coalesce(sum(case when type='ingreso' then abs(amount) else -abs(amount) end),0)
     from cash_movements where user_id='1449c077-7182-4311-91af-74013a9fa5da' and petty_cash_movement_id is null)
  +
  (select coalesce(sum(case when kind='ingreso_efectivo' then abs(amount) else -abs(amount) end),0)
     from petty_cash_movements where user_id='1449c077-7182-4311-91af-74013a9fa5da')
  as caja_neta_total_debe_ser_36M;

-- b) Los 2 depósitos quedaron como traspaso sin factura
select date, amount, movement_nature, invoice_id
from transactions
where user_id='1449c077-7182-4311-91af-74013a9fa5da'
  and description ilike 'Deposito Efectivo con Volante%';

-- c) Efectivo con beneficiario (Ingealuminios 3 filas, Nancy 1, Ronal 1, Marcela 2)
select cm.date, cm.amount, cm.description, r.name as beneficiario
from cash_movements cm
left join responsibles r on r.id = cm.responsible_id
where cm.user_id='1449c077-7182-4311-91af-74013a9fa5da' and cm.type='ingreso'
order by cm.date;
