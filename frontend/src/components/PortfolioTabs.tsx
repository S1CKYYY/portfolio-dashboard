import { usePortfolio, type PortfolioView } from '../lib/portfolio-context'

export function PortfolioTabs() {
  const { view, setView } = usePortfolio()
  const tabs: { value: PortfolioView; label: string }[] = [
    { value: 'all',     label: 'Celé portfolio' },
    { value: 'passive', label: '🌱 Pasivní ETF' },
    { value: 'picks',   label: '🎯 Stock Picks' },
  ]
  return (
    <div className="portfolio-tabs">
      {tabs.map(t => (
        <button
          key={t.value}
          className={`portfolio-tabs__tab ${view === t.value ? 'portfolio-tabs__tab--active' : ''}`}
          onClick={() => setView(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
