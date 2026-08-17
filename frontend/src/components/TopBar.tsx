/**
 * Headline bar: total value, all-time and intraday change, an inline equity
 * sparkline, and the provenance of the data on screen.
 */

import { formatDate, formatMoneyCompact, formatMoneySigned, formatPercentSigned, signClass } from '../lib/format'
import type { DataConfig } from '../lib/api'
import type { Health, SummaryPayload } from '../lib/types'
import { Sparkline } from './Sparkline'

interface TopBarProps {
  summary: SummaryPayload
  health: Health
  config: DataConfig
}

interface DeltaProps {
  label: string
  absolute: number | null
  percent: number | null
}

/** One signed change readout: absolute above percentage, semantic colour. */
function Delta({ label, absolute, percent }: DeltaProps) {
  const tone = signClass(absolute)
  return (
    <div className="topbar__delta">
      <span className="topbar__delta-label">{label}</span>
      <span className={`num ${tone}`}>{formatMoneySigned(absolute)}</span>
      <span className={`num ${tone}`}>({formatPercentSigned(percent)})</span>
    </div>
  )
}

export function TopBar({ summary, health, config }: TopBarProps) {
  const allTime = summary.changes.all
  const today = summary.changes.day
  const live = config.source === 'api'

  return (
    <header className="topbar">
      <div className="topbar__identity">
        <div className="topbar__eyebrow">
          <h1 className="topbar__title">Portfolio Analytics</h1>
          <span className="panel__subtitle">
            {summary.holdings_count} holdings · {health.benchmark} benchmark
          </span>
        </div>

        <div className="topbar__value">
          <span className="num topbar__amount">{formatMoneyCompact(summary.total_value)}</span>
          <span className="topbar__currency">{summary.base_currency}</span>
        </div>

        <div className="topbar__deltas">
          <Delta label="Today" absolute={today.absolute} percent={today.pct} />
          <Delta label="All time" absolute={allTime.absolute} percent={allTime.pct} />
          <Delta
            label="Unrealised P&L"
            absolute={summary.total_unrealized_pnl}
            percent={summary.total_unrealized_pnl_pct}
          />
        </div>
      </div>

      <div className="topbar__aside">
        <Sparkline
          values={summary.sparkline.values}
          width={220}
          height={44}
          showEndpoint
          ariaLabel={`Portfolio value over the last ${summary.sparkline.values.length} trading days`}
        />
        <div className="topbar__meta">
          <span>
            Base <span className="topbar__meta-value num">{summary.base_currency}</span>
          </span>
          <span>
            As of <span className="topbar__meta-value num">{formatDate(summary.as_of)}</span>
          </span>
          <span className="topbar__source">
            <span className={live ? 'topbar__source-dot' : 'topbar__source-dot topbar__source-dot--snapshot'} />
            {live ? 'Live API' : 'Snapshot'}
          </span>
        </div>
      </div>
    </header>
  )
}
