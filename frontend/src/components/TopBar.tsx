/**
 * TopBar — shadcn-inspired dashboard header.
 */
import { formatDate, formatMoneyCompact, formatMoneySigned, formatPercentSigned, signClass } from '../lib/format'
import type { DataConfig } from '../lib/api'
import type { Health, SummaryPayload } from '../lib/types'
import { AnimatedNumber } from './AnimatedNumber'
import { Sparkline } from './Sparkline'
import { useCurrency } from '../lib/currency'
import { cn } from '@/lib/utils'

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
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-zinc-500">{label}</span>
      <AnimatedNumber value={absolute} format={formatMoneySigned} delay={delay}
        className={cn('text-sm font-semibold font-mono tabular-nums', tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-red-400' : 'text-zinc-300')} />
      <span className={cn('text-xs font-mono tabular-nums', tone === 'pos' ? 'text-emerald-500' : tone === 'neg' ? 'text-red-500' : 'text-zinc-400')}>
        (<AnimatedNumber value={percent} format={formatPercentSigned} delay={delay} />)
      </span>
    </div>
  )
}

export function TopBar({ summary, health, config }: TopBarProps) {
  const { displayCurrency, multiplier, toggle } = useCurrency()
  const today = summary.changes.day
  const live = config.source === 'api'
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <div className="flex items-center justify-between px-6 py-3">
        {/* Left: identity + total value */}
        <div className="flex items-center gap-8">
          <div>
            <p className="text-xs font-medium tracking-widest text-zinc-500 uppercase">Portfolio</p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <AnimatedNumber
                value={summary.total_value * multiplier}
                format={formatMoneyCompact}
                className="text-3xl font-bold font-mono tabular-nums text-zinc-50"
              />
              <button
                onClick={toggle}
                className="text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer border border-zinc-700 rounded px-1.5 py-0.5"
              >
                {displayCurrency === 'CZK' ? 'CZK → EUR' : 'EUR → CZK'}
              </button>
            </div>
          </div>

          {/* Deltas */}
          <div className="flex items-start gap-6 pl-6 border-l border-zinc-800">
            <Delta label="Dnes" absolute={today.absolute * multiplier} percent={today.pct} delay={90} />
            <Delta
              label="Zhodnocení"
              absolute={summary.total_unrealized_pnl * multiplier}
              percent={summary.total_unrealized_pnl_pct}
              delay={150}
            />
            {summary.benchmark_return_pct !== undefined && (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-zinc-500">vs VUAA.DE</span>
                {(() => {
                  const diff = (summary.total_unrealized_pnl_pct ?? 0) - summary.benchmark_return_pct!
                  return (
                    <span className={cn('text-sm font-semibold font-mono tabular-nums',
                      diff >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {diff >= 0 ? '+' : ''}{(diff * 100).toFixed(2)} %
                    </span>
                  )
                })()}
              </div>
            )}
          </div>
        </div>

        {/* Right: sparkline + meta */}
        <div className="flex items-center gap-5">
          <Sparkline
            values={summary.sparkline.values}
            width={160}
            height={36}
            showEndpoint
            ariaLabel={`Portfolio hodnota za posledních ${summary.sparkline.values.length} obchodních dní`}
          />
          <div className="flex flex-col gap-1 text-right">
            <div className="flex items-center justify-end gap-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-emerald-400' : 'bg-zinc-500')} />
              <span className="text-xs text-zinc-500">{live ? 'Live' : 'Snapshot'}</span>
            </div>
            <span className="text-xs font-mono text-zinc-500">{formatDate(summary.as_of)}</span>
            <span className="text-xs text-zinc-600">{displayCurrency} · {health.benchmark}</span>
          </div>
        </div>
      </div>
    </header>
  )
}
