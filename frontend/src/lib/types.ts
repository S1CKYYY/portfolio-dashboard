/**
 * TypeScript mirror of the backend JSON contract (see API.md).
 *
 * Unit conventions, identical on every endpoint:
 *   - Money is in the base currency (EUR), rounded to 2 dp.
 *   - Any field ending in `_pct` is a **fraction**: 0.1234 means 12.34%.
 *   - Ratios (Sharpe, Sortino, beta, correlation) are unitless, 4 dp.
 *   - Dates are ISO `YYYY-MM-DD` strings.
 *
 * Values the backend cannot compute serialise as `null` (never NaN), so
 * nullable fields are typed as such rather than being silently trusted.
 */

/** Fields present on every payload, making each response self-describing. */
export interface Envelope {
  as_of: string
  base_currency: string
  generated_at: string
}

export interface Health extends Envelope {
  status: string
  version: string
  holdings_count: number
  benchmark: string
  history_start: string
  history_days: number
  prices_fetched_at: string
}

export interface Lot {
  date: string
  quantity: number
  price: number
  currency: string
}

export interface Holding {
  ticker: string
  name: string
  asset_class: string
  region: string
  currency: string
  quantity: number
  price_native: number
  price_base: number
  value_base: number
  allocation_pct: number
  cost_basis_native: number
  cost_basis_base: number
  cost_total_base: number
  unrealized_pnl: number
  unrealized_pnl_pct: number | null
  day_change_pct: number | null
  acquired: string
  /** Trailing 90 trading days of price in base currency, for the row sparkline. */
  sparkline: number[]
  lots?: Lot[]
}

export interface HoldingsPayload extends Envelope {
  total_value: number
  holdings: Holding[]
}

/** Named performance windows shared by the summary and the performance readout. */
export type PeriodKey = 'day' | 'week' | 'month' | 'ytd' | 'all'

export interface PeriodChange {
  period: PeriodKey
  start_date: string
  start_value: number
  end_value: number
  absolute: number
  pct: number | null
}

export interface AllocationBucket {
  key: string
  value: number
  allocation_pct: number
  holdings: number
}

export interface SummaryPayload extends Envelope {
  total_value: number
  total_cost: number
  total_unrealized_pnl: number
  total_unrealized_pnl_pct: number | null
  holdings_count: number
  changes: Record<PeriodKey, PeriodChange>
  allocation_by_class: AllocationBucket[]
  allocation_by_region: AllocationBucket[]
  czk_rate?: number
  benchmark_return_pct?: number
  allocation_by_sector?: AllocationBucket[]
  allocation_by_currency?: AllocationBucket[]
  portfolio_ter_pct?: number
  portfolio_annual_fee?: number
  sparkline: {
    dates: string[]
    values: number[]
  }
}

/**
 * History is returned as parallel arrays sharing one `dates` array - materially
 * smaller than repeating a date per point across twelve per-holding series.
 */
export interface HistoryPayload extends Envelope {
  benchmark: string
  benchmark_name: string
  dates: string[]
  portfolio: number[]
  /** Benchmark scaled to the portfolio's starting value, for a like-for-like axis. */
  benchmark_rebased: number[]
  drawdown_pct: number[]
  per_holding: Record<string, number[]>
  /** Kumulativně vloženo v EUR k danému dni — pro výpočet skutečného výnosu. */
  cumulative_invested?: number[]
}

export interface MonthlyReturn {
  month: string
  pct: number | null
}

export interface DayExtreme {
  date: string
  pct: number | null
}

export interface ReturnsPayload extends Envelope {
  dates: string[]
  daily_pct: number[]
  cumulative_pct: number[]
  monthly_pct: MonthlyReturn[]
  observations: number
  best_day: DayExtreme
  worst_day: DayExtreme
  positive_days: number
  negative_days: number
  hit_rate_pct: number | null
  average_gain_pct: number | null
  average_loss_pct: number | null
}

export interface MaxDrawdown {
  pct: number | null
  peak_date: string | null
  trough_date: string | null
  peak_value: number | null
  trough_value: number | null
  recovery_date: string | null
}

export interface ValueAtRisk {
  confidence: number
  historical_pct: number | null
  parametric_pct: number | null
  historical_value: number | null
  parametric_value: number | null
}

export interface RiskPayload extends Envelope {
  lookback_days: number
  risk_free_rate: number
  trading_days_per_year: number
  volatility_annualized_pct: number | null
  downside_deviation_pct: number | null
  sharpe_ratio: number | null
  sortino_ratio: number | null
  max_drawdown: MaxDrawdown
  /** Keyed by confidence level as a whole-number string: "95", "99". */
  value_at_risk: Record<string, ValueAtRisk>
  beta: {
    value: number | null
    benchmark: string
    benchmark_name: string
  }
  correlation: {
    tickers: string[]
    matrix: (number | null)[][]
  }
}

export interface HistogramBin {
  start: number
  end: number
  count: number
  probability: number
}

export interface MonteCarloPayload extends Envelope {
  paths: number
  horizon_days: number
  start_value: number
  /** One entry per simulated day, including day 0 (== `as_of`). */
  dates: string[]
  percentile_bands: Record<'p5' | 'p25' | 'p50' | 'p75' | 'p95', number[]>
  final_values: Record<'p5' | 'p25' | 'p50' | 'p75' | 'p95', number>
  histogram: HistogramBin[]
  expected_value: number
  median_value: number
  probability_below_start_pct: number
  expected_return_pct: number
  annualized_drift_pct: number
  assumptions: {
    distribution: string
    correlation: string
    rebalancing: string
    lookback_days: number
  }
}

/** Every payload the dashboard needs, loaded together. */
export interface Analytics {
  health: Health
  holdings: HoldingsPayload
  summary: SummaryPayload
  history: HistoryPayload
  returns: ReturnsPayload
  risk: RiskPayload
  montecarlo: MonteCarloPayload
}

/** Shape of the committed `snapshot.json`. */
export interface Snapshot {
  generated_at: string
  as_of: string
  base_currency: string
  endpoints: {
    '/health': Health
    '/holdings': HoldingsPayload
    '/portfolio/summary': SummaryPayload
    '/portfolio/history': HistoryPayload
    '/portfolio/returns': ReturnsPayload
    '/portfolio/risk': RiskPayload
    '/portfolio/montecarlo': MonteCarloPayload
  }
}

export type DataSource = 'snapshot' | 'api'
