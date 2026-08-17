/**
 * Adapters between the backend's parallel-array payloads and the point format
 * Lightweight Charts expects.
 *
 * Kept out of the component module so that file exports components only.
 */

import type { LineData, Time, UTCTimestamp } from 'lightweight-charts'

/** `YYYY-MM-DD` -> the UTC-midnight timestamp Lightweight Charts expects. */
export function toTime(iso: string): UTCTimestamp {
  return (Date.parse(`${iso}T00:00:00Z`) / 1000) as UTCTimestamp
}

/** Convert a chart `Time` back to `YYYY-MM-DD` for readouts. */
export function fromTime(time: Time): string {
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10)
  if (typeof time === 'string') return time
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
}

/**
 * Build `{time, value}` points from the parallel `dates` / values arrays the
 * API returns. Non-finite and null entries are skipped rather than plotted as
 * zero, which would invent a data point that does not exist.
 */
export function toLineData(dates: string[], values: (number | null)[]): LineData<Time>[] {
  const points: LineData<Time>[] = []
  for (let index = 0; index < dates.length; index += 1) {
    const value = values[index]
    if (value === null || value === undefined || !Number.isFinite(value)) continue
    points.push({ time: toTime(dates[index]), value })
  }
  return points
}
