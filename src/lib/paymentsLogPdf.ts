import jsPDF from 'jspdf';
import { addAluminiaFooter } from './pdfBranding';

export interface PaymentsLogPdfRow {
  date: string; // YYYY-MM-DD
  type: 'ingreso' | 'egreso';
  source: 'banco' | 'efectivo';
  description: string;
  responsible: string | null;
  invoice_ref: string | null;
  amount: number;
}

/** Item de una remisión adjuntada al PDF. */
export interface RemisionPdfItem {
  reference: string;
  product_name: string;
  units: number;
  unit_cost: number; // 0 si la remisión es "solo unidades"
  total_cost: number; // 0 si la remisión es "solo unidades"
}

/** Remisión adjunta — se renderiza en páginas extra al final del PDF.
 *  Caso de uso: la primera vez se envía la relación de pagos junto con la
 *  remisión que el cliente todavía no confirmó; después solo el saldo. */
export interface RemisionPdfBlock {
  number: string;
  date: string; // YYYY-MM-DD
  beneficiary: string | null;
  notes: string | null;
  items: RemisionPdfItem[];
  /** Si la remisión guarda un total manual override, usarlo en vez de sumar items. */
  totalManual: number | null;
}

export interface PaymentsLogPdfData {
  // Empresa contratante (header)
  empresaNombre: string;
  empresaNit?: string;
  empresaCiudad?: string;
  // Letterhead opcional
  letterheadDataUri?: string;
  letterheadFormat?: 'PNG' | 'JPEG';
  letterheadTopMarginMm?: number;
  letterheadBottomMarginMm?: number;
  // Filtros
  periodoLabel: string; // ej "Año 2026" o "Marzo 2026"
  counterparty: string | null; // nombre del cliente, null si es vista global
  // KPIs
  tePagaron: number;
  lePagaste: number;
  movimientosCount: number;
  // Saldo por cobrar (solo si hay counterparty con facturas)
  saldoPorCobrar?: {
    facturado: number;
    saldoInicial: number;
    pagosIdentificados: number;
    /** Retenciones (retefuente + reteica + autorete) ya descontadas del saldo.
     *  Mostrarlas en el desglose evita que el cliente piense que el saldo
     *  pendiente no cuadra con "facturado − pagos". */
    retenciones?: number;
    saldoPendiente: number;
  };
  // Tabla
  rows: PaymentsLogPdfRow[];
  /** Remisión opcional — si está, se agregan páginas extra al final con el
   *  detalle de la remisión. No cambia el cuerpo principal del reporte. */
  remision?: RemisionPdfBlock;
}

const COLORS = {
  ink: [33, 37, 41] as [number, number, number],
  muted: [110, 110, 115] as [number, number, number],
  rule: [225, 225, 230] as [number, number, number],
  panel: [248, 249, 251] as [number, number, number],
  panelBorder: [220, 222, 228] as [number, number, number],
  brand: [60, 100, 80] as [number, number, number],
  success: [40, 130, 80] as [number, number, number],
  warning: [180, 110, 30] as [number, number, number],
};

