import { supabase } from '@/integrations/supabase/client';

const BUCKET = 'invoices'; // Reusamos bucket existente con prefix quotations/.

/**
 * Sube el PDF generado de una cotización al bucket invoices/ con path:
 *   quotations/{user_id}/{quote_id}_{timestamp}.pdf
 *
 * Devuelve el storage path para guardarlo en quotations.pdf_storage_path.
 *
 * Si falla (red, RLS, lo que sea) NO tira error — solo loggea y devuelve null,
 * porque el envío del PDF al cliente ya pasó y no queremos romper el flujo.
 */
export async function uploadQuotationPdf(params: {
  userId: string;
  quotationId: string;
  pdfBlob: Blob;
}): Promise<string | null> {
  const { userId, quotationId, pdfBlob } = params;
  const ts = Date.now();
  const path = `quotations/${userId}/${quotationId}_${ts}.pdf`;
  try {
    const { error } = await supabase.storage.from(BUCKET).upload(path, pdfBlob, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (error) {
      console.error('uploadQuotationPdf: storage upload failed', error);
      return null;
    }
    return path;
  } catch (err) {
    console.error('uploadQuotationPdf: unexpected error', err);
    return null;
  }
}

/**
 * Convierte un jsPDF en Blob (PDF) para upload + base64 (para email attachment).
 * Lo hace en una sola pasada para no recalcular bytes dos veces.
 */
export async function jsPdfToBlobAndBase64(
  doc: import('jspdf').jsPDF,
): Promise<{ blob: Blob; base64: string }> {
  const arrayBuffer = doc.output('arraybuffer') as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });

  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  const base64 = btoa(binary);

  return { blob, base64 };
}
