/**
 * Headline bar: total value, all-time and intraday change, sparkline.
 */
import { formatDate, formatMoneyCompact, formatMoneySigned, formatPercentSigned, signClass } from '../lib/format'
import type { DataConfig } from '../lib/api'
import type { Health, SummaryPayload } from '../lib/types'
import { AnimatedNumber } from './AnimatedNumber'
import { useCurrency } from '../lib/currency'
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
  const { displayCurrency, multiplier, toggle } = useCurrency()
  const today = summary.changes.day
  const live = config.source === 'api'
  return (
    <header className="topbar">
      <div className="topbar__identity">
        <div className="topbar__eyebrow">
          <h1 className="topbar__title">Analytika portfolia</h1>
          <span className="panel__subtitle">
            {summary.holdings_count} pozic · benchmark {health.benchmark}
          </span>
        </div>
        <div className="topbar__value">
          <AnimatedNumber
            value={summary.total_value * multiplier}
            format={formatMoneyCompact}
            className="num topbar__amount"
          />
          <button
            type="button"
            className="segmented__option"
            onClick={toggle}
            style={{ fontFamily: 'inherit', fontSize: '0.75rem', letterSpacing: '0.1em', marginLeft: '6px' }}
            title="Přepnout měnu"
          >
            {displayCurrency === 'CZK' ? 'CZK → EUR' : 'EUR → CZK'}
          </button>
        </div>
        <div className="topbar__deltas">
          <Delta label="Dnes" absolute={today.absolute * multiplier} percent={today.pct} delay={90} />
          <Delta
            label="Zhodnocení"
            absolute={summary.total_unrealized_pnl * multiplier}
            percent={summary.total_unrealized_pnl_pct}
            delay={210}
          />
          {summary.benchmark_return_pct !== undefined && (
            <div className="topbar__delta">
              <span className="topbar__delta-label">vs VUAA.DE</span>
              {(() => {
                const diff = (summary.total_unrealized_pnl_pct ?? 0) - summary.benchmark_return_pct!
                const sign = diff >= 0 ? '+' : ''
                return (
                  <span className={`num ${diff >= 0 ? 'pos' : 'neg'}`}>
                    {sign}{(diff * 100).toFixed(2)} pp
                  </span>
                )
              })()}
            </div>
          )}
        </div>
      </div>
      <div className="topbar__aside">
        <Sparkline
          values={summary.sparkline.values}
          width={220}
          height={44}
          showEndpoint
          ariaLabel={`Hodnota portfolia za posledních ${summary.sparkline.values.length} obchodních dní`}
        />
        <div className="topbar__meta">
          <span>
            Měna <span className="topbar__meta-value num">{displayCurrency}</span>
          </span>
          <span>
            Ke dni <span className="topbar__meta-value num">{formatDate(summary.as_of)}</span>
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
