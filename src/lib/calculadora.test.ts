import { describe, it, expect } from 'vitest';
import { teclear, evaluar, mostrar, borrarUltimo, resultadoComoExpresion } from './calculadora';

const escribir = (teclas: string) => [...teclas].reduce((e, t) => teclear(e, t), '');

describe('evaluar', () => {
  it('respeta la precedencia: × y ÷ antes que + y −', () => {
    expect(evaluar('2+3×4')).toBe(14);
    expect(evaluar('20−12÷4')).toBe(17);
    expect(evaluar('16×6+4')).toBe(100);
  });
  it('decimales con coma y sin ruido de coma flotante', () => {
    expect(evaluar('0,1+0,2')).toBe(0.3);
    expect(evaluar('2,5×40')).toBe(100);
  });
  it('negativo al comienzo', () => {
    expect(evaluar('−5+8')).toBe(3);
  });
  it('mientras se escribe ignora el operador del final', () => {
    expect(evaluar('12×')).toBe(12);
    expect(evaluar('')).toBeNull();
  });
  it('división por cero = sin resultado', () => {
    expect(evaluar('5÷0')).toBeNull();
  });
});

describe('teclear', () => {
  it('no deja dos operadores seguidos: el último reemplaza', () => {
    expect(escribir('5+×3')).toBe('5×3');
  });
  it('una sola coma por número y "0," si empieza con coma', () => {
    expect(escribir(',5,5')).toBe('0,55');
    expect(escribir('1,5+,2')).toBe('1,5+0,2');
  });
  it('no arranca con × ni ÷; sí con −', () => {
    expect(escribir('×5')).toBe('5');
    expect(escribir('−5')).toBe('−5');
  });
  it('quita ceros a la izquierda', () => {
    expect(escribir('007')).toBe('7');
  });
  it('borrar el último caracter', () => {
    expect(borrarUltimo('12+3')).toBe('12+');
  });
});

describe('mostrar / resultadoComoExpresion', () => {
  it('formato es-CO', () => {
    expect(mostrar(1234.5)).toBe('1.234,5');
    expect(mostrar(null)).toBe('');
  });
  it('el resultado sirve para seguir calculando', () => {
    expect(resultadoComoExpresion(2.5)).toBe('2,5');
    expect(resultadoComoExpresion(-3)).toBe('−3');
    expect(evaluar(resultadoComoExpresion(-3) + '+5')).toBe(2);
  });
});
