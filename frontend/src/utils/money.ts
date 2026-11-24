/**
 * Money helpers. Money travels as a string with 2 decimals ("1100.00", conventions.md) and is
 * handled as a string here too: no floats, so nothing is rounded in the browser. Billing totals are
 * always shown as the server returns them; these helpers only parse input and format for display.
 */

export const CURRENCY = 'LKR'

/** Canonical money string: optional minus, digits, dot, exactly 2 decimals. */
export const MONEY_PATTERN = /^-?\d{1,10}\.\d{2}$/

/**
 * Parses what a user typed ("1,250", "1250.5", " 99.") into a canonical money string ("1250.50").
 * Returns null for empty input and undefined for invalid input (letters, 3+ decimals, two dots...).
 */
export function parseMoneyInput(
  raw: string,
  opts: { allowNegative?: boolean } = {},
): string | null | undefined {
  const s = raw.replace(/[\s,]/g, '').replace(/^LKR/i, '')
  if (s === '') return null
  const re = opts.allowNegative ? /^(-?)(\d{0,10})(?:\.(\d{0,2}))?$/ : /^()(\d{0,10})(?:\.(\d{0,2}))?$/
  const m = re.exec(s)
  if (!m) return undefined
  const sign = m[1] ?? ''
  const intPart = (m[2] ?? '').replace(/^0+(?=\d)/, '')
  const frac = m[3] ?? ''
  if (intPart === '' && frac === '') return undefined
  const result = `${intPart === '' ? '0' : intPart}.${frac.padEnd(2, '0')}`
  return sign === '-' && /[1-9]/.test(result) ? `-${result}` : result
}

/** Adds thousands separators to a canonical money string: "1234567.50" -> "1,234,567.50". */
export function groupMoney(value: string): string {
  const neg = value.startsWith('-')
  const [intPart = '0', frac = '00'] = (neg ? value.slice(1) : value).split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${grouped}.${frac}`
}

/** "1100.00" -> "LKR 1,100.00". Shows the server value as-is; invalid input is shown unchanged. */
export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  if (!MONEY_PATTERN.test(value)) return value
  return `${CURRENCY} ${groupMoney(value)}`
}

/** Compares two canonical money strings without floats. Returns -1, 0 or 1. */
export function compareMoney(a: string, b: string): number {
  const toCents = (v: string): bigint => BigInt(v.replace('.', ''))
  const d = toCents(a) - toCents(b)
  return d === 0n ? 0 : d > 0n ? 1 : -1
}

/** Multiplies a money string by an integer count (denomination counts) without floats. */
export function multiplyMoney(value: string, count: number): string {
  return centsToMoney(BigInt(value.replace('.', '')) * BigInt(Math.trunc(count)))
}

/** Sums money strings without floats. */
export function sumMoney(values: readonly string[]): string {
  return centsToMoney(values.reduce((acc, v) => acc + BigInt(v.replace('.', '')), 0n))
}

function centsToMoney(cents: bigint): string {
  const neg = cents < 0n
  const abs = (neg ? -cents : cents).toString().padStart(3, '0')
  return `${neg ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`
}

/** Sri Lankan notes and coins, largest first (cash counts). */
export const LKR_DENOMINATIONS = [
  '5000.00',
  '2000.00',
  '1000.00',
  '500.00',
  '100.00',
  '50.00',
  '20.00',
  '10.00',
  '5.00',
  '2.00',
  '1.00',
] as const

/** Rate helpers ("10.00" = 10 %). */
export const RATE_PATTERN = /^(100\.00|\d{1,2}\.\d{2})$/

export function parseRateInput(raw: string): string | null | undefined {
  const parsed = parseMoneyInput(raw)
  if (parsed === null || parsed === undefined) return parsed
  return RATE_PATTERN.test(parsed) ? parsed : undefined
}
