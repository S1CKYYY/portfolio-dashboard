type PageId = 'dashboard' | 'macro' | 'analysis' | 'transactions'

interface BottomNavProps {
  page: PageId
  onNavigate: (p: PageId) => void
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
      <button
        className={`bottom-nav__tab ${page === 'analysis' ? 'bottom-nav__tab--active' : ''}`}
        onClick={() => onNavigate('analysis')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="11" y1="8" x2="11" y2="14"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
        <span>Analyza</span>
      </button>
      <button
        className={`bottom-nav__tab ${page === 'transactions' ? 'bottom-nav__tab--active' : ''}`}
        onClick={() => onNavigate('transactions')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
          <rect x="9" y="3" width="6" height="4" rx="1"/>
          <line x1="9" y1="12" x2="15" y2="12"/>
          <line x1="9" y1="16" x2="13" y2="16"/>
        </svg>
        <span>Transakce</span>
      </button>
    </nav>
  )
}
