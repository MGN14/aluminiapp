-- Excepción explícita para el selector de beneficiario de Conciliación.
--
-- Cuando un movimiento está clasificado como Ventas, el selector solo ofrece
-- CLIENTES: terceros con facturas, remisiones o cotizaciones de venta (rol
-- derivado de los datos, como en la ficha de Terceros). Este flag permite
-- marcar a mano un tercero que debe aparecer igual aunque no tenga esa
-- evidencia — pedido de Nico 2026-11-11: "Nicolás sí". Se edita desde la
-- ficha del tercero (Conciliación → Terceros → Editar → "Tratarlo como
-- cliente en Ventas"). El código tolera que la columna no exista todavía.
ALTER TABLE public.responsibles
  ADD COLUMN IF NOT EXISTS cliente_manual boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.responsibles.cliente_manual IS
  'Tratar como cliente en el selector de Ventas aunque no tenga facturas, remisiones ni cotizaciones de venta (excepción marcada a mano desde la ficha).';
