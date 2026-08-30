/**
 * Equity curve with range and view toggles.
 */
import { useMemo, useState } from 'react'
import { toLineData } from '../charts/series'
import { chartTheme } from '../charts/theme'
import { TimeSeriesChart, type CrosshairState, type SeriesSpec } from '../charts/TimeSeriesChart'
import {
  formatDate,
  formatMoney,
  formatMoneyCompact,
  formatMoneySigned,
  formatPercent,
  formatPercentSigned,
  PERIOD_LABELS,
  signClass,
} from '../lib/format'
import { MOTION } from '../lib/motion'
import type { HistoryPayload, PeriodKey, ReturnsPayload, SummaryPayload } from '../lib/types'
import { Panel, Segmented } from './Panel'

type Range = '1w' | '1m' | 'ytd' | 'all'
type View = 'value' | 'return'

const RANGES = [
  { value: '1w' as const, label: '1T' },
  { value: '1m' as const, label: '1M' },
  { value: 'ytd' as const, label: 'YTD' },
  { value: 'all' as const, label: 'Vše' },
]

const VIEWS = [
  { value: 'value' as const, label: 'Hodnota' },
  { value: 'return' as const, label: 'Výnos' },
]

const READOUT_PERIODS: PeriodKey[] = ['day', 'week', 'month', 'ytd', 'all']

function rangeStartIndex(dates: string[], range: Range): number {
  if (range === 'all' || dates.length === 0) return 0
  const last = dates[dates.length - 1]
  let cutoff: string
  if (range === 'ytd') {
    cutoff = `${last.slice(0, 4)}-01-01`
  } else {
    const date = new Date(`${last}T00:00:00Z`)
    if (range === '1w') date.setUTCDate(date.getUTCDate() - 7)
    else date.setUTCMonth(date.getUTCMonth() - 1)
    cutoff = date.toISOString().slice(0, 10)
  }
  const index = dates.findIndex((day) => day >= cutoff)
  return index === -1 ? 0 : index
}

function rebaseToReturn(values: number[]): number[] {
  const base = values[0]
  if (!base) return values.map(() => 0)
  return values.map((value) => value / base - 1)
}

/** Výnos vzhledem k vloženým penězům: (hodnota - vloženo) / vloženo */
function investedReturn(values: number[], invested: number[]): number[] {
  return values.map((v, i) => {
    const cost = invested[i]
    return cost > 0 ? v / cost - 1 : 0
  })
}

interface PerformancePanelProps {
  history: HistoryPayload
  summary: SummaryPayload
  returns: ReturnsPayload
  currency: string
}

