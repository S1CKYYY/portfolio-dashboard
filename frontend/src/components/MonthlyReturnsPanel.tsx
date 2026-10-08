/**
 * MonthlyReturnsPanel  –  heatmap tabulka mesicnich vynosu
 * Radky = roky, sloupce = mesice (Led–Pro) + YTD
 */
import type { MonthlyReturn } from '../lib/types'

interface MonthlyReturnsPanelProps {
  monthly: MonthlyReturn[]
}

const MONTH_LABELS = ['Led', 'Uno', 'Bre', 'Dub', 'Kve', 'Cvn', 'Cvc', 'Srp', 'Zar', 'Rij', 'Lis', 'Pro']
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
  const maxMag = 0.08
  const t = Math.min(Math.abs(pct) / maxMag, 1)
  const alpha = isCurrentMonth ? t * 0.5 : t * 0.75
  if (pct >= 0) return `rgba(66, 190, 101, ${alpha.toFixed(3)})`
  return `rgba(250, 77, 86, ${alpha.toFixed(3)})`
}

function fmt(pct: number | null): string {
  if (pct === null) return '—'
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${(pct * 100).toFixed(1)}%`
}

export function MonthlyReturnsPanel({ monthly }: MonthlyReturnsPanelProps) {
  const lookup = new Map<string, number | null>()
  for (const m of monthly) lookup.set(m.month, m.pct ?? null)

  // Years in descending order (newest first)
  const years = Array.from(
    new Set(monthly.map(m => m.month.slice(0, 4)))
  ).sort().reverse()

  const now = new Date()
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const yearData: Record<string, (number | null)[]> = {}
  for (const y of years) {
    yearData[y] = Array.from({ length: 12 }, (_, i) => {
      const key = `${y}-${String(i + 1).padStart(2, '0')}`
      return lookup.has(key) ? lookup.get(key)! : null
    })
  }

  const annuals: Record<string, number | null> = {}
  for (const y of years) annuals[y] = annualReturn(yearData[y])

  const allPcts = monthly.map(m => m.pct).filter((v): v is number => v !== null)
  const best  = allPcts.length ? Math.max(...allPcts) : null
  const worst = allPcts.length ? Math.min(...allPcts) : null

  const TH: React.CSSProperties = {
    padding: '5px 8px',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: 400,
    color: 'var(--text-tertiary)',
    letterSpacing: '0.06em',
    textAlign: 'center',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2 className="panel__title">Mesicni Vykonnost</h2>
        <span className="panel__subtitle">
          {years.length > 0 && (
            <>{years.at(-1)}&nbsp;–&nbsp;{years[0]}</>
          )}
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
              {/* Year label column */}
              <th style={{ ...TH, textAlign: 'left', minWidth: 44 }}>Rok</th>
              {MONTH_LABELS.map((lbl, mi) => (
                <th key={mi} style={TH} title={MONTH_FULL[mi]}>
                  {lbl}
                </th>
              ))}
              {/* YTD column */}
              <th style={{
                ...TH,
                color: 'var(--text-secondary)',
                borderLeft: '1px solid var(--line)',
                paddingLeft: 12,
              }}>
                YTD
              </th>
            </tr>
          </thead>
          <tbody>
            {years.map(y => (
              <tr key={y}>
                {/* Year label */}
                <td style={{
                  padding: '4px 8px 4px 0',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-tertiary)',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  letterSpacing: '0.06em',
                }}>
                  {y}
                </td>

                {/* Month cells */}
                {Array.from({ length: 12 }, (_, mi) => {
                  const pct = yearData[y][mi]
                  const key = `${y}-${String(mi + 1).padStart(2, '0')}`
                  const isCur = key === curKey
                  const hasData = pct !== null
                  const color = hasData
                    ? (pct >= 0 ? 'var(--positive)' : 'var(--negative)')
                    : 'var(--text-tertiary)'
                  return (
                    <td
                      key={mi}
                      title={hasData ? `${MONTH_FULL[mi]} ${y}: ${fmt(pct)}` : undefined}
                      style={{
                        padding: '4px 6px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        textAlign: 'center',
                        borderRadius: 3,
                        transition: 'background 0.15s',
                        background: cellColor(pct, isCur),
                        color: hasData ? color : 'var(--text-tertiary)',
                        fontWeight: hasData && Math.abs(pct!) > 0.04 ? 600 : 400,
                        outline: isCur ? '1px dashed rgba(255,255,255,0.2)' : undefined,
                        minWidth: 52,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {hasData ? fmt(pct) : <span style={{ opacity: 0.2 }}>—</span>}
                    </td>
                  )
                })}

                {/* YTD cell */}
                {(() => {
                  const ann = annuals[y]
                  const color = ann === null
                    ? 'var(--text-tertiary)'
                    : ann >= 0 ? 'var(--positive)' : 'var(--negative)'
                  return (
                    <td style={{
                      padding: '4px 10px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      fontWeight: 700,
                      textAlign: 'center',
                      borderLeft: '1px solid var(--line)',
                      color,
                      background: ann !== null ? cellColor(ann, false) : undefined,
                      borderRadius: 3,
                      whiteSpace: 'nowrap',
                      minWidth: 60,
                    }}>
                      {ann !== null ? fmt(ann) : <span style={{ opacity: 0.2 }}>—</span>}
                    </td>
                  )
                })()}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
