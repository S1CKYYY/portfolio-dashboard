/**
 * CurrencyContext — přepínač CZK / EUR pro celý dashboard.
 * Všechny komponenty čtou multiplier a displayCurrency odtud.
 */
import { createContext, useContext, useState, type ReactNode } from 'react'

interface CurrencyCtx {
  displayCurrency: 'CZK' | 'EUR'
  multiplier: number
  toggle: () => void
}

const CurrencyContext = createContext<CurrencyCtx>({
  displayCurrency: 'CZK',
  multiplier: 1,
  toggle: () => {},
})

export function CurrencyProvider({
  czkRate,
  children,
}: {
  czkRate: number
  children: ReactNode
}) {
  const [displayCurrency, setDisplayCurrency] = useState<'CZK' | 'EUR'>('CZK')
  const multiplier = displayCurrency === 'CZK' ? czkRate : 1

  return (
    <CurrencyContext.Provider
      value={{
        displayCurrency,
        multiplier,
        toggle: () => setDisplayCurrency((c) => (c === 'CZK' ? 'EUR' : 'CZK')),
      }}
    >
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  return useContext(CurrencyContext)
}
