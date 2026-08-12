# Fase 0 — SQL de diagnóstico del Módulo de Cobranza

Todas son **solo lectura** (SELECT). Correr en el **SQL Editor de Supabase**:
https://supabase.com/dashboard/project/flmelenvmvhsogtzjjow/sql/new

Ya vienen con el `user_id` de Nico (`1449c077-7182-4311-91af-74013a9fa5da`) puesto: copiar y correr
tal cual.

---

## 0. Tu user_id

```sql
select id, email from auth.users where email = 'niko14_gomez@hotmail.com';
```

---

## 1. H1 — ¿Cuánto miente `balance_pending`?

Compara el campo de Siigo contra el saldo real (total − pagos vinculados − retenciones) factura
por factura. Es el número que alimenta hoy el Score IA, el email del lunes, el mensaje al cliente y
el link Wompi.

```sql
with pagos as (
  select i.id,
         coalesce((select sum(abs(t.amount)) from transactions t
                    where t.invoice_id = i.id and t.deleted_at is null), 0)
       + coalesce((select sum(abs(m.matched_amount)) from invoice_transaction_matches m
                    where m.invoice_id = i.id), 0)
       + coalesce((select sum(abs(d.amount)) from initial_state_details d
                    where d.invoice_id = i.id and d.field_type = 'anticipos_de_clientes'), 0) as pagado
  from invoices i
  where i.user_id = '1449c077-7182-4311-91af-74013a9fa5da' and i.type = 'venta'
)
select i.invoice_number,
       i.counterparty_name,
       i.issue_date,
       i.total_amount,
       i.balance_pending                                   as saldo_siigo,
       p.pagado,
       coalesce(i.retefuente_cliente_amount,0)
         + coalesce(i.reteica_amount,0)
         + coalesce(i.autoretefuente_amount,0)             as retenciones,
       greatest(0, i.total_amount - p.pagado
         - coalesce(i.retefuente_cliente_amount,0)
         - coalesce(i.reteica_amount,0)
         - coalesce(i.autoretefuente_amount,0))            as saldo_real,
       i.balance_pending - greatest(0, i.total_amount - p.pagado
         - coalesce(i.retefuente_cliente_amount,0)
         - coalesce(i.reteica_amount,0)
         - coalesce(i.autoretefuente_amount,0))            as diferencia
from invoices i join pagos p on p.id = i.id
where i.user_id = '1449c077-7182-4311-91af-74013a9fa5da' and i.type = 'venta'
  and coalesce(i.void_type,'') <> 'total'
  and i.balance_pending > 0
order by diferencia desc
limit 50;
```

**Total de la mentira, en una fila:**

```sql
with pagos as (
  select i.id, i.balance_pending,
         greatest(0, i.total_amount
           - coalesce((select sum(abs(t.amount)) from transactions t
                        where t.invoice_id = i.id and t.deleted_at is null),0)
           - coalesce((select sum(abs(m.matched_amount)) from invoice_transaction_matches m
                        where m.invoice_id = i.id),0)
           - coalesce(i.retefuente_cliente_amount,0)
           - coalesce(i.reteica_amount,0)
           - coalesce(i.autoretefuente_amount,0)) as saldo_real
  from invoices i
  where i.user_id = '1449c077-7182-4311-91af-74013a9fa5da' and i.type = 'venta'
    and coalesce(i.void_type,'') <> 'total' and i.balance_pending > 0
)
select count(*) as facturas,
       sum(balance_pending) as total_segun_siigo,
       sum(saldo_real)      as total_real,
       sum(balance_pending) - sum(saldo_real) as sobrestimacion
from pagos;
```

> Si `sobrestimacion` es grande, ese es exactamente el monto por el que el módulo te está
> pidiendo cobrar de más.

---

## 2. H2 — Cartera de años anteriores que no aparece en ninguna vista

```sql
select extract(year from i.issue_date)::int as anio,
       count(*) as facturas,
       sum(i.total_amount) as facturado,
       sum(greatest(0, i.total_amount
         - coalesce((select sum(abs(t.amount)) from transactions t
                      where t.invoice_id = i.id and t.deleted_at is null),0)
         - coalesce((select sum(abs(m.matched_amount)) from invoice_transaction_matches m
                      where m.invoice_id = i.id),0)
         - coalesce(i.retefuente_cliente_amount,0)
         - coalesce(i.reteica_amount,0)
         - coalesce(i.autoretefuente_amount,0))) as saldo_vivo_hoy
from invoices i
where i.user_id = '1449c077-7182-4311-91af-74013a9fa5da' and i.type = 'venta'
  and coalesce(i.void_type,'') <> 'total'
group by 1 order by 1 desc;
```

**Pagos de este año que están cancelando facturas de años anteriores** (los que el cálculo actual
imputa mal):

