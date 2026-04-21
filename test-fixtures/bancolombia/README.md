# Fixtures reales de Bancolombia — marzo 2026

Estos archivos son datos reales de la cuenta de MGN GLOBAL TRADE y se usan como fixtures para tests del parser CSV y del validador de cierre mensual.

## Archivos

- `movimientos_marzo_2026.csv` — 86 filas, formato Bancolombia "Descargar movimientos" (sin headers)
- `extracto_marzo_2026.xlsx` — extracto mensual con resumen (saldos, totales, intereses, retefuente) y 86 filas de movimientos

## Propiedad verificada en el análisis

- Las 86 filas del CSV matchean las 86 del XLSX con la regla `(fecha, valor)` como multiset
- La única diferencia cosmética es `"HOSTGATOR"` (CSV) vs `"HOSTGATOR*"` (XLSX) — se resuelve con normalización de descripción
- Validación contable del extracto: `saldo_anterior + total_abonos − total_cargos = saldo_actual` cuadra exacto

## Privacidad

Contienen número de cuenta real y transacciones reales. Decidir antes de commitear:

- **No commitear** → añadir `test-fixtures/bancolombia/*.csv` y `*.xlsx` al `.gitignore` y distribuir por otro canal
- **Commitear** → aceptar que el repo tenga esta info (si es repo privado, puede ser aceptable)
