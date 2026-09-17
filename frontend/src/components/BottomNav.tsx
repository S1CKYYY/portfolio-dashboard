interface BottomNavProps {
  page: 'dashboard' | 'macro'
  onNavigate: (p: 'dashboard' | 'macro') => void
}

export function BottomNav({ page, onNavigate }: BottomNavProps) {
  return (
    <nav className="bottom-nav">
      <button
        className={`bottom-nav__tab ${page === 'dashboard' ? 'bottom-nav__tab--active' : ''}`}
        onClick={() => onNavigate('dashboard')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <rect x="3" y="3" width="8" height="8" rx="1.5"/>
          <rect x="13" y="3" width="8" height="8" rx="1.5"/>
          <rect x="3" y="13" width="8" height="8" rx="1.5"/>
          <rect x="13" y="13" width="8" height="8" rx="1.5"/>
        </svg>
        <span>Portfolio</span>
      </button>
      <button
        className={`bottom-nav__tab ${page === 'macro' ? 'bottom-nav__tab--active' : ''}`}
        onClick={() => onNavigate('macro')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <span>Makro</span>
      </button>
    </nav>
  )
}
