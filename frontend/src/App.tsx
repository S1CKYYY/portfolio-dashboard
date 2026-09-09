/**
 * Dashboard shell: loads the analytics once, then lays the panels out as a
 * dense, hairline-separated grid.
 */
import { useState } from 'react'
import { usePortfolio, PortfolioProvider } from './lib/portfolio-context'
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
import { MacroPage } from './components/MacroPage'
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
  return <PortfolioProvider><AppInner data={data} config={config} /></PortfolioProvider>
}

function AppInner({ data, config }: { data: NonNullable<ReturnType<typeof useAnalytics>['data']>; config: ReturnType<typeof useAnalytics>['config'] }) {
  const [page, setPage] = useState<'dashboard' | 'macro'>(() =>
    window.location.hash === '#/macro' ? 'macro' : 'dashboard'
  )
  const navigate = (p: 'dashboard' | 'macro') => {
    setPage(p)
    window.location.hash = p === 'macro' ? '/macro' : '/dashboard'
  }
  const { health, holdings, summary, history, returns, risk, montecarlo } = data
  const currency = summary.base_currency
  const { view } = usePortfolio()

  // Filtruj holdings podle vybraného view
  const filteredHoldings = view === 'all'
    ? holdings.holdings
    : holdings.holdings.filter((h: any) => h.portfolio_type === view)

  // Sub-portfolio data ze snapshotu (pokud existuje)
  const subData = (data as any).sub_portfolios?.[view]

  // Přepočítej celkovou hodnotu filtered holdings
  const filteredTotalValue = view === 'all'
    ? holdings.total_value
    : filteredHoldings.reduce((sum: number, h: any) => sum + (h.value_eur ?? h.current_value ?? 0), 0)

  // History pro vybraný view
  const viewHistory = view === 'all' ? history : subData
    ? { ...history, portfolio: subData.portfolio, dates: subData.dates, drawdown_pct: subData.drawdown_pct, cumulative_invested: subData.cumulative_invested }
    : history

  // Badge pro current view
  const viewLabel = view === 'all' ? null : view === 'passive' ? '🌱 Pasivní ETF' : '🎯 Stock Picks'

  const czkRate = summary.czk_rate ?? 25.3

  return (
    <CurrencyProvider czkRate={czkRate}>
    <div className="app">
      <TopBar summary={summary} health={health} config={config} page={page} onNavigate={navigate} />
      {page === 'macro' ? (
        <MacroPage />
      ) : (
      <main className="app__main">
        <KpiStrip risk={risk} montecarlo={montecarlo} summary={summary} currency={currency} />
        <div className="row row--overview">
          <PerformancePanel
            history={viewHistory}
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
        <div className="row row--analytics">
          <DrawdownPanel history={viewHistory} risk={risk} />
          <MonteCarloPanel montecarlo={montecarlo} currency={currency} />
          <OutcomeDistributionPanel montecarlo={montecarlo} currency={currency} />
        </div>
        {viewLabel && (
          <div style={{ padding: '4px 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)', letterSpacing: '0.12em' }}>{viewLabel}</span>
            {subData && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: subData.total_return_pct >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                {(subData.total_return_pct * 100 >= 0 ? '+' : '')}{(subData.total_return_pct * 100).toFixed(2)}% celkem
              </span>
            )}
          </div>
        )}
        <HoldingsPanel
          holdings={filteredHoldings}
          totalValue={filteredTotalValue}
          currency={currency}
        />
        <div className="row row--risk">
          <RiskPanel risk={risk} currency={currency} />
          <CorrelationPanel correlation={risk.correlation} />
        </div>
      </main>
      )}
      <footer className="footer">
        <span>
          Moje portfolio · není investiční doporučení · ceny z Yahoo Finance
        </span>
        <span>
          TradingView Lightweight Charts + Apache ECharts · vygenerováno{' '}
          {formatTimestamp(summary.generated_at)}
        </span>
      </footer>
    </div>
    </CurrencyProvider>
  )
}
