import jsPDF from 'jspdf';
import { addAluminiaFooter } from './pdfBranding';
import type { InformeBancoData, SemaforoColor } from '@/hooks/useInformeBancoData';
import { DOCUMENTOS_BANCO, CATEGORY_LABELS, type DocCategory } from './informeBancoDocs';

const COLORS = {
  ink: [33, 37, 41] as [number, number, number],
  muted: [110, 110, 115] as [number, number, number],
  rule: [225, 225, 230] as [number, number, number],
  panel: [248, 249, 251] as [number, number, number],
  panelBorder: [220, 222, 228] as [number, number, number],
  brand: [54, 105, 78] as [number, number, number],
  green: [40, 130, 80] as [number, number, number],
  amber: [180, 110, 30] as [number, number, number],
  red: [200, 60, 50] as [number, number, number],
};

function fmt(n: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n);
}

function setText(doc: jsPDF, c: [number, number, number]) { doc.setTextColor(c[0], c[1], c[2]); }
function setFill(doc: jsPDF, c: [number, number, number]) { doc.setFillColor(c[0], c[1], c[2]); }
function setStroke(doc: jsPDF, c: [number, number, number]) { doc.setDrawColor(c[0], c[1], c[2]); }

function semaforoColor(s: SemaforoColor): [number, number, number] {
  if (s === 'green') return COLORS.green;
  if (s === 'yellow') return COLORS.amber;
  return COLORS.red;
}
function semaforoLabel(s: SemaforoColor): string {
  if (s === 'green') return 'Bueno';
  if (s === 'yellow') return 'Revisar';
  return 'Crítico';
}

