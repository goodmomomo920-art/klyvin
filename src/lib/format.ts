/** Money, dates and small display helpers. All amounts are integer cents. */

const CURRENCY_LABEL: Record<string, string> = {
  EGP: 'ج.م',
  SAR: 'ر.س',
  AED: 'د.إ',
  USD: '$',
};

/** 12500 → "125 ج.م" (Arabic-Indic digits are avoided for readability). */
export function money(cents: number, currency = 'EGP'): string {
  const value = cents / 100;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${text} ${CURRENCY_LABEL[currency] ?? currency}`;
}

/** Parses a user-typed price ("125", "125.5") into cents. Returns null if invalid. */
export function parsePriceToCents(input: string | null | undefined): number | null {
  if (!input) return null;
  const cleaned = input.replace(/[,\s]/g, '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** "2026-11-25 22:10:00" (SQLite) → "25 نوفمبر 2026". */
export function arabicDate(value: string | null | undefined): string {
  if (!value) return '—';
  const normalised = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const date = new Date(normalised);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Cairo',
  }).format(date);
}

/** Short numeric reference shown to customers, e.g. #1042. */
export function shortRef(reference: string): string {
  return reference.replace(/^ord_/, '#').slice(0, 10).toUpperCase();
}
