/**
 * KPI Strip — shadcn-inspired stat cards.
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
import { useCurrency } from '../lib/currency'
import { cn } from '@/lib/utils'

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

function KpiCard({ kpi, delay }: { kpi: Kpi; delay: number }) {
  const toneClass = kpi.tone === 'pos' ? 'text-emerald-400'
    : kpi.tone === 'neg' ? 'text-red-400'
    : 'text-zinc-100'

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-1 min-w-0">
      <span className="text-xs font-medium text-zinc-500 truncate">{kpi.label}</span>
      <AnimatedNumber
        value={kpi.raw}
        format={kpi.format}
        delay={delay}
        className={cn('text-xl font-bold font-mono tabular-nums', toneClass)}
      />
      <span className="text-xs text-zinc-600 truncate">{kpi.context}</span>
    </div>
  )
}

export function KpiStrip({ risk, montecarlo, summary }: KpiStripProps) {
  const { displayCurrency, multiplier } = useCurrency()
  const drawdown = risk.max_drawdown
  const drawdownWindow =
    drawdown.peak_date && drawdown.trough_date
      ? `${formatMonthYear(drawdown.peak_date)} – ${formatMonthYear(drawdown.trough_date)}`
      : 'žádný pokles'
  const withCurrency = (value: number | null | undefined) =>
    `${formatMoneyCompact((value ?? 0) * multiplier)} ${displayCurrency}`

  const kpis: Kpi[] = [
    {
      label: 'Volatility',
      raw: risk.volatility_annualized_pct,
      format: (v) => formatPercent(v),
      context: `anualizovaná · ${risk.lookback_days}d`,
    },
    {
      label: 'Sharpe',
      raw: risk.sharpe_ratio,
      format: formatRatio,
      tone: signClass(risk.sharpe_ratio),
      context: `vs ${formatPercent(risk.risk_free_rate, 1)} rf`,
    },
    {
      label: 'Sortino',
      raw: risk.sortino_ratio,
      format: formatRatio,
      tone: signClass(risk.sortino_ratio),
      context: 'riziko poklesu',
    },
    {
      label: 'Max drawdown',
      raw: drawdown.pct,
      format: (v) => formatPercent(v),
      tone: signClass(drawdown.pct),
      context: drawdownWindow,
    },
    {
      label: `Beta vs ${risk.beta.benchmark_name}`,
      raw: risk.beta.value,
      format: formatRatio,
      context: risk.beta.value !== null && risk.beta.value < 1 ? 'méně reaktivní' : 'více reaktivní',
    },
    {
      label: 'P(loss) 1Y',
      raw: montecarlo.probability_below_start_pct,
      format: (v) => formatPercent(v, 1),
      tone: montecarlo.probability_below_start_pct > 0.5 ? 'neg' : undefined,
      context: `${montecarlo.paths.toLocaleString('cs-CZ')} scénářů`,
    },
    {
      label: 'Median 1Y',
      raw: montecarlo.median_value,
      format: withCurrency,
      tone: signClass(montecarlo.median_value - summary.total_value),
      context: `${formatPercentSigned(montecarlo.median_value / summary.total_value - 1)} dnes`,
    },
    {
      label: 'TER',
      raw: summary.portfolio_ter_pct ?? null,
      format: (v) => v !== null && v !== undefined ? `${v.toFixed(2)} %` : '—',
      context: summary.portfolio_annual_fee
        ? `${withCurrency(summary.portfolio_annual_fee)} / rok`
        : 'roční poplatek',
    },
  ]

  return (
    <section
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(8, minmax(0, 1fr))' }}
      aria-label="Klíčové metriky"
    >
      {kpis.map((kpi, i) => (
        <KpiCard key={kpi.label} kpi={kpi} delay={120 + i * 45} />
      ))}
    </section>
  )
}