export function generateInformeBancoPdf(data: InformeBancoData): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 22;

  // ============= PORTADA =============
  // Banda superior brand
  setFill(doc, COLORS.brand);
  doc.rect(0, 0, pageW, 36, 'F');

  // Logo grande + título
  setFill(doc, [255, 255, 255]);
  doc.roundedRect(marginX, 11, 14, 14, 2, 2, 'F');
  setText(doc, COLORS.brand);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('A', marginX + 7, 21, { align: 'center' });

  setText(doc, [255, 255, 255]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('AluminIA', marginX + 22, 19);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Informe Financiero para Banco', marginX + 22, 26);

  // Empresa header
  let y = 50;
  setText(doc, COLORS.ink);
  doc.setFont('times', 'bold');
  doc.setFontSize(22);
  doc.text(data.empresa.nombre.toUpperCase(), pageW / 2, y, { align: 'center' });
  y += 7;
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const headerLine = [
    data.empresa.nit ? `NIT ${data.empresa.nit}` : null,
    data.empresa.ciudad,
  ].filter(Boolean).join(' · ');
  if (headerLine) doc.text(headerLine, pageW / 2, y, { align: 'center' });
  y += 5;
  if (data.empresa.direccion) {
    doc.text(data.empresa.direccion, pageW / 2, y, { align: 'center' });
    y += 5;
  }
  if (data.empresa.telefono) {
    doc.text(`Tel. ${data.empresa.telefono}`, pageW / 2, y, { align: 'center' });
    y += 5;
  }

  // Acerca del negocio (cualitativo, si tiene datos)
  const hasAbout = !!(data.empresa.descripcion || data.empresa.bodega || data.empresa.empleados || data.empresa.diasOperacion || data.empresa.logistica || data.empresa.proveedoresPrincipales);
  if (hasAbout) {
    y += 5;
    setStroke(doc, COLORS.rule);
    doc.setLineWidth(0.3);
    doc.line(marginX, y, pageW - marginX, y);
    y += 8;
    setText(doc, COLORS.ink);
    doc.setFont('times', 'bold');
    doc.setFontSize(12);
    doc.text('Acerca del negocio', marginX, y);
    y += 6;
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    if (data.empresa.descripcion) {
      const lines = doc.splitTextToSize(data.empresa.descripcion, pageW - 2 * marginX);
      doc.text(lines, marginX, y);
      y += lines.length * 4.5 + 2;
    }
    const kvPairs: Array<[string, string | null]> = [
      ['Bodega', data.empresa.bodega],
      ['Empleados directos', data.empresa.empleados !== null ? String(data.empresa.empleados) : null],
      ['Días de operación', data.empresa.diasOperacion],
    ];
    for (const [k, v] of kvPairs) {
      if (!v) continue;
      setText(doc, COLORS.muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(k.toUpperCase() + ':', marginX, y);
      const labelW = doc.getTextWidth(k.toUpperCase() + ': ') + 1;
      setText(doc, COLORS.ink);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(v, pageW - 2 * marginX - labelW);
      doc.text(lines, marginX + labelW, y);
      y += Math.max(4, lines.length * 4) + 1;
    }
    if (data.empresa.logistica) {
      setText(doc, COLORS.muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('LOGÍSTICA:', marginX, y);
      y += 4;
      setText(doc, COLORS.ink);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(data.empresa.logistica, pageW - 2 * marginX);
      doc.text(lines, marginX, y);
      y += lines.length * 4 + 2;
    }
    if (data.empresa.proveedoresPrincipales) {
      setText(doc, COLORS.muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('PROVEEDORES PRINCIPALES:', marginX, y);
      y += 4;
      setText(doc, COLORS.ink);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(data.empresa.proveedoresPrincipales, pageW - 2 * marginX);
      doc.text(lines, marginX, y);
      y += lines.length * 4 + 2;
    }
  }

  // Periodo
  y += 5;
  setStroke(doc, COLORS.rule);
  doc.setLineWidth(0.3);
  doc.line(marginX, y, pageW - marginX, y);
  y += 8;

  if (y > pageH - 60) {
    doc.addPage();
    y = 22;
  }

  setText(doc, COLORS.ink);
  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.text(`Resumen ejecutivo año ${data.thisYear}`, marginX, y);
  y += 7;

  // Resumen ejecutivo en prosa
  setText(doc, COLORS.ink);
  doc.setFont('times', 'normal');
  doc.setFontSize(10.5);
  const meses = data.empresa.antiguedadMeses;
  const antiguedadStr = meses === 0
    ? 'el negocio aún no tiene historial registrado en el sistema'
    : meses < 12
      ? `el negocio lleva ${meses} meses operando`
      : `el negocio lleva ${Math.floor(meses / 12)} años y ${meses % 12} meses operando`;
  const crecStr = data.crecimientoYoYPct === null
    ? 'no se cuenta con histórico del año anterior para comparar'
    : data.crecimientoYoYPct >= 0
      ? `con un crecimiento de +${data.crecimientoYoYPct.toFixed(1)}% respecto a ${data.thisYear - 1}`
      : `con una contracción de ${data.crecimientoYoYPct.toFixed(1)}% respecto a ${data.thisYear - 1}`;
  const summary = `${data.empresa.nombre} es una empresa donde ${antiguedadStr}. En ${data.thisYear} registra ingresos bancarios por ${fmt(data.ingresosBancoAno)} y egresos por ${fmt(data.egresosBancoAno)}, dejando una utilidad estimada de ${fmt(data.utilidadEstimada)} (margen operativo ${data.margenOperativoPct.toFixed(1)}%), ${crecStr}. El valor de inventario activo es ${fmt(data.valorInventario)}.`;
  const lines = doc.splitTextToSize(summary, pageW - 2 * marginX);
  doc.text(lines, marginX, y);
  y += lines.length * 5.5 + 5;

  // KPIs en grilla 2x2
  const kpiW = (pageW - 2 * marginX - 6) / 2;
  const kpiH = 22;
  const kpis = [
    { label: 'INGRESOS BANCARIOS', value: fmt(data.ingresosBancoAno), sub: `Promedio mensual ${fmt(data.promedioVentasMensual)}` },
    { label: 'EGRESOS BANCARIOS', value: fmt(data.egresosBancoAno), sub: '' },
    { label: 'UTILIDAD ESTIMADA', value: fmt(data.utilidadEstimada), sub: `Margen ${data.margenOperativoPct.toFixed(1)}%` },
    { label: 'VALOR INVENTARIO', value: fmt(data.valorInventario), sub: '' },
  ];
  kpis.forEach((k, i) => {
    const x = marginX + (i % 2) * (kpiW + 6);
    const ky = y + Math.floor(i / 2) * (kpiH + 4);
    setFill(doc, COLORS.panel);
    setStroke(doc, COLORS.panelBorder);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, ky, kpiW, kpiH, 1.5, 1.5, 'FD');
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(k.label, x + 4, ky + 5);
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(k.value, x + 4, ky + 12);
    if (k.sub) {
      setText(doc, COLORS.muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(k.sub, x + 4, ky + 18);
    }
  });
  y += 2 * (kpiH + 4) + 3;

  // ============= PÁGINA 2: TOP CLIENTES + PREGUNTAS =============
  doc.addPage();
  y = 22;
  setText(doc, COLORS.ink);
  doc.setFont('times', 'bold');
  doc.setFontSize(14);
  doc.text('Top clientes y concentración', marginX, y);
  y += 8;

  if (data.topClientes.length === 0) {
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.text('Sin facturación registrada en el período.', marginX, y);
    y += 8;
  } else {
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('CLIENTE', marginX, y);
    doc.text('% TOTAL', pageW - marginX - 50, y, { align: 'right' });
    doc.text('FACTURADO', pageW - marginX, y, { align: 'right' });
    y += 4;
    setStroke(doc, COLORS.rule);
    doc.setLineWidth(0.2);
    doc.line(marginX, y, pageW - marginX, y);
    y += 4;
    data.topClientes.forEach((c, i) => {
      setText(doc, COLORS.ink);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`${i + 1}. ${c.name}`, marginX, y);
      doc.setFont('helvetica', 'bold');
      doc.text(`${c.pct.toFixed(1)}%`, pageW - marginX - 50, y, { align: 'right' });
      doc.text(fmt(c.total), pageW - marginX, y, { align: 'right' });
      y += 6;
    });
    y += 3;
  }

  // Lo que el banco va a preguntar
  y += 5;
  setText(doc, COLORS.ink);
  doc.setFont('times', 'bold');
  doc.setFontSize(14);
  doc.text('Preguntas frecuentes del banco', marginX, y);
  y += 5;
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.text('Respuestas calculadas con datos reales del negocio.', marginX, y);
  y += 8;

  for (const m of data.metricas) {
    if (y > pageH - 40) {
      doc.addPage();
      y = 22;
    }
    const semColor = semaforoColor(m.semaforo);
    const cardH = m.detalle ? 22 : 16;

    setFill(doc, [...semColor, 0.06] as never);
    setFill(doc, COLORS.panel);
    setStroke(doc, COLORS.panelBorder);
    doc.setLineWidth(0.2);
    doc.roundedRect(marginX, y, pageW - 2 * marginX, cardH, 1.5, 1.5, 'FD');

    // Punto de color semáforo
    setFill(doc, semColor);
    doc.circle(marginX + 4, y + 5, 1.3, 'F');

    // Pregunta
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(m.pregunta.toUpperCase(), marginX + 8, y + 5);

    // Badge semáforo a la derecha
    setText(doc, semColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(semaforoLabel(m.semaforo).toUpperCase(), pageW - marginX - 4, y + 5, { align: 'right' });

    // Respuesta
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(m.respuesta, marginX + 8, y + 11);

    // Detalle
    if (m.detalle) {
      setText(doc, COLORS.muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const detalleLines = doc.splitTextToSize(m.detalle, pageW - 2 * marginX - 12);
      doc.text(detalleLines.slice(0, 1), marginX + 8, y + 17);
    }

    y += cardH + 3;
  }

  // ============= PÁGINA 3: DOCUMENTOS QUE EL BANCO PUEDE PEDIR =============
  doc.addPage();
  y = 22;
  setText(doc, COLORS.ink);
  doc.setFont('times', 'bold');
  doc.setFontSize(14);
  doc.text('Documentos que el banco te puede pedir', marginX, y);
  y += 5;
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.text('Checklist de soporte típico para una solicitud de crédito empresarial.', marginX, y);
  y += 8;

  // Agrupar por categoría
  const cats: DocCategory[] = ['antecedentes', 'fiscales', 'financieros', 'personales', 'operativos'];
  for (const cat of cats) {
    const docsInCat = DOCUMENTOS_BANCO.filter(d => d.category === cat);
    if (docsInCat.length === 0) continue;

    if (y > pageH - 40) {
      doc.addPage();
      y = 22;
    }

    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(CATEGORY_LABELS[cat].toUpperCase(), marginX, y);
    y += 5;

    setStroke(doc, COLORS.rule);
    doc.setLineWidth(0.2);
    doc.line(marginX, y - 2, pageW - marginX, y - 2);

    for (const d of docsInCat) {
      if (y > pageH - 30) {
        doc.addPage();
        y = 22;
      }

      // Checkbox visual (cuadrito vacío)
      setStroke(doc, COLORS.muted);
      doc.setLineWidth(0.3);
      doc.rect(marginX, y - 2.5, 3, 3);

      // Nombre
      setText(doc, COLORS.ink);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(d.nombre, marginX + 5, y);

      // Costo badge si tiene
      if (d.costoLabel) {
        setText(doc, COLORS.muted);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        const costoX = marginX + 5 + doc.getTextWidth(d.nombre) + 3;
        doc.text(`(${d.costoLabel})`, costoX, y);
      }

      // Descripción
      setText(doc, COLORS.muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const descLines = doc.splitTextToSize(d.descripcion, pageW - 2 * marginX - 5);
      doc.text(descLines.slice(0, 2), marginX + 5, y + 4);
      y += 4 + Math.min(descLines.length, 2) * 3.5;

      // Link
      if (d.link) {
        setText(doc, COLORS.brand);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        const linkText = `→ ${d.linkLabel ?? d.link}`;
        doc.textWithLink(linkText, marginX + 5, y, { url: d.link });
        y += 4;
      }

      y += 2.5;
    }
    y += 3;
  }

  // Disclaimer al pie
  if (y > pageH - 30) {
    doc.addPage();
    y = 22;
  } else {
    y = pageH - 28;
  }
  setStroke(doc, COLORS.rule);
  doc.setLineWidth(0.2);
  doc.line(marginX, y, pageW - marginX, y);
  y += 5;
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  const disclaimer = 'AluminIA es una herramienta de apoyo para la gestión financiera. Este informe se construye automáticamente con la información registrada por el usuario en el sistema. Los estados financieros formales requeridos por entidades bancarias y autoridades tributarias deben ser firmados por un contador público titulado.';
  const disclaimerLines = doc.splitTextToSize(disclaimer, pageW - 2 * marginX);
  doc.text(disclaimerLines, marginX, y);

  // Footer branding en todas las páginas
  addAluminiaFooter(doc);

  return doc;
}