function fmt(n: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function setText(doc: jsPDF, c: [number, number, number]) {
  doc.setTextColor(c[0], c[1], c[2]);
}
function setFill(doc: jsPDF, c: [number, number, number]) {
  doc.setFillColor(c[0], c[1], c[2]);
}
function setStroke(doc: jsPDF, c: [number, number, number]) {
  doc.setDrawColor(c[0], c[1], c[2]);
}

export function generatePaymentsLogPdf(data: PaymentsLogPdfData): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 20;
  const hasLetterhead = !!data.letterheadDataUri;

  // Letterhead background
  if (hasLetterhead) {
    try {
      doc.addImage(data.letterheadDataUri!, data.letterheadFormat ?? 'PNG', 0, 0, pageW, pageH, undefined, 'FAST');
    } catch (e) {
      console.error('Error letterhead:', e);
    }
  }

  const topMargin = hasLetterhead ? data.letterheadTopMarginMm ?? 35 : 20;
  const bottomMargin = hasLetterhead ? data.letterheadBottomMarginMm ?? 25 : 18;
  let y = topMargin;

  // Header empresa (si no hay letterhead)
  if (!hasLetterhead) {
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(data.empresaNombre.toUpperCase(), marginX, y);
    y += 4.5;
    if (data.empresaNit || data.empresaCiudad) {
      setText(doc, COLORS.muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text([data.empresaNit ? `NIT ${data.empresaNit}` : '', data.empresaCiudad].filter(Boolean).join(' · '), marginX, y);
    }
    y += 6;
    setStroke(doc, COLORS.rule);
    doc.setLineWidth(0.3);
    doc.line(marginX, y, pageW - marginX, y);
    y += 8;
  } else {
    y += 8;
  }

  // Título + filtros
  setText(doc, COLORS.ink);
  doc.setFont('times', 'bold');
  doc.setFontSize(16);
  doc.text(data.counterparty ? `Estado de cuenta — ${data.counterparty}` : 'Relación de pagos', marginX, y);
  y += 6;
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(data.periodoLabel, marginX, y);
  y += 8;

  // KPIs en 3 columnas
  const kpiW = (pageW - 2 * marginX - 8) / 3;
  const kpiH = 18;
  const kpis = [
    { label: data.counterparty ? 'TE PAGARON (BANCO)' : 'INGRESOS (BANCO)', value: fmt(data.tePagaron), color: COLORS.success },
    { label: data.counterparty ? 'LE PAGASTE (BANCO)' : 'EGRESOS (BANCO)', value: fmt(data.lePagaste), color: COLORS.warning },
    { label: 'MOVIMIENTOS', value: String(data.movimientosCount), color: COLORS.ink },
  ];
  kpis.forEach((k, i) => {
    const x = marginX + i * (kpiW + 4);
    setFill(doc, COLORS.panel);
    setStroke(doc, COLORS.panelBorder);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, kpiW, kpiH, 1.5, 1.5, 'FD');
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(k.label, x + 4, y + 5);
    setText(doc, k.color);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(k.value, x + 4, y + 13);
  });
  y += kpiH + 8;

  // Card Saldo por cobrar
  if (data.saldoPorCobrar && data.counterparty) {
    const s = data.saldoPorCobrar;
    const showRet = (s.retenciones ?? 0) > 0;
    // Si hay retenciones, agregamos una línea más al desglose → card un poco
    // más alta para no encimar texto.
    const cardH = showRet ? 42 : 36;
    setFill(doc, [254, 252, 247]);
    setStroke(doc, [230, 215, 180]);
    doc.setLineWidth(0.3);
    doc.roundedRect(marginX, y, pageW - 2 * marginX, cardH, 1.5, 1.5, 'FD');
    setText(doc, [110, 80, 30]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('TE DEBEN (SALDO POR COBRAR)', marginX + 4, y + 6);
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(fmt(s.saldoPendiente), marginX + 4, y + 16);

    // Desglose: 2 columnas (label izq, valor der). Sin caracteres unicode
    // raros que rompan el kerning de Helvetica.
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const labelX = pageW / 2 + 6;
    const valueX = pageW - marginX - 4;
    let by = y + 9;
    const lineSpacing = 4.2;

    doc.text('Facturado:', labelX, by);
    doc.text(fmt(s.facturado), valueX, by, { align: 'right' });
    by += lineSpacing;

    doc.text('Saldo inicial:', labelX, by);
    doc.text(fmt(s.saldoInicial), valueX, by, { align: 'right' });
    by += lineSpacing;

    setText(doc, COLORS.success);
    doc.text('Pagos identificados:', labelX, by);
    doc.text(`-${fmt(s.pagosIdentificados).replace('$ ', '$ ')}`, valueX, by, { align: 'right' });
    by += lineSpacing;

    if (showRet) {
      setText(doc, COLORS.success);
      doc.text('Retenciones aplicadas:', labelX, by);
      doc.text(`-${fmt(s.retenciones ?? 0)}`, valueX, by, { align: 'right' });
      by += lineSpacing;
    }

    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.text('Saldo pendiente:', labelX, by);
    doc.text(fmt(s.saldoPendiente), valueX, by, { align: 'right' });

    y += cardH + 8;
  }

  // Tabla
  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(`Detalle de movimientos (${data.rows.length})`, marginX, y);
  y += 5;

  // Headers de columnas
  const colW = {
    fecha: 20,
    tipo: 18,
    origen: 18,
    desc: 70,
    factura: 22,
    monto: 27,
  };
  const colX = {
    fecha: marginX,
    tipo: marginX + colW.fecha,
    origen: marginX + colW.fecha + colW.tipo,
    desc: marginX + colW.fecha + colW.tipo + colW.origen,
    factura: marginX + colW.fecha + colW.tipo + colW.origen + colW.desc,
    monto: marginX + colW.fecha + colW.tipo + colW.origen + colW.desc + colW.factura,
  };

  setFill(doc, COLORS.panel);
  doc.rect(marginX, y, pageW - 2 * marginX, 6, 'F');
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('FECHA', colX.fecha + 1, y + 4);
  doc.text('TIPO', colX.tipo + 1, y + 4);
  doc.text('ORIGEN', colX.origen + 1, y + 4);
  doc.text('DESCRIPCIÓN', colX.desc + 1, y + 4);
  doc.text('FACTURA', colX.factura + 1, y + 4);
  doc.text('MONTO', colX.monto + colW.monto - 1, y + 4, { align: 'right' });
  y += 6;

  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const rowH = 5.5;

  for (const r of data.rows) {
    if (y + rowH > pageH - bottomMargin) {
      doc.addPage();
      if (hasLetterhead) {
        try {
          doc.addImage(data.letterheadDataUri!, data.letterheadFormat ?? 'PNG', 0, 0, pageW, pageH, undefined, 'FAST');
        } catch {}
      }
      y = topMargin + 5;
    }

    setStroke(doc, COLORS.rule);
    doc.setLineWidth(0.1);
    doc.line(marginX, y + rowH - 0.5, pageW - marginX, y + rowH - 0.5);

    setText(doc, COLORS.ink);
    const dateShort = r.date.slice(5).replace('-', '/'); // MM/DD
    doc.text(dateShort, colX.fecha + 1, y + 3.8);

    setText(doc, r.type === 'ingreso' ? COLORS.success : COLORS.warning);
    doc.text(r.type === 'ingreso' ? 'Ingreso' : 'Egreso', colX.tipo + 1, y + 3.8);

    setText(doc, COLORS.muted);
    doc.text(r.source === 'banco' ? 'Banco' : 'Efectivo', colX.origen + 1, y + 3.8);

    setText(doc, COLORS.ink);
    const descTrunc = doc.splitTextToSize(r.description, colW.desc - 2)[0] ?? '';
    doc.text(descTrunc, colX.desc + 1, y + 3.8);

    setText(doc, COLORS.muted);
    doc.text(r.invoice_ref ?? '—', colX.factura + 1, y + 3.8);

    setText(doc, r.type === 'ingreso' ? COLORS.success : COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.text(fmt(r.amount), colX.monto + colW.monto - 1, y + 3.8, { align: 'right' });
    doc.setFont('helvetica', 'normal');

    y += rowH;
  }

  // Totales al pie
  if (data.rows.length > 0) {
    y += 2;
    setStroke(doc, COLORS.ink);
    doc.setLineWidth(0.4);
    doc.line(marginX, y, pageW - marginX, y);
    y += 4;
    const totalIngresos = data.rows.filter(r => r.type === 'ingreso').reduce((s, r) => s + r.amount, 0);
    const totalEgresos = data.rows.filter(r => r.type === 'egreso').reduce((s, r) => s + r.amount, 0);
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('TOTAL INGRESOS:', colX.factura - 5, y, { align: 'right' });
    setText(doc, COLORS.success);
    doc.text(fmt(totalIngresos), colX.monto + colW.monto - 1, y, { align: 'right' });
    y += 4.5;
    setText(doc, COLORS.ink);
    doc.text('TOTAL EGRESOS:', colX.factura - 5, y, { align: 'right' });
    setText(doc, COLORS.warning);
    doc.text(fmt(totalEgresos), colX.monto + colW.monto - 1, y, { align: 'right' });
    y += 4.5;
    setText(doc, COLORS.ink);
    doc.text('NETO:', colX.factura - 5, y, { align: 'right' });
    doc.text(fmt(totalIngresos - totalEgresos), colX.monto + colW.monto - 1, y, { align: 'right' });
  }

  // Páginas extra: remisión adjunta (opcional).
  if (data.remision) {
    appendRemisionPages(doc, data, topMargin, bottomMargin);
  }

  addAluminiaFooter(doc);
  return doc;
}

// Renderiza la remisión en una (o varias) páginas nuevas. Usa el mismo
// look & feel del reporte: panel de KPI, tabla con headers grises, totales
// al pie. La primera página arranca con un encabezado claro que indique al
// cliente que es la remisión asociada al estado de cuenta anterior.
function appendRemisionPages(
  doc: jsPDF,
  data: PaymentsLogPdfData,
  topMargin: number,
  bottomMargin: number,
) {
  const r = data.remision!;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 20;
  const hasLetterhead = !!data.letterheadDataUri;

  const startNewPage = () => {
    doc.addPage();
    if (hasLetterhead) {
      try {
        doc.addImage(data.letterheadDataUri!, data.letterheadFormat ?? 'PNG', 0, 0, pageW, pageH, undefined, 'FAST');
      } catch {}
    }
  };

  startNewPage();
  let y = topMargin;

  // Título
  setText(doc, COLORS.ink);
  doc.setFont('times', 'bold');
  doc.setFontSize(16);
  doc.text(`Remisión ${r.number}`, marginX, y);
  y += 6;
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const sub: string[] = [];
  if (r.date) sub.push(`Fecha: ${r.date}`);
  if (r.beneficiary) sub.push(`Beneficiario: ${r.beneficiary}`);
  doc.text(sub.join(' · '), marginX, y);
  y += 8;

  // Caja informativa: aclara la relación con el reporte de arriba.
  setFill(doc, COLORS.panel);
  setStroke(doc, COLORS.panelBorder);
  doc.setLineWidth(0.2);
  doc.roundedRect(marginX, y, pageW - 2 * marginX, 10, 1.5, 1.5, 'FD');
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.text('Detalle de la remisión asociada al estado de cuenta anterior.', marginX + 4, y + 6.5);
  y += 14;

  // Notas (si hay)
  if (r.notes && r.notes.trim()) {
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('NOTAS', marginX, y);
    y += 4;
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const notesLines = doc.splitTextToSize(r.notes.trim(), pageW - 2 * marginX);
    doc.text(notesLines, marginX, y);
    y += notesLines.length * 4 + 4;
  }

  // Tabla items
  const hasCosts = r.items.some(it => it.unit_cost > 0 || it.total_cost > 0);
  const colW = hasCosts
    ? { ref: 28, name: 75, units: 18, cost: 25, total: 29 }
    : { ref: 36, name: 99, units: 20, cost: 0, total: 20 };
  const colX = {
    ref: marginX,
    name: marginX + colW.ref,
    units: marginX + colW.ref + colW.name,
    cost: marginX + colW.ref + colW.name + colW.units,
    total: marginX + colW.ref + colW.name + colW.units + colW.cost,
  };

  setFill(doc, COLORS.panel);
  doc.rect(marginX, y, pageW - 2 * marginX, 6, 'F');
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('REFERENCIA', colX.ref + 1, y + 4);
  doc.text('PRODUCTO', colX.name + 1, y + 4);
  doc.text('UNIDADES', colX.units + colW.units - 1, y + 4, { align: 'right' });
  if (hasCosts) {
    doc.text('COSTO UNIT.', colX.cost + colW.cost - 1, y + 4, { align: 'right' });
    doc.text('TOTAL', colX.total + colW.total - 1, y + 4, { align: 'right' });
  } else {
    // Sin costos sólo cerramos la columna TOTAL como vacía para no descuadrar.
    doc.text('', colX.total, y + 4);
  }
  y += 6;

  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const rowH = 5.5;

  let totalUnidades = 0;
  let totalValor = 0;

  for (const it of r.items) {
    if (y + rowH > pageH - bottomMargin) {
      startNewPage();
      y = topMargin + 5;
      // Re-renderizar header de tabla en página continuación
      setFill(doc, COLORS.panel);
      doc.rect(marginX, y, pageW - 2 * marginX, 6, 'F');
      setText(doc, COLORS.muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text('REFERENCIA', colX.ref + 1, y + 4);
      doc.text('PRODUCTO', colX.name + 1, y + 4);
      doc.text('UNIDADES', colX.units + colW.units - 1, y + 4, { align: 'right' });
      if (hasCosts) {
        doc.text('COSTO UNIT.', colX.cost + colW.cost - 1, y + 4, { align: 'right' });
        doc.text('TOTAL', colX.total + colW.total - 1, y + 4, { align: 'right' });
      }
      y += 6;
      setText(doc, COLORS.ink);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
    }

    setStroke(doc, COLORS.rule);
    doc.setLineWidth(0.1);
    doc.line(marginX, y + rowH - 0.5, pageW - marginX, y + rowH - 0.5);

    setText(doc, COLORS.ink);
    const refTrunc = doc.splitTextToSize(it.reference ?? '', colW.ref - 2)[0] ?? '';
    doc.text(refTrunc, colX.ref + 1, y + 3.8);

    const nameTrunc = doc.splitTextToSize(it.product_name ?? '', colW.name - 2)[0] ?? '';
    doc.text(nameTrunc, colX.name + 1, y + 3.8);

    doc.text(
      new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(it.units),
      colX.units + colW.units - 1, y + 3.8, { align: 'right' },
    );

    if (hasCosts) {
      setText(doc, COLORS.muted);
      doc.text(it.unit_cost > 0 ? fmt(it.unit_cost) : '—', colX.cost + colW.cost - 1, y + 3.8, { align: 'right' });
      setText(doc, COLORS.ink);
      doc.setFont('helvetica', 'bold');
      doc.text(it.total_cost > 0 ? fmt(it.total_cost) : '—', colX.total + colW.total - 1, y + 3.8, { align: 'right' });
      doc.setFont('helvetica', 'normal');
    }

    totalUnidades += Number(it.units) || 0;
    totalValor += Number(it.total_cost) || 0;
    y += rowH;
  }

  // Totales al pie
  y += 2;
  setStroke(doc, COLORS.ink);
  doc.setLineWidth(0.4);
  doc.line(marginX, y, pageW - marginX, y);
  y += 4;

  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('TOTAL UNIDADES:', colX.units - 5, y, { align: 'right' });
  doc.text(
    new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(totalUnidades),
    colX.units + colW.units - 1, y, { align: 'right' },
  );

  if (hasCosts) {
    const valorFinal = r.totalManual != null && r.totalManual > 0 ? r.totalManual : totalValor;
    y += 4.5;
    doc.text('VALOR TOTAL:', colX.units - 5, y, { align: 'right' });
    setText(doc, COLORS.brand);
    doc.text(fmt(valorFinal), colX.total + colW.total - 1, y, { align: 'right' });
  }
}
