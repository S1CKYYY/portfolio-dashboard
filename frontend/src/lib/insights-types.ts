/**
 * TypeScript types for the Insights page (earnings + insider + look-through).
 */

// ─── Look-Through Exposure ─────────────────────────────────────────────────

export interface EtfHolding {
  ticker: string      // e.g. "NVDA"
  name: string
  weight: number      // 0-1 fraction within the ETF
}

export interface EtfHoldingsMap {
  /** keyed by ETF ticker as it appears in holdings (e.g. "VUAA.DE") */
  [etfTicker: string]: {
    name: string
    coverage_pct: number  // fraction of ETF covered by known holdings (0-1)
    holdings: EtfHolding[]
  }
}

export interface LookThroughRow {
  ticker: string
  name: string
  direct_pct: number      // direct portfolio weight (0-1), 0 if only via ETF
  via_etf_pct: number     // sum of ETF weight * company weight in ETF
  total_pct: number
  also_direct: boolean    // held directly AND via ETF
}

// ─── Earnings Calendar ─────────────────────────────────────────────────────

export interface EarningsHistoryItem {
  period: string          // "2025Q1"
  actual: number | null
  estimate: number | null
  beat: boolean | null    // null if no estimate
}

export interface EarningsEvent {
  ticker: string
  name: string
  date: string            // ISO "2025-10-24"
  time: 'before_market' | 'after_market' | 'unknown'
  eps_estimate: number | null
  revenue_estimate: number | null   // in millions USD
  days_until: number                // negative = past
  history: EarningsHistoryItem[]    // last 4 quarters
  beat_rate: number | null          // 0-1, null if < 2 historical points
}

// ─── Insider Transactions ──────────────────────────────────────────────────

export interface InsiderTransaction {
  ticker: string
  name: string             // insider name
  title: string            // role
  transaction_type: 'P' | 'S'  // P=buy, S=sell
  shares: number
  price: number            // USD per share
  value_usd: number
  date: string             // ISO
  filing_date: string      // ISO
}

export interface InsiderSummary {
  ticker: string
  company_name: string
  buy_count: number
  sell_count: number
  net_value_usd: number    // positive = net buys
  mspr: number | null      // monthly sentiment ratio (-1 to 1), null if unavailable
  transactions: InsiderTransaction[]
}

// ─── Top-level insights.json ───────────────────────────────────────────────

export interface InsightsData {
  generated_at: string   // ISO timestamp
  data_as_of: string     // ISO date
  earnings: EarningsEvent[]
  insider: InsiderSummary[]
  /** seconds since epoch when Finnhub data was fetched; null if never */
  finnhub_fetched_at: string | null
}
