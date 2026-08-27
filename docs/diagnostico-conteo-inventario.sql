-- ¿Quién confirmó el último cierre de inventario y qué diferencias aplicó?
-- Correr en el SQL Editor de Supabase.

-- 1. Las últimas sesiones con quién las confirmó
SELECT s.fecha_conteo,
       s.estado,
       s.total_referencias,
       s.total_con_diferencia,
       s.total_valor_diferencia,
       s.created_at            AS subido_el,
       s.confirmado_at,
       CASE WHEN s.confirmado_por = s.user_id THEN 'EL DUEÑO'
            WHEN s.confirmado_por IS NULL     THEN '(sin registrar)'
            ELSE 'UN COLABORADOR' END AS confirmado_por_quien,
       au.email                AS email_de_quien_confirmo
FROM public.inventory_count_sessions s
LEFT JOIN auth.users au ON au.id = s.confirmado_por
ORDER BY s.fecha_conteo DESC
LIMIT 10;

-- 2. Top 30 diferencias del ÚLTIMO cierre confirmado (lo que ahora se ve en pantalla)
SELECT l.variant_reference,
       l.descripcion,
       l.stock_teorico   AS deberia_haber,
       l.stock_contado   AS contado,
       l.diferencia,
       ROUND(l.diferencia * l.costo_unitario) AS valor_diferencia
FROM public.inventory_count_lines l
WHERE l.session_id = (
  SELECT id FROM public.inventory_count_sessions
  WHERE estado = 'confirmado' ORDER BY fecha_conteo DESC LIMIT 1
)
  AND l.diferencia <> 0
ORDER BY ABS(l.diferencia * l.costo_unitario) DESC
LIMIT 30;
