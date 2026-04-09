/**
 * Parse a YYYY-MM-DD date string as a local date (not UTC).
 * 
 * `new Date("2025-01-15")` is parsed as UTC midnight, which can shift
 * to the previous day in negative UTC offsets (e.g. Colombia UTC-5).
 * 
 * This function appends "T00:00:00" so the date is treated as local time.
 * For non-date-only strings (timestamps), it falls back to normal parsing.
 */
export function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  // Match YYYY-MM-DD (date-only, no time component)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr + 'T00:00:00');
  }
  // Already has time component or is a full ISO string
  return new Date(dateStr);
}
