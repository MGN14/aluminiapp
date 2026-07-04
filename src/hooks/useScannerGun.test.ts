import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScannerGun } from './useScannerGun';

// Simula la pistola HID: "teclea" cada carácter como keydown en window.
let now = 0;
const key = (k: string, target?: EventTarget) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true });
  (target ?? window).dispatchEvent(ev);
};
const burst = (text: string, msPerChar = 10) => {
  for (const c of text) { now += msPerChar; key(c); }
};
const scan = (text: string, terminator = 'Enter') => {
  burst(text);
  now += 10;
  key(terminator);
};

describe('useScannerGun', () => {
  let onScan: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    now = 0;
    onScan = vi.fn();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  it('captura una ráfaga rápida terminada en Enter', () => {
    renderHook(() => useScannerGun({ onScan }));
    scan('ALU|744-100|6');
    expect(onScan).toHaveBeenCalledExactlyOnceWith('ALU|744-100|6');
  });

  it('acepta Tab como terminador (pistolas con sufijo Tab)', () => {
    renderHook(() => useScannerGun({ onScan }));
    scan('ALU|744-100|6', 'Tab');
    expect(onScan).toHaveBeenCalledExactlyOnceWith('ALU|744-100|6');
  });

  it('anti doble-disparo: la MISMA lectura repetida enseguida se ignora', () => {
    renderHook(() => useScannerGun({ onScan }));
    scan('ALU|744-100|6');
    now += 200; // la pistola auto-sense relee el mismo QR
    scan('ALU|744-100|6');
    now += 200;
    scan('ALU|744-100|6');
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('la misma lectura pasada la ventana de duplicado SÍ cuenta (otro paquete idéntico)', () => {
    renderHook(() => useScannerGun({ onScan, dupWindowMs: 650 }));
    scan('ALU|744-100|6');
    now += 1000; // el operario se movió al siguiente paquete
    scan('ALU|744-100|6');
    expect(onScan).toHaveBeenCalledTimes(2);
  });

  it('lecturas DISTINTAS seguidas cuentan todas (serials únicos)', () => {
    renderHook(() => useScannerGun({ onScan }));
    scan('ALU|SA325B|40|A1|SA325B-0041');
    now += 100;
    scan('ALU|SA325B|40|A1|SA325B-0042');
    expect(onScan).toHaveBeenCalledTimes(2);
  });

  it('tecleo humano lento (gaps largos) no dispara', () => {
    renderHook(() => useScannerGun({ onScan }));
    burst('AL', 10);
    now += 500; // pausa humana → resetea el buffer
    burst('U', 10);
    now += 10;
    key('Enter'); // buffer quedó en "U", menor a minLength
    expect(onScan).not.toHaveBeenCalled();
  });

  it('un Enter suelto mucho después de la ráfaga no dispara el buffer viejo', () => {
    renderHook(() => useScannerGun({ onScan }));
    burst('ALU|744-100|6');
    now += 5000; // se perdió el Enter del escaneo; alguien toca Enter después
    key('Enter');
    expect(onScan).not.toHaveBeenCalled();
  });

  it('ignora lo tecleado dentro de un input (carga manual)', () => {
    renderHook(() => useScannerGun({ onScan }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    for (const c of '744-100') { now += 10; key(c, input); }
    now += 10;
    key('Enter', input);
    expect(onScan).not.toHaveBeenCalled();
    input.remove();
  });

  it('enabled=false no escucha', () => {
    renderHook(() => useScannerGun({ onScan, enabled: false }));
    scan('ALU|744-100|6');
    expect(onScan).not.toHaveBeenCalled();
  });
});
