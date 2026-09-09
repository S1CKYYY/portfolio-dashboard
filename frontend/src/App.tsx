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
  const subPortfolios = (data as any).sub_portfolios ?? {}
  const subData = view !== 'all' ? subPortfolios[view] : null

  const filteredHoldings = view === 'all'
    ? holdings.holdings
    : holdings.holdings.filter((h: any) => h.portfolio_type === view)

  const filteredTotalValue = subData?.total_value_eur
    ?? filteredHoldings.reduce((s: number, h: any) => s + (h.current_value ?? h.value_eur ?? 0), 0)

  const viewHistory = subData?.dates?.length
    ? { ...history, portfolio: subData.portfolio, dates: subData.dates, drawdown_pct: subData.drawdown_pct, cumulative_invested: subData.cumulative_invested }
    : history

  function recomputeAlloc(hs: any[], key: string) {
    const total = hs.reduce((s: number, h: any) => s + (h.current_value ?? 0), 0)
    const groups: Record<string, number> = {}
    for (const h of hs) {
      const k = h[key] ?? 'Ostatní'
      groups[k] = (groups[k] ?? 0) + (h.current_value ?? 0)
    }
    return Object.entries(groups).map(([k, v]) => ({
      key: k, label: k, value_eur: v,
      allocation_pct: total > 0 ? v / total : 0,
    })).sort((a, b) => b.value_eur - a.value_eur)
  }

  const viewSummary = (view === 'all' ? summary : {
    ...summary,
    total_value: subData?.total_value_eur ?? filteredTotalValue,
    total_unrealized_pnl: subData?.total_pnl_abs_eur ?? summary.total_unrealized_pnl,
    total_unrealized_pnl_pct: subData?.total_pnl_pct ?? summary.total_unrealized_pnl_pct,
    holdings_count: filteredHoldings.length,
    allocation_by_class: recomputeAlloc(filteredHoldings, 'asset_class'),
    allocation_by_region: recomputeAlloc(filteredHoldings, 'region'),
    allocation_by_sector: recomputeAlloc(filteredHoldings, 'sector'),
    allocation_by_currency: recomputeAlloc(filteredHoldings, 'currency'),
    benchmark_return_pct: subData?.total_return_pct,
    sparkline: { values: (subData?.portfolio ?? []).slice(-60) },
  }) as typeof summary

  const viewLabel = view === 'passive' ? '🌱 Pasivní ETF' : view === 'picks' ? '🎯 Stock Picks' : null

  const czkRate = summary.czk_rate ?? 25.3

  return (
    <CurrencyProvider czkRate={czkRate}>
    <div className="app">
      <TopBar summary={viewSummary} health={health} config={config} page={page} onNavigate={navigate} />
      {page === 'macro' ? (
        <MacroPage />
      ) : (
      <main className="app__main">
        <KpiStrip risk={risk} montecarlo={montecarlo} summary={viewSummary} currency={currency} />
        <div className="row row--overview">
          <PerformancePanel
            history={viewHistory}
            summary={viewSummary}
            returns={returns}
            currency={currency}
          />
          <AllocationPanel
            byClass={viewSummary.allocation_by_class}
            byRegion={viewSummary.allocation_by_region}
            bySector={viewSummary.allocation_by_sector}
            byCurrency={viewSummary.allocation_by_currency}
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
          {formatTimestamp(viewSummary.generated_at)}
        </span>
      </footer>
    </div>
    </CurrencyProvider>
  )
}
