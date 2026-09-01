export interface HistoryData {
  dates: string[]
  values: number[]
}

export interface NewsItem {
  ticker: string
  title: string
  publisher: string
  url: string
  ts: number
}

export interface MarketCard {
  value: number
  change_pct: number | null
  change_abs: number | null
  sparkline: number[]
  history?: HistoryData
  state?: string   // VIX state
  inverted?: boolean  // yield curve
}

export interface FredCard {
  value: number
  prev: number | null
  change: number | null
  date: string
  sparkline: number[]
  history?: HistoryData
}

export interface MacroData {
  generated_at: string
  market: {
    vix?: MarketCard
    sp500?: MarketCard
    nasdaq?: MarketCard
    dxy?: MarketCard
    eur_usd?: MarketCard
    usd_czk?: MarketCard
    eur_czk?: MarketCard
    brent?: MarketCard
    wti?: MarketCard
    gold?: MarketCard
    us10y?: MarketCard
    us2y?: MarketCard
    us30y?: MarketCard
    yield_spread?: MarketCard
  }
  fred: {
    cpi_yoy?: FredCard
    core_cpi_yoy?: FredCard
    pce_yoy?: FredCard
    wages_yoy?: FredCard
    unemployment?: FredCard
    fed_funds?: FredCard
    gdp?: FredCard
  }
  cpi_wages_history: {
    dates: string[]
    cpi_yoy: number[]
    wages_yoy: number[]
  }
  news: NewsItem[]
  rate_expectations: {
    available: boolean
    current_rate?: number
    implied_rate?: number
    cut_probability?: number
    hold_probability?: number
    hike_probability?: number
  }
}