export function PerformancePanel({ history, summary, returns, currency }: PerformancePanelProps) {
  const [range, setRange] = useState<Range>('all')
  const [view, setView] = useState<View>('value')
  const [logScale, setLogScale] = useState(false)
  const [crosshair, setCrosshair] = useState<CrosshairState | null>(null)
  const theme = chartTheme()

  const series = useMemo<SeriesSpec[]>(() => {
    const start = rangeStartIndex(history.dates, range)
    const dates = history.dates.slice(start)
    const portfolio = history.portfolio.slice(start)
    const benchmark = history.benchmark_rebased.slice(start)
    const invested = history.cumulative_invested?.slice(start) ?? null
    if (view === 'return') {
      const portfolioReturn = invested ? investedReturn(portfolio, invested) : rebaseToReturn(portfolio)
      const benchmarkReturn = invested ? investedReturn(benchmark, invested) : rebaseToReturn(benchmark)
      return [
        {
          id: 'portfolio',
          label: 'Portfolio',
          color: theme.accent,
          data: toLineData(dates, portfolioReturn),
        },
        {
          id: 'benchmark',
          label: history.benchmark_name,
          color: theme.benchmark,
          lineWidth: 1,
          dashed: true,
          data: toLineData(dates, benchmarkReturn),
        },
      ]
    }
    return [
      {
        id: 'portfolio',
        label: 'Portfolio',
        color: theme.accent,
        data: toLineData(dates, portfolio),
      },
      {
        id: 'benchmark',
        label: history.benchmark_name,
        color: theme.benchmark,
        lineWidth: 1,
        dashed: true,
        data: toLineData(dates, benchmark),
      },
    ]
  }, [history, range, view, theme])

  const isPercentView = view !== 'value'
  const valueFormatter = useMemo(
    () => (value: number) => (isPercentView ? formatPercent(value, 1) : formatMoneyCompact(value)),
    [isPercentView],
  )

  const latestDate = history.dates[history.dates.length - 1]
  const readoutDate = crosshair?.time ?? latestDate

  return (
    <Panel
      title="Výkonnost"
      subtitle={view === 'value' ? currency : 'procenta'}
      actions={
        <>
          <Segmented options={VIEWS} value={view} onChange={setView} ariaLabel="Pohled na graf" />
          <Segmented options={RANGES} value={range} onChange={setRange} ariaLabel="Časové období" />
          <button
            type="button"
            className="segmented__option"
            aria-pressed={logScale}
            onClick={() => setLogScale((v) => !v)}
            title="Přepnout logaritmické / lineární měřítko"
          >
            LOG
          </button>
        </>
      }
    >
      <div className="performance">
        <div className="performance__legend">
          <span className="performance__date num">{formatDate(readoutDate)}</span>
          {series.map((spec) => {
            const value = crosshair?.values[spec.id]
            const latest = spec.data[spec.data.length - 1]?.value
            const shown = value ?? latest
            return (
              <span key={spec.id} className="performance__legend-item">
                <span
                  className="performance__legend-key"
                  style={{ background: spec.color }}
                  aria-hidden="true"
                />
                <span className="performance__legend-label">{spec.label}</span>
                <span className="num performance__legend-value">
                  {isPercentView ? formatPercentSigned(shown) : formatMoney(shown)}
                </span>
              </span>
            )
          })}
        </div>

        <TimeSeriesChart
          series={series}
          height={280}
          revealOnMount
          revealDelay={MOTION.stagger * 2}
          valueFormatter={valueFormatter}
          onCrosshair={setCrosshair}
          baselineValue={isPercentView ? 0 : undefined}
          logScale={!isPercentView && logScale}
          ariaLabel={`Portfolio ${view === 'value' ? 'hodnota' : 'výnos'} za ${range === 'all' ? 'celou historii' : range}`}
        />

        <div className="performance__readout">
          {READOUT_PERIODS.map((period) => {
            const change = summary.changes[period]
            return (
              <div key={period} className="performance__cell">
                <span className="performance__cell-label">{PERIOD_LABELS[period]}</span>
                <span className={`num performance__cell-value ${signClass(change.pct)}`}>
                  {formatPercentSigned(change.pct)}
                </span>
                <span className={`num performance__cell-sub ${signClass(change.absolute)}`}>
                  {formatMoneySigned(change.absolute)}
                </span>
              </div>
            )
          })}
        </div>

        <div className="performance__stats">
          <span>
            <span className="performance__stat-label">Počet dní</span>
            <span className="num">{returns.observations}</span>
          </span>
          <span>
            <span className="performance__stat-label">Kladné dny</span>
            <span className="num">{formatPercent(returns.hit_rate_pct, 1)}</span>
          </span>
          <span>
            <span className="performance__stat-label">Nejlepší den</span>
            <span className="num pos">{formatPercentSigned(returns.best_day.pct)}</span>
            <span className="num muted">{formatDate(returns.best_day.date)}</span>
          </span>
          <span>
            <span className="performance__stat-label">Nejhorší den</span>
            <span className="num neg">{formatPercentSigned(returns.worst_day.pct)}</span>
            <span className="num muted">{formatDate(returns.worst_day.date)}</span>
          </span>
        </div>
      </div>
    </Panel>
  )
}
