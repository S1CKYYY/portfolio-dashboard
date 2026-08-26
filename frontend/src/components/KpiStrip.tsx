/**
 * The headline metrics band, directly beneath the top bar.
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
import { AnimatedNumber } from './AnimatedNumber'

interface KpiStripProps {
  risk: RiskPayload
  montecarlo: MonteCarloPayload
  summary: SummaryPayload
  currency: string
}

interface Kpi {
  label: string
  raw: number | null
  format: (value: number | null | undefined) => string
  context: string
  tone?: string
}

export function KpiStrip({ risk, montecarlo, summary, currency }: KpiStripProps) {
  const var95 = risk.value_at_risk['95']
  const drawdown = risk.max_drawdown
  const drawdownWindow =
    drawdown.peak_date && drawdown.trough_date
      ? `${formatMonthYear(drawdown.peak_date)} – ${formatMonthYear(drawdown.trough_date)}`
      : 'žádný pokles nezaznamenán'

  const withCurrency = (value: number | null | undefined) =>
    `${formatMoneyCompact(value)} ${currency}`

  const kpis: Kpi[] = [
    {
      label: 'Volatility',
      raw: risk.volatility_annualized_pct,
      format: (value) => formatPercent(value),
      context: `anualizovaná · vzorek ${risk.lookback_days}d`,
    },
    {
      label: 'Sharpe',
      raw: risk.sharpe_ratio,
      format: formatRatio,
      tone: signClass(risk.sharpe_ratio),
      context: `přebytkový výnos vs ${formatPercent(risk.risk_free_rate, 1)} rf`,
    },
    {
      label: 'Sortino',
      raw: risk.sortino_ratio,
      format: formatRatio,
      tone: signClass(risk.sortino_ratio),
      context: 'pouze riziko poklesu',
    },
    {
      label: 'Max drawdown',
      raw: drawdown.pct,
      format: (value) => formatPercent(value),
      tone: signClass(drawdown.pct),
      context: drawdownWindow,
    },
    {
      label: 'VaR 95%',
      raw: var95?.historical_value ?? null,
      format: withCurrency,
      tone: 'neg',
      context: `1-denní historická · ${formatPercent(var95?.historical_pct)}`,
    },
    {
      label: `Beta vs ${risk.beta.benchmark_name}`,
      raw: risk.beta.value,
      format: formatRatio,
      context:
        risk.beta.value !== null && risk.beta.value < 1
          ? 'méně reaktivní než index'
          : 'více reaktivní než index',
    },
    {
      label: 'P(loss) 1Y',
      raw: montecarlo.probability_below_start_pct,
      format: (value) => formatPercent(value, 1),
      tone: montecarlo.probability_below_start_pct > 0.5 ? 'neg' : undefined,
      context: `${montecarlo.paths.toLocaleString('cs-CZ')} simulovaných scénářů`,
    },
    {
      label: 'Median 1Y',
      raw: montecarlo.median_value,
      format: withCurrency,
      tone: signClass(montecarlo.median_value - summary.total_value),
      context: `${formatPercentSigned(montecarlo.median_value / summary.total_value - 1)} oproti dnešku`,
    },
  ]

  return (
    <section className="kpi" aria-label="Klíčové metriky rizika a výhledu">
      {kpis.map((kpi, index) => (
        <div key={kpi.label} className="kpi__cell">
          <span className="kpi__label">{kpi.label}</span>
          <AnimatedNumber
            value={kpi.raw}
            format={kpi.format}
            delay={120 + index * 45}
            className={`num kpi__value ${kpi.tone ?? ''}`}
          />
          <span className="kpi__context">{kpi.context}</span>
        </div>
      ))}
    </section>
  )
}
