/**
 * Dashboard shell: loads the analytics once, then lays the panels out as a
 * dense, hairline-separated grid.
 */

import { AllocationPanel } from './components/AllocationPanel'
import { CorrelationPanel } from './components/CorrelationPanel'
import { HoldingsPanel } from './components/HoldingsPanel'
import { MonteCarloPanel } from './components/MonteCarloPanel'
import { PerformancePanel } from './components/PerformancePanel'
import { RiskPanel } from './components/RiskPanel'
import { TopBar } from './components/TopBar'
import { formatTimestamp } from './lib/format'
import { useAnalytics } from './lib/useAnalytics'

function LoadingState() {
  return (
    <div className="state">
      <span className="state__title">Loading portfolio analytics</span>
    </div>
  )
}

function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="state">
      <span className="state__title">Unable to load analytics</span>
      <p className="state__detail">{error.message}</p>
      <p className="state__detail">
        Generate the snapshot with <code>python backend/generate_snapshot.py</code>, or start the API
        with <code>uvicorn api:app --port 8000</code> and append <code>?source=api</code>.
      </p>
      <button type="button" className="segmented__option" onClick={onRetry}>
        Retry
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

  return (
    <div className="app">
      <TopBar summary={summary} health={health} config={config} />

      <main className="app__main">
        <div className="row row--holdings">
          <AllocationPanel
            byClass={summary.allocation_by_class}
            byRegion={summary.allocation_by_region}
            currency={currency}
          />
          <HoldingsPanel
            holdings={holdings.holdings}
            totalValue={holdings.total_value}
            currency={currency}
          />
        </div>

        <PerformancePanel
          history={history}
          summary={summary}
          returns={returns}
          currency={currency}
        />

        <div className="row row--risk">
          <RiskPanel risk={risk} currency={currency} />
          <CorrelationPanel correlation={risk.correlation} />
        </div>

        <div className="row row--montecarlo">
          <MonteCarloPanel montecarlo={montecarlo} currency={currency} />
        </div>
      </main>

      <footer className="footer">
        <span>
          Example portfolio · not investment advice · prices from Yahoo Finance via yfinance
        </span>
        <span>
          Charts by TradingView Lightweight Charts and Apache ECharts · generated{' '}
          {formatTimestamp(summary.generated_at)}
        </span>
      </footer>
    </div>
  )
}
