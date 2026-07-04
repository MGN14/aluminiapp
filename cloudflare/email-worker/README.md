# Buzón de facturas — facturas@aluminiapp.com

Email Worker de Cloudflare que recibe las facturas electrónicas DIAN que los
proveedores mandan por email y las mete automáticamente a AluminIA como
facturas de compra (via la edge function `receive-purchase-invoice`).

Flujo completo:

```
Proveedor → email con ZIP (XML UBL + PDF)
  → facturas@aluminiapp.com (Cloudflare Email Routing)
  → este Worker (parsea MIME, extrae .zip/.xml)
  → POST + x-inbox-secret → edge function receive-purchase-invoice
  → parser UBL determinístico → dedupe por CUFE → invoice type='compra'
```

## Deploy (una sola vez, ~10 min)

Todo se corre **en la terminal**, desde esta carpeta:

```bash
cd /Users/nicog/Documents/Claude/Projects/ALUMINIA/aluminiapp-main/cloudflare/email-worker
npm install
npx wrangler login
```

### 1. Generar el secreto compartido

```bash
openssl rand -hex 32
```

Copiá el valor — se usa DOS veces (Supabase y Cloudflare deben tener el mismo).

### 2. Setearlo en Supabase (terminal, desde la raíz del repo)

```bash
cd /Users/nicog/Documents/Claude/Projects/ALUMINIA/aluminiapp-main
supabase secrets set INVOICE_INBOX_SECRET=<el-valor-de-arriba>
```

### 3. Setearlo en Cloudflare y deployar el Worker

```bash
cd /Users/nicog/Documents/Claude/Projects/ALUMINIA/aluminiapp-main/cloudflare/email-worker
npx wrangler secret put INVOICE_INBOX_SECRET   # pega el mismo valor cuando pida
npx wrangler deploy
```

### 4. Activar Email Routing (dashboard de Cloudflare, navegador)

https://dash.cloudflare.com → zona **aluminiapp.com** → **Email** → **Email Routing**:

1. Si es la primera vez: click **Enable Email Routing** (Cloudflare agrega los
   registros MX/TXT solo — aceptar). ⚠️ Si el dominio ya tuviera MX de otro
   proveedor de correo entrante, esto lo reemplaza; hoy aluminiapp.com no
   recibe correo, así que no rompe nada (Resend solo envía, no usa estos MX).
2. Pestaña **Routing rules** → **Create address**:
   - Custom address: `facturas`
   - Action: **Send to a Worker** → `aluminia-invoice-inbox`
3. Verificar en **Settings** que Email Routing quede **Enabled** y los DNS en verde.

### 5. Regla de reenvío en Gmail (navegador)

Para que las facturas que hoy llegan a tu Gmail se reenvíen solas:

1. Gmail → ⚙️ → **Ver todos los ajustes** → pestaña **Reenvío y correo POP/IMAP**
   → **Agregar una dirección de reenvío** → `facturas@aluminiapp.com`.
2. **Gmail manda un código de confirmación a esa dirección.** Ese email lo
   captura el Worker y queda logueado — leelo en:
   - Supabase → Edge Functions → `receive-purchase-invoice` → **Logs**
     (https://supabase.com/dashboard/project/flmelenvmvhsogtzjjow/functions/receive-purchase-invoice/logs),
   - o en la terminal: `npx wrangler tail aluminia-invoice-inbox`.
   Copiá el código/link y confirmalo en Gmail.
3. Crear el filtro: buscador de Gmail → **Mostrar opciones de búsqueda** →
   Asunto: `factura electrónica` (o remitentes de tus proveedores) →
   **Crear filtro** → ✔ **Reenviar a** `facturas@aluminiapp.com`.

### 6. Probar

Mandate un email a `facturas@aluminiapp.com` con el ZIP de una factura DIAN
adjunta. En ~5 segundos debe aparecer en AluminIA → Facturas de Compra,
confirmada y con proveedor asignado. Si no aparece, revisá los logs del punto 5.2.

## Seguridad

- El Worker solo procesa adjuntos `.zip`/`.xml` (máx 10 por email, 15MB c/u);
  el resto se ignora.
- La edge function valida el `x-inbox-secret`, exige CUFE válido en el XML y
  dedupea por CUFE (índice único por usuario) — reenviar el mismo email dos
  veces no duplica facturas.
- El user dueño se resuelve por la dirección destino en la tabla
  `inbound_invoice_addresses` (hoy: facturas@ → founder). Para multi-tenant
  futuro basta agregar filas (p.ej. `facturas+cliente@…`), sin tocar código.
