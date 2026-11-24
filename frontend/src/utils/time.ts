/** All times are stored in UTC and shown in Asia/Colombo (CLAUDE.md project rules). */
export const TIME_ZONE = 'Asia/Colombo'

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'short',
  day: '2-digit',
})

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const isoDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** "2026-11-21T08:30:00Z" -> "21 Nov 2026, 14:00:00" (Colombo). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateTimeFmt.format(d)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d)
}

export function formatClock(d: Date = new Date()): string {
  return timeFmt.format(d)
}

/** Calendar date (YYYY-MM-DD) in Colombo for an instant. */
export function colomboDate(d: Date = new Date()): string {
  return isoDateFmt.format(d)
}

/** Shifts a YYYY-MM-DD date by whole days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}
