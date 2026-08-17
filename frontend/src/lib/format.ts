/**
 * Number and date formatting.
 *
 * All formatters are null-tolerant: the backend serialises an uncomputable
 * value as `null`, and the UI shows an em dash rather than "NaN" or "0".
 *
 * Locale is pinned to `en-GB` so thousands separators and date order stay
 * stable regardless of the viewer's machine - a dashboard whose numbers change
 * shape depending on who opens it is not a reliable instrument.
 */

const LOCALE = 'en-GB'

export const EM_DASH = '—'

const decimal = (min: number, max: number) =>
  new Intl.NumberFormat(LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max })

const money0 = decimal(0, 0)
const money2 = decimal(2, 2)
const plain2 = decimal(2, 2)
const plain4 = decimal(4, 4)

function isMissing(value: number | null | undefined): value is null | undefined {
  return value === null || value === undefined || !Number.isFinite(value)
}

/** `79,999.97` - full precision, for tables and tooltips. */
export function formatMoney(value: number | null | undefined): string {
  return isMissing(value) ? EM_DASH : money2.format(value)
}

/** `80,000` - whole units, for headline figures and chart axes. */
export function formatMoneyCompact(value: number | null | undefined): string {
  return isMissing(value) ? EM_DASH : money0.format(value)
}

/** `+1,234.56` / `-1,234.56` - always signed, for changes and P&L. */
export function formatMoneySigned(value: number | null | undefined): string {
  if (isMissing(value)) return EM_DASH
  return `${value >= 0 ? '+' : '-'}${money2.format(Math.abs(value))}`
}

/**
 * Fraction to percentage: `0.1234` -> `12.34%`.
 * @param digits Decimal places (default 2).
 */
export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (isMissing(value)) return EM_DASH
  return `${decimal(digits, digits).format(value * 100)}%`
}

/** Fraction to signed percentage: `0.1234` -> `+12.34%`. */
export function formatPercentSigned(value: number | null | undefined, digits = 2): string {
  if (isMissing(value)) return EM_DASH
  const magnitude = decimal(digits, digits).format(Math.abs(value) * 100)
  return `${value >= 0 ? '+' : '-'}${magnitude}%`
}

/** Unitless ratio to 2 dp: Sharpe, Sortino, beta. */
export function formatRatio(value: number | null | undefined): string {
  return isMissing(value) ? EM_DASH : plain2.format(value)
}

/** Correlation coefficient to 2 dp, kept in `-1.00 .. 1.00`. */
export function formatCorrelation(value: number | null | undefined): string {
  return isMissing(value) ? EM_DASH : plain2.format(value)
}

/**
 * Instrument quantity. Whole units print without decimals; fractional units
 * (crypto, fractional shares) print enough precision to be meaningful.
 */
export function formatQuantity(value: number | null | undefined): string {
  if (isMissing(value)) return EM_DASH
  if (Number.isInteger(value)) return money0.format(value)
  return value < 1 ? plain4.format(value) : plain2.format(value)
}

/** Price in its own currency, with the ISO code appended. */
export function formatPrice(value: number | null | undefined, currency?: string): string {
  if (isMissing(value)) return EM_DASH
  const amount = money2.format(value)
  return currency ? `${amount} ${currency}` : amount
}

/** `2026-08-14` -> `14 Aug 2026`. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EM_DASH
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return EM_DASH
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/** `2026-08-14` -> `14 Aug`, for dense chart axes. */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return EM_DASH
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return EM_DASH
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(date)
}

/** `2026-08-14` -> `Aug 2026`, for compact window captions. */
export function formatMonthYear(iso: string | null | undefined): string {
  if (!iso) return EM_DASH
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return EM_DASH
  return new Intl.DateTimeFormat(LOCALE, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/** ISO timestamp -> `14 Aug 2026 12:20 UTC`, for the "generated at" label. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return EM_DASH
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return EM_DASH
  const formatted = new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date)
  return `${formatted} UTC`
}

/**
 * CSS class encoding the sign of a value, so colour is applied consistently
 * from one place. Zero and missing values stay neutral - never green.
 */
export function signClass(value: number | null | undefined): 'pos' | 'neg' | 'flat' {
  if (isMissing(value) || value === 0) return 'flat'
  return value > 0 ? 'pos' : 'neg'
}

/** Human label for a performance window. */
export const PERIOD_LABELS: Record<string, string> = {
  day: 'Today',
  week: '1 Week',
  month: '1 Month',
  ytd: 'YTD',
  all: 'All Time',
}
