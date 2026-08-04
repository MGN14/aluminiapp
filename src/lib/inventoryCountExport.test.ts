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
  const lineas = [
    linea({ variant_reference: 'A', stock_teorico: 100, stock_contado: 90, costo_unitario: 1000 }),
    linea({ variant_reference: 'B', stock_teorico: 50, stock_contado: 55, costo_unitario: 2000 }),
    linea({ variant_reference: 'C', stock_teorico: 30, stock_contado: 30, costo_unitario: 500 }),
    linea({ variant_reference: 'D', stock_teorico: 20, stock_contado: 20, costo_unitario: 300, nota: 'no vino en el archivo' }),
  ];

  it('valoriza faltantes y sobrantes al costo unitario', () => {
    const t = totalizar(calcularLineas(lineas, false));
    expect(t.conDif).toBe(2);
    expect(t.unidadesFaltan).toBe(-10);
    expect(t.valorFaltan).toBe(-10_000);
    expect(t.unidadesSobran).toBe(5);
    expect(t.valorSobran).toBe(10_000);
    expect(t.valorNeto).toBe(0);
  });

  it('no toca lo que no vino en el archivo si el conteo es parcial', () => {
    const d = calcularLineas(lineas, false).find((c) => c.linea.variant_reference === 'D')!;
    expect(d.estado).toBe('Sin contar');
    expect(d.diferencia).toBe(0);
  });

  it('con conteo completo, lo no contado se ancla en 0 y cuenta como merma', () => {
    const calc = calcularLineas(lineas, true);
    const d = calc.find((c) => c.linea.variant_reference === 'D')!;
    expect(d.contado).toBe(0);
    expect(d.diferencia).toBe(-20);
    expect(d.valor).toBe(-6000);
    expect(totalizar(calc).valorNeto).toBe(-6000);
  });
});
