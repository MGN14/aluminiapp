import jsPDF from 'jspdf';
import { numberToSpanishWords } from './numberToSpanishWords';

export type CuentaDeCobroVariant = 'cuenta_de_cobro' | 'comprobante_pago';

export interface CuentaDeCobroData {
  // Variante: cuenta de cobro (formal, con manifestacion DIAN) o comprobante
  // de pago (gasto en efectivo respaldado).
  variant: CuentaDeCobroVariant;
  // Contratante (empresa del usuario)
  empresaNombre: string;
  empresaNit: string;
  empresaDireccion?: string;
  empresaCiudad?: string;
  // Prestador (a quien se le hace la cuenta de cobro / pago)
  prestadorNombre: string;
  prestadorTipoDocumento: 'CC' | 'CE' | 'PA' | 'NIT';
  prestadorDocumento: string;
  prestadorCiudad?: string;
  prestadorTelefono?: string;
  // Documento
  numeroConsecutivo: string;
  fecha: string; // formateada "29 de abril de 2026"
  ciudadEmision: string;
  concepto: string;
  monto: number;
  retencion?: number;
  incluyePrestacionesSociales: boolean;
}

const TIPO_DOC_LABEL: Record<string, string> = {
  CC: 'Cédula de Ciudadanía',
  CE: 'Cédula de Extranjería',
  PA: 'Pasaporte',
  NIT: 'NIT',
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

export function generateCuentaDeCobroPdf(data: CuentaDeCobroData): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 22;
  let y = margin;

  // Encabezado: empresa
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(data.empresaNombre.toUpperCase(), margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`NIT: ${data.empresaNit}`, margin, y);
  y += 4;
  if (data.empresaDireccion) {
    doc.text(data.empresaDireccion, margin, y);
    y += 4;
  }
  if (data.empresaCiudad) {
    doc.text(data.empresaCiudad, margin, y);
    y += 4;
  }

  // Numero consecutivo y fecha (derecha)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const headerRightY = margin;
  doc.text(`No. ${data.numeroConsecutivo}`, pageW - margin, headerRightY, { align: 'right' });
  doc.text(`${data.ciudadEmision}, ${data.fecha}`, pageW - margin, headerRightY + 5, { align: 'right' });

  const isCuentaDeCobro = data.variant === 'cuenta_de_cobro';

  // Titulo
  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(isCuentaDeCobro ? 'CUENTA DE COBRO' : 'COMPROBANTE DE PAGO', pageW / 2, y, { align: 'center' });
  y += 10;

  // Encabezado del cuerpo: el prestador certifica que la empresa le adeuda
  // (cuenta de cobro) o que recibio el pago (comprobante de pago)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const lineSpacing = 5;

  doc.text(`${data.empresaNombre.toUpperCase()} con NIT ${data.empresaNit}`, margin, y);
  y += lineSpacing;
  doc.text(isCuentaDeCobro ? 'DEBE A:' : 'PAGÓ A:', margin, y);
  y += lineSpacing + 2;

  doc.setFont('helvetica', 'bold');
  doc.text(data.prestadorNombre.toUpperCase(), margin, y);
  y += lineSpacing;
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${TIPO_DOC_LABEL[data.prestadorTipoDocumento] ?? data.prestadorTipoDocumento} No. ${data.prestadorDocumento}`,
    margin,
    y
  );
  y += lineSpacing;
  if (data.prestadorCiudad) {
    doc.text(`${data.prestadorCiudad}${data.prestadorTelefono ? ` · Tel. ${data.prestadorTelefono}` : ''}`, margin, y);
    y += lineSpacing;
  }
  y += 4;

  // Monto destacado
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`${isCuentaDeCobro ? 'LA SUMA DE' : 'POR LA SUMA RECIBIDA DE'}: ${fmtMoney(data.monto)}`, margin, y);
  y += lineSpacing + 1;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  const valorEnLetras = numberToSpanishWords(data.monto).toUpperCase() + ' M/CTE';
  const letrasLines = doc.splitTextToSize(`(${valorEnLetras})`, pageW - 2 * margin);
  doc.text(letrasLines, margin, y);
  y += letrasLines.length * 4 + 4;

  // Concepto
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('POR CONCEPTO DE:', margin, y);
  y += lineSpacing;
  doc.setFont('helvetica', 'normal');
  const conceptoLines = doc.splitTextToSize(data.concepto, pageW - 2 * margin);
  doc.text(conceptoLines, margin, y);
  y += conceptoLines.length * 5 + 4;

  // Retencion (si aplica)
  if (data.retencion && data.retencion > 0) {
    const neto = data.monto - data.retencion;
    doc.setFont('helvetica', 'normal');
    doc.text(`Retención en la fuente: ${fmtMoney(data.retencion)}`, margin, y);
    y += lineSpacing;
    doc.setFont('helvetica', 'bold');
    doc.text(`Valor neto a pagar: ${fmtMoney(neto)}`, margin, y);
    y += lineSpacing + 3;
  }

  // Manifestacion legal (solo en cuenta de cobro formal)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const manifText = isCuentaDeCobro
    ? 'El suscrito declara bajo la gravedad de juramento que no se encuentra obligado a expedir factura electrónica de venta, conforme a las normas tributarias vigentes y los requisitos establecidos por la DIAN.'
    : 'El suscrito declara haber recibido del contratante la suma indicada, en la fecha y por el concepto descritos. Firma como constancia del pago efectuado.';
  const manifLines = doc.splitTextToSize(manifText, pageW - 2 * margin);
  doc.text(manifLines, margin, y);
  y += manifLines.length * 4 + 3;

  // Prestaciones sociales (opcional)
  if (data.incluyePrestacionesSociales) {
    const prestLines = doc.splitTextToSize(
      'Asimismo, declara que se encuentra al día en el pago de aportes al Sistema de Seguridad Social en Salud y Pensión, en cumplimiento de lo establecido por el Artículo 50 de la Ley 789 de 2002 y el Decreto 1670 de 2007.',
      pageW - 2 * margin
    );
    doc.text(prestLines, margin, y);
    y += prestLines.length * 4 + 3;
  }

  // Firma
  y = Math.max(y, doc.internal.pageSize.getHeight() - 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Atentamente,', margin, y);
  y += 18;
  // Linea de firma
  doc.line(margin, y, margin + 70, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text(data.prestadorNombre.toUpperCase(), margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `${TIPO_DOC_LABEL[data.prestadorTipoDocumento] ?? data.prestadorTipoDocumento} No. ${data.prestadorDocumento}`,
    margin,
    y
  );

  return doc;
}
