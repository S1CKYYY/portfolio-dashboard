import { usePortfolio } from '../lib/portfolio-context'

interface BottomNavProps {
  page: 'dashboard' | 'macro'
  onNavigate: (p: 'dashboard' | 'macro') => void
}

export function BottomNav({ page, onNavigate }: BottomNavProps) {
  const { view, setView } = usePortfolio()

  return (
    <nav className="bottom-nav">
      <button
        className={`bottom-nav__tab ${page === 'dashboard' ? 'bottom-nav__tab--active' : ''}`}
        onClick={() => onNavigate('dashboard')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
        <span>Portfolio</span>
      </button>

      <button
        className={`bottom-nav__tab ${page === 'macro' ? 'bottom-nav__tab--active' : ''}`}
        onClick={() => onNavigate('macro')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 12h18M3 6h18M3 18h12"/><polyline points="17 14 21 18 17 22"/>
        </svg>
        <span>Makro</span>
      </button>

      {page === 'dashboard' && (
        <>
          {(['all', 'passive', 'picks'] as const).map(v => (
            <button
              key={v}
              className={`bottom-nav__tab ${view === v ? 'bottom-nav__tab--active' : ''}`}
              onClick={() => setView(v)}
            >
              <span className="bottom-nav__icon">
                {v === 'all' ? '◎' : v === 'passive' ? '🌱' : '🎯'}
              </span>
              <span>{v === 'all' ? 'Vše' : v === 'passive' ? 'ETF' : 'Picks'}</span>
            </button>
          ))}
        </>
      )}
    </nav>
  )
}