```sql
select t.date, t.description, t.amount, i.invoice_number, i.issue_date as factura_de
from transactions t
join invoices i on i.id = t.invoice_id
where t.user_id = '1449c077-7182-4311-91af-74013a9fa5da' and t.type = 'ingreso' and t.deleted_at is null
  and t.date >= '2026-01-01'
  and i.issue_date < '2026-01-01'
order by t.date desc;
```

---

## 3. H3 — Saldo inicial que se suma en todos los años

```sql
select field_type,
       count(*) as filas,
       sum(amount) as monto,
       min(created_at)::date as cargado_el
from initial_state_details
where user_id = '1449c077-7182-4311-91af-74013a9fa5da'
group by 1;
```

```sql
-- Detalle del CxC de apertura por cliente
select coalesce(r.name, d.responsible_name, '(sin nombre)') as cliente,
       sum(d.amount) as cxc_inicial
from initial_state_details d
left join responsibles r on r.id = d.responsible_id
where d.user_id = '1449c077-7182-4311-91af-74013a9fa5da' and d.field_type = 'cuentas_por_cobrar'
group by 1 order by 2 desc;
```

> Este monto se está sumando **completo** a la cartera de 2025 **y** a la de 2026. Contrastalo con
> lo que realmente sigue debiendo esa gente hoy.

---

## 4. H5 — ¿Ya tocamos el techo de 1.000 filas?

Si alguno da ≥ 1000, ese query **ya está truncado** en la app y la cartera está inflada.

```sql
select 'responsibles'  as tabla, count(*) from responsibles where user_id = '1449c077-7182-4311-91af-74013a9fa5da'
union all
select 'invoices 2026', count(*) from invoices
  where user_id='1449c077-7182-4311-91af-74013a9fa5da' and type='venta'
    and issue_date between '2026-01-01' and '2026-12-31'
union all
select 'ingresos 2026', count(*) from transactions
  where user_id='1449c077-7182-4311-91af-74013a9fa5da' and type='ingreso' and deleted_at is null
    and date between '2026-01-01' and '2026-12-31'
union all
select 'invoice_transaction_matches (SIN filtro)', count(*)
  from invoice_transaction_matches where user_id='1449c077-7182-4311-91af-74013a9fa5da'
union all
select 'initial_state_details', count(*) from initial_state_details where user_id='1449c077-7182-4311-91af-74013a9fa5da'
union all
select 'responsible_aliases', count(*) from responsible_aliases where user_id='1449c077-7182-4311-91af-74013a9fa5da';
```

---

## 5. H6 / H7 — Cuánto ingreso no está llegando a la cartera

**Ingresos sin conciliar** (sin beneficiario y sin factura): cada peso acá es cartera potencialmente
sobrestimada.

```sql
select count(*) as movimientos,
       sum(abs(amount)) as monto_sin_conciliar
from transactions
where user_id='1449c077-7182-4311-91af-74013a9fa5da' and type='ingreso' and deleted_at is null
  and date between '2026-01-01' and '2026-12-31'
  and responsible_id is null and invoice_id is null;
```

**Ingresos NO operativos que hoy sí bajan cartera** (traspasos, créditos, etc. con beneficiario):

```sql
select coalesce(movement_nature,'(null)') as naturaleza,
       count(*), sum(abs(amount)) as monto
from transactions
where user_id='1449c077-7182-4311-91af-74013a9fa5da' and type='ingreso' and deleted_at is null
  and date between '2026-01-01' and '2026-12-31'
  and responsible_id is not null
group by 1 order by 3 desc;
```

**Cobros en efectivo con cliente identificado que hoy no bajan el saldo de nadie:**

```sql
select coalesce(r.name,'(sin beneficiario)') as cliente,
       count(*), sum(cm.amount) as monto
from cash_movements cm
left join responsibles r on r.id = cm.responsible_id
where cm.user_id='1449c077-7182-4311-91af-74013a9fa5da' and cm.type='ingreso'
  and cm.date between '2026-01-01' and '2026-12-31'
group by 1 order by 3 desc;
```

---

## 6. H10 — Notas crédito parciales no descontadas

```sql
select invoice_number, counterparty_name, total_amount,
       voided_amount, voided_by_credit_note_number,
       total_amount - coalesce(voided_amount,0) as total_neto_real
from invoices
where user_id='1449c077-7182-4311-91af-74013a9fa5da' and type='venta' and void_type = 'partial'
order by voided_amount desc;
```

---

## 7. H11 — Clientes que la pantalla unifica y el scorer no

```sql
select r.name as cliente_canonico, a.alias, a.source
from responsible_aliases a
join responsibles r on r.id = a.responsible_id
where a.user_id='1449c077-7182-4311-91af-74013a9fa5da'
order by 1;
```

```sql
-- Scores guardados vs clientes con deuda: cuáles quedaron sin badge
select client_name, responsible_id, score, category, total_owed, scored_at
from client_collection_scores
where user_id='1449c077-7182-4311-91af-74013a9fa5da'
order by scored_at desc;
```
