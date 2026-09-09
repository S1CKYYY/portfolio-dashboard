import { createContext, useContext, useState } from 'react'

export type PortfolioView = 'all' | 'passive' | 'picks'

interface PortfolioContextType {
  view: PortfolioView
  setView: (v: PortfolioView) => void
}

const PortfolioContext = createContext<PortfolioContextType>({
  view: 'all',
  setView: () => {},
})

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<PortfolioView>('all')
  return (
    <PortfolioContext.Provider value={{ view, setView }}>
      {children}
    </PortfolioContext.Provider>
  )
}

export const usePortfolio = () => useContext(PortfolioContext)
