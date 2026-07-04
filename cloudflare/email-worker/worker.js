/**
 * AluminIA — Email Worker del buzón de facturas de compra.
 *
 * Cloudflare Email Routing entrega los emails de facturas@aluminiapp.com a
 * este Worker. Parsea el MIME con postal-mime, extrae SOLO adjuntos .zip/.xml
 * (la factura electrónica DIAN viene como ZIP con XML UBL + PDF) y los POSTea
 * en base64 a la edge function receive-purchase-invoice de Supabase,
 * autenticando con el header x-inbox-secret.
 *
 * Config (ver README.md):
 *   - var INBOX_ENDPOINT (wrangler.toml): URL de la edge function.
 *   - secret INVOICE_INBOX_SECRET (wrangler secret put): el mismo valor que
 *     el secret de Supabase.
 */
import PostalMime from 'postal-mime';

const ALLOWED_EXT = /\.(zip|xml)$/i;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15MB por adjunto
const MAX_ATTACHMENTS = 10;

function toBase64(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default {
  async email(message, env) {
    const parsed = await PostalMime.parse(message.raw);

    const attachments = [];
    for (const att of parsed.attachments ?? []) {
      const name = att.filename || 'adjunto';
      if (!ALLOWED_EXT.test(name)) continue; // seguridad: solo zip/xml
      const size = att.content?.byteLength ?? 0;
      if (size === 0 || size > MAX_ATTACHMENT_BYTES) continue;
      attachments.push({ filename: name, content_base64: toBase64(att.content) });
      if (attachments.length >= MAX_ATTACHMENTS) break;
    }

    // El cuerpo de texto viaja aunque no haya adjuntos: ahí llega, por ejemplo,
    // el código de confirmación del reenvío de Gmail (queda en los logs de la
    // edge function receive-purchase-invoice).
    const payload = {
      to: message.to,
      from: message.from,
      subject: parsed.subject ?? '',
      text: (parsed.text ?? '').slice(0, 4000),
      attachments,
    };

    const resp = await fetch(env.INBOX_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-inbox-secret': env.INVOICE_INBOX_SECRET,
      },
      body: JSON.stringify(payload),
    });

    const body = await resp.text();
    console.log(
      `facturas-inbox: de=${message.from} adjuntos=${attachments.length} → ${resp.status}: ${body.slice(0, 500)}`,
    );
    // No rechazamos el email aunque falle el POST: un bounce al proveedor no
    // arregla nada y el detalle ya quedó en los logs del Worker.
  },
};
