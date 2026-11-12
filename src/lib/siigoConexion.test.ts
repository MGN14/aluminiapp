import { describe, it, expect } from 'vitest';
import { clasificarErrorSiigo, mensajeErrorSiigo, debeReintentarSiigo } from './siigoConexion';

const HTML_403 = "auth 403: <!DOCTYPE html PUBLIC '-//W3C//DTD XHTML 1.0 Transitional//EN'";
const ahora = Date.parse('2026-11-12T22:00:00Z');

describe('clasificarErrorSiigo', () => {
  it('403 HTML (caso real 2026-11-12) es pasajero', () => {
    expect(clasificarErrorSiigo(HTML_403)).toBe('pasajero');
  });
  it('400/401 es de clave', () => {
    expect(clasificarErrorSiigo('auth 401: {"Errors":[{"Code":"invalid_grant"}]}')).toBe('clave');
    expect(clasificarErrorSiigo('auth 400: bad request')).toBe('clave');
  });
  it('429, 5xx y errores de red son pasajeros', () => {
    expect(clasificarErrorSiigo('auth 429: too many')).toBe('pasajero');
    expect(clasificarErrorSiigo('auth 503: down')).toBe('pasajero');
    expect(clasificarErrorSiigo('fetch failed')).toBe('pasajero');
    expect(clasificarErrorSiigo(null)).toBe('pasajero');
  });
});

describe('mensajeErrorSiigo', () => {
  it('no muestra el HTML crudo', () => {
    const m = mensajeErrorSiigo(HTML_403);
    expect(m).toContain('error 403');
    expect(m).not.toContain('DOCTYPE');
  });
  it('error de clave pide revisar usuario y access key', () => {
    expect(mensajeErrorSiigo('auth 401: x')).toContain('usuario o la access key');
  });
  it('vacío si no hay error', () => {
    expect(mensajeErrorSiigo(null)).toBe('');
  });
});

describe('debeReintentarSiigo', () => {
  it('reintenta un 403 de hace más de media hora', () => {
    expect(debeReintentarSiigo({ estado: 'error', lastError: HTML_403, updatedAt: '2026-11-12T19:56:25Z' }, ahora)).toBe(true);
  });
  it('espera si el error es reciente', () => {
    expect(debeReintentarSiigo({ estado: 'error', lastError: HTML_403, updatedAt: '2026-11-12T21:45:00Z' }, ahora)).toBe(false);
  });
  it('nunca reintenta solo un error de clave', () => {
    expect(debeReintentarSiigo({ estado: 'error', lastError: 'auth 401: x', updatedAt: '2026-11-01T00:00:00Z' }, ahora)).toBe(false);
  });
  it('solo aplica a estado error (no revoked ni pending)', () => {
    expect(debeReintentarSiigo({ estado: 'revoked', lastError: HTML_403, updatedAt: null }, ahora)).toBe(false);
    expect(debeReintentarSiigo({ estado: 'connected', lastError: null, updatedAt: null }, ahora)).toBe(false);
  });
});
