/**
 * MonthlyReturnsPanel  –  heatmap tabulka mesicnich vynosu
 * Radky = mesice (Jan-Dec), sloupce = roky, posledni sloupec = rocni sucet.
 */
import type { MonthlyReturn } from '../lib/types'

interface MonthlyReturnsPanelProps {
  monthly: MonthlyReturn[]
}

const MONTH_LABELS = ['Led', 'Uno', 'Bre', 'Dub', 'Kve', 'Cvn', 'Cvn', 'Srp', 'Zar', 'Rij', 'Lis', 'Pro']
const MONTH_FULL   = ['Leden','Unor','Brezen','Duben','Kveten','Cerven','Cervenec','Srpen','Zari','Rijen','Listopad','Prosinec']

/** Compound annual return from array of monthly pct (0-based fractions). */
function annualReturn(months: (number | null)[]): number | null {
  const valid = months.filter((v): v is number => v !== null && !Number.isNaN(v))
  if (valid.length === 0) return null
  return valid.reduce((acc, m) => acc * (1 + m), 1) - 1
}

/** Color for a monthly return cell. */
function cellColor(pct: number | null, isCurrentMonth: boolean): string {
  if (pct === null) return 'transparent'
  const maxMag = 0.08  // saturate at ±8 %
  const t = Math.min(Math.abs(pct) / maxMag, 1)
  const alpha = isCurrentMonth ? t * 0.5 : t * 0.75   // current month slightly desaturated
  if (pct >= 0) return `rgba(66, 190, 101, ${alpha.toFixed(3)})`
  return `rgba(250, 77, 86, ${alpha.toFixed(3)})`
}

function fmt(pct: number | null): string {
  if (pct === null) return '—'
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${(pct * 100).toFixed(1)} %`
}

export function MonthlyReturnsPanel({ monthly }: MonthlyReturnsPanelProps) {
  // Build lookup: "2025-03" → pct
  const lookup = new Map<string, number | null>()
  for (const m of monthly) lookup.set(m.month, m.pct ?? null)

  // Collect distinct years
  const years = Array.from(
    new Set(monthly.map(m => m.month.slice(0, 4)))
  ).sort()

  // Current month key e.g. "2026-10"
  const now = new Date()
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // Per-year data (array index 0 = January)
  const yearData: Record<string, (number | null)[]> = {}
  for (const y of years) {
    yearData[y] = Array.from({ length: 12 }, (_, i) => {
      const key = `${y}-${String(i + 1).padStart(2, '0')}`
      return lookup.has(key) ? lookup.get(key)! : null
    })
  }

  // Annual returns
  const annuals: Record<string, number | null> = {}
  for (const y of years) annuals[y] = annualReturn(yearData[y])

  // Best / worst for context
  const allPcts = monthly.map(m => m.pct).filter((v): v is number => v !== null)
  const best  = allPcts.length ? Math.max(...allPcts) : null
  const worst = allPcts.length ? Math.min(...allPcts) : null

  const TH: React.CSSProperties = {
    padding: '5px 10px',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: 400,
    color: 'var(--text-tertiary)',
    letterSpacing: '0.06em',
    textAlign: 'right',
    userSelect: 'none',
  }
  const TD = (extra?: React.CSSProperties): React.CSSProperties => ({
    padding: '4px 10px',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    textAlign: 'right',
    borderRadius: 3,
    transition: 'background 0.15s',
    ...extra,
  })

  return (
    <section className="panel">
      <div className="panel__header">
        <h2 className="panel__title">Mesicni Vykonnost</h2>
        <span className="panel__subtitle">
          Mesicni vynosy portfolia v {monthly[0]?.month.slice(0,4) ?? ''}&nbsp;–&nbsp;{monthly.at(-1)?.month.slice(0,4) ?? ''}
          {best !== null && worst !== null && (
            <>&nbsp;·&nbsp;
              <span style={{ color: 'var(--positive)' }}>nejlepsi {fmt(best)}</span>
              &nbsp;·&nbsp;
              <span style={{ color: 'var(--negative)' }}>nejhorsi {fmt(worst)}</span>
            </>
          )}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: '2px 2px', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: 'left', minWidth: 36 }} />
              {years.map(y => (
                <th key={y} style={TH}>{y}</th>
              ))}
              <th style={{ ...TH, color: 'var(--text-secondary)', borderLeft: '1px solid var(--line)', paddingLeft: 14 }}>
                Rocne
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 12 }, (_, mi) => {
              const monthIdx = mi  // 0-based
              return (
                <tr key={mi}>
                  <td style={{
                    padding: '4px 8px 4px 0',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                    textAlign: 'left',
                  }}
                    title={MONTH_FULL[monthIdx]}
                  >
                    {MONTH_LABELS[monthIdx]}
                  </td>

                  {years.map(y => {
                    const pct = yearData[y][monthIdx]
                    const key = `${y}-${String(monthIdx + 1).padStart(2, '0')}`
                    const isCur = key === curKey
                    const hasData = pct !== null
                    const color = hasData ? (pct >= 0 ? 'var(--positive)' : 'var(--negative)') : 'var(--text-tertiary)'
                    return (
                      <td
                        key={y}
                        title={hasData ? `${MONTH_FULL[monthIdx]} ${y}: ${fmt(pct)}` : undefined}
                        style={{
                          ...TD(),
                          background: cellColor(pct, isCur),
                          color: hasData ? color : 'var(--text-tertiary)',
                          fontWeight: hasData && Math.abs(pct!) > 0.04 ? 600 : 400,
                          outline: isCur ? '1px dashed rgba(255,255,255,0.2)' : undefined,
                          minWidth: 72,
                        }}
                      >
                        {hasData ? fmt(pct) : <span style={{ opacity: 0.25 }}>—</span>}
                      </td>
                    )
                  })}

                  {/* Annual column – only show for rows where at least one year has data for this month */}
                  <td style={{
                    ...TD({ borderLeft: '1px solid var(--line)', paddingLeft: 14 }),
                    color: 'var(--text-tertiary)',
                    fontSize: 11,
                  }}>
                    {/* empty per-row in annual column – annual total is in footer */}
                  </td>
                </tr>
              )
            })}

            {/* Annual totals row */}
            <tr style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{
                padding: '6px 8px 4px 0',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-tertiary)',
                letterSpacing: '0.06em',
              }}>
                YTD
              </td>
              {years.map(y => {
                const ann = annuals[y]
                const color = ann === null ? 'var(--text-tertiary)' : ann >= 0 ? 'var(--positive)' : 'var(--negative)'
                return (
                  <td key={y} style={{
                    ...TD(),
                    color,
                    fontWeight: 700,
                    fontSize: 13,
                    background: ann !== null ? cellColor(ann, false) : undefined,
                  }}>
                    {fmt(ann)}
                  </td>
                )
              })}
              <td style={{ borderLeft: '1px solid var(--line)' }} />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
