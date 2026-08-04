import { describe, it, expect } from 'vitest';
import { calcularLineas, totalizar } from './inventoryCountExport';
import type { CountLine } from '@/hooks/useInventoryCount';

const linea = (p: Partial<CountLine>): CountLine => ({
  id: p.variant_reference ?? 'x', session_id: 's', variant_id: 'v',
  variant_reference: 'REF', descripcion: null,
  stock_teorico: 0, stock_contado: 0, diferencia: 0, costo_unitario: 0,
  es_nueva: false, nota: null, ...p,
});

describe('calcularLineas — conteo físico vs teórico', () => {
  // Regla de Nico (2026-08-04): lo que no vino en el archivo llega al
  // borrador con contado 0 — cuenta como merma, sin casos especiales.
  const lineas = [
    linea({ variant_reference: 'A', stock_teorico: 100, stock_contado: 90, costo_unitario: 1000 }),
    linea({ variant_reference: 'B', stock_teorico: 50, stock_contado: 55, costo_unitario: 2000 }),
    linea({ variant_reference: 'C', stock_teorico: 30, stock_contado: 30, costo_unitario: 500 }),
    linea({ variant_reference: 'D', stock_teorico: 20, stock_contado: 0, costo_unitario: 300, nota: 'no vino en el archivo' }),
  ];

  it('valoriza faltantes y sobrantes al costo unitario', () => {
    const t = totalizar(calcularLineas(lineas));
    expect(t.conDif).toBe(3);
    expect(t.unidadesFaltan).toBe(-30);      // A: −10, D: −20
    expect(t.valorFaltan).toBe(-16_000);     // −10×1000 − 20×300
    expect(t.unidadesSobran).toBe(5);
    expect(t.valorSobran).toBe(10_000);
    expect(t.valorNeto).toBe(-6_000);
  });

  it('lo que no vino en el archivo es merma: teórico 20, contado 0 → diferencia −20', () => {
    const calc = calcularLineas(lineas);
    const d = calc.find((c) => c.linea.variant_reference === 'D')!;
    expect(d.estado).toBe('Faltante');
    expect(d.diferencia).toBe(-20);
    expect(d.valor).toBe(-6_000);
    expect(totalizar(calc).noVinieron).toBe(1);
  });

  it('cuenta referencias faltantes y sobrantes por separado', () => {
    const t = totalizar(calcularLineas(lineas));
    expect(t.lineasFaltan).toBe(2);
    expect(t.lineasSobran).toBe(1);
  });
});
