/**
 * CurrencyContext — hodnoty jsou vždy v CZK.
 * multiplier    = EUR → CZK kurz
 * usdMultiplier = USD → CZK kurz
 * Každá pozice zobrazuje P&L ve své native měně;
 * součty (TopBar, footer) jsou vždy v CZK.
 */
import { createContext, useContext, type ReactNode } from 'react'

interface CurrencyCtx {
  displayCurrency: 'CZK'
  multiplier: number      // EUR → CZK
  usdMultiplier: number   // USD → CZK
}

const CurrencyContext = createContext<CurrencyCtx>({
  displayCurrency: 'CZK',
  multiplier: 25.3,
  usdMultiplier: 22.5,
})

export function CurrencyProvider({
  czkRate,
  usdCzkRate,
  children,
}: {
  czkRate: number
  usdCzkRate: number
  children: ReactNode
}) {
  return (
    <CurrencyContext.Provider
      value={{
        displayCurrency: 'CZK',
        multiplier: czkRate,
        usdMultiplier: usdCzkRate,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  return useContext(CurrencyContext)
}
