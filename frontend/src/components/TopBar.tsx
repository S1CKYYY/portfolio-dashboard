/**
 * Headline bar: total value, all-time and intraday change, an inline equity
 * sparkline, and the provenance of the data on screen.
 */

import { formatDate, formatMoneyCompact, formatMoneySigned, formatPercentSigned, signClass } from '../lib/format'
import type { DataConfig } from '../lib/api'
import type { Health, SummaryPayload } from '../lib/types'
import { AnimatedNumber } from './AnimatedNumber'
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
  delay: number
}

/** One signed change readout: absolute above percentage, semantic colour. */
function Delta({ label, absolute, percent, delay }: DeltaProps) {
  const tone = signClass(absolute)
  return (
    <div className="topbar__delta">
      <span className="topbar__delta-label">{label}</span>
      <AnimatedNumber
        value={absolute}
        format={formatMoneySigned}
        delay={delay}
        className={`num ${tone}`}
      />
      <span className={`num ${tone}`}>
        (
        <AnimatedNumber value={percent} format={formatPercentSigned} delay={delay} />)
      </span>
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
          <AnimatedNumber
            value={summary.total_value}
            format={formatMoneyCompact}
            className="num topbar__amount"
          />
          <span className="topbar__currency">{summary.base_currency}</span>
        </div>

        {/* Deltas start fractionally after the headline so the eye lands on the
            total first and the row resolves top-down rather than all at once. */}
        <div className="topbar__deltas">
          <Delta label="Today" absolute={today.absolute} percent={today.pct} delay={90} />
          <Delta label="All time" absolute={allTime.absolute} percent={allTime.pct} delay={150} />
          <Delta
            label="Unrealised P&L"
            absolute={summary.total_unrealized_pnl}
            percent={summary.total_unrealized_pnl_pct}
            delay={210}
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
