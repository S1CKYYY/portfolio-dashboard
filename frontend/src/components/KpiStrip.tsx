/**
 * The headline metrics band, directly beneath the top bar.
 *
 * Eight figures that answer "how risky is this, and what is it likely to do
 * next" without scrolling. Hairline-divided cells over a `--line` background —
 * the same technique as every other grid here, so these read as one continuous
 * instrument panel rather than as eight floating stat cards.
 *
 * Each cell is label / value / one line of context, because a risk number
 * without its convention (annualised? against which rate? over what window?)
 * is not interpretable.
 */

import {
  formatMoneyCompact,
  formatMonthYear,
  formatPercent,
  formatPercentSigned,
  formatRatio,
  signClass,
} from '../lib/format'
import type { MonteCarloPayload, RiskPayload, SummaryPayload } from '../lib/types'

interface KpiStripProps {
  risk: RiskPayload
  montecarlo: MonteCarloPayload
  summary: SummaryPayload
  currency: string
}

interface Kpi {
  label: string
  value: string
  context: string
  tone?: string
}

export function KpiStrip({ risk, montecarlo, summary, currency }: KpiStripProps) {
  const var95 = risk.value_at_risk['95']
  const drawdown = risk.max_drawdown

  const drawdownWindow =
    drawdown.peak_date && drawdown.trough_date
      ? `${formatMonthYear(drawdown.peak_date)} – ${formatMonthYear(drawdown.trough_date)}`
      : 'no decline recorded'

  const kpis: Kpi[] = [
    {
      label: 'Volatility',
      value: formatPercent(risk.volatility_annualized_pct),
      context: `annualised · ${risk.lookback_days}d sample`,
    },
    {
      label: 'Sharpe',
      value: formatRatio(risk.sharpe_ratio),
      tone: signClass(risk.sharpe_ratio),
      context: `excess return vs ${formatPercent(risk.risk_free_rate, 1)} rf`,
    },
    {
      label: 'Sortino',
      value: formatRatio(risk.sortino_ratio),
      tone: signClass(risk.sortino_ratio),
      context: 'downside risk only',
    },
    {
      label: 'Max drawdown',
      value: formatPercent(drawdown.pct),
      tone: signClass(drawdown.pct),
      context: drawdownWindow,
    },
    {
      label: 'VaR 95%',
      value: `${formatMoneyCompact(var95?.historical_value)} ${currency}`,
      tone: 'neg',
      context: `1-day historical · ${formatPercent(var95?.historical_pct)}`,
    },
    {
      label: `Beta vs ${risk.beta.benchmark_name}`,
      value: formatRatio(risk.beta.value),
      context: risk.beta.value !== null && risk.beta.value < 1 ? 'less reactive than index' : 'more reactive than index',
    },
    {
      label: 'P(loss) 1Y',
      value: formatPercent(montecarlo.probability_below_start_pct, 1),
      tone: montecarlo.probability_below_start_pct > 0.5 ? 'neg' : undefined,
      context: `${montecarlo.paths.toLocaleString('en-GB')} simulated paths`,
    },
    {
      label: 'Median 1Y',
      value: `${formatMoneyCompact(montecarlo.median_value)} ${currency}`,
      tone: signClass(montecarlo.median_value - summary.total_value),
      context: `${formatPercentSigned(montecarlo.median_value / summary.total_value - 1)} on today`,
    },
  ]

  return (
    <section className="kpi" aria-label="Headline risk and outlook metrics">
      {kpis.map((kpi) => (
        <div key={kpi.label} className="kpi__cell">
          <span className="kpi__label">{kpi.label}</span>
          <span className={`num kpi__value ${kpi.tone ?? ''}`}>{kpi.value}</span>
          <span className="kpi__context">{kpi.context}</span>
        </div>
      ))}
    </section>
  )
}
