/**
 * Dashboard shell: loads the analytics once, then lays the panels out as a
 * dense, hairline-separated grid.
 */
import { AllocationPanel } from './components/AllocationPanel'
import { CorrelationPanel } from './components/CorrelationPanel'
import { DrawdownPanel } from './components/DrawdownPanel'
import { HoldingsPanel } from './components/HoldingsPanel'
import { KpiStrip } from './components/KpiStrip'
import { MonteCarloPanel, OutcomeDistributionPanel } from './components/MonteCarloPanel'
import { PerformancePanel } from './components/PerformancePanel'
import { RiskPanel } from './components/RiskPanel'
import { TopBar } from './components/TopBar'
import { formatTimestamp } from './lib/format'
import { CurrencyProvider } from './lib/currency'
import { useAnalytics } from './lib/useAnalytics'

function LoadingState() {
  return (
    <div className="state">
      <span className="state__title">Načítám analytiku portfolia…</span>
    </div>
  )
}

function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="state">
      <span className="state__title">Nelze načíst data</span>
      <p className="state__detail">{error.message}</p>
      <p className="state__detail">
        Vygeneruj snapshot příkazem <code>python backend/generate_snapshot.py</code>, nebo spusť API
        přes <code>uvicorn api:app --port 8000</code> a přidej <code>?source=api</code>.
      </p>
      <button type="button" className="segmented__option" onClick={onRetry}>
        Zkusit znovu
      </button>
    </div>
  )
}

export default function App() {
  const { data, error, loading, config, reload } = useAnalytics()
  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null
  const { health, holdings, summary, history, returns, risk, montecarlo } = data
  const currency = summary.base_currency
  const czkRate = summary.czk_rate ?? 25.3

  return (
    <CurrencyProvider czkRate={czkRate}>
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <TopBar summary={summary} health={health} config={config} />
      <main className="max-w-[1800px] mx-auto px-6 py-6 flex flex-col gap-4">
        <KpiStrip risk={risk} montecarlo={montecarlo} summary={summary} currency={currency} />
        <div className="grid gap-4" style={{gridTemplateColumns: "1fr var(--sidebar-width)"}}>
          <PerformancePanel
            history={history}
            summary={summary}
            returns={returns}
            currency={currency}
          />
          <AllocationPanel
            byClass={summary.allocation_by_class}
            byRegion={summary.allocation_by_region}
            bySector={summary.allocation_by_sector}
            byCurrency={summary.allocation_by_currency}
            currency={currency}
          />
        </div>
        <div className="grid gap-4" style={{gridTemplateColumns: "minmax(0,1fr) minmax(0,1.25fr) 300px"}}>
          <DrawdownPanel history={history} risk={risk} />
          <MonteCarloPanel montecarlo={montecarlo} currency={currency} />
          <OutcomeDistributionPanel montecarlo={montecarlo} currency={currency} />
        </div>
        <HoldingsPanel
          holdings={holdings.holdings}
          totalValue={holdings.total_value}
          currency={currency}
        />
        <div className="grid gap-4" style={{gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)"}}>
          <RiskPanel risk={risk} currency={currency} />
          <CorrelationPanel correlation={risk.correlation} />
        </div>
      </main>
      <footer className="border-t border-zinc-800 px-6 py-3 flex items-center justify-between">
        <span className="text-xs text-zinc-500">Moje portfolio · není investiční doporučení · ceny z Yahoo Finance</span>
        <span className="text-xs text-zinc-600">TradingView + ECharts · vygenerováno {formatTimestamp(summary.generated_at)}</span>
      </footer>
    </div>
    </CurrencyProvider>
  )
}
