# API Reference

FastAPI service exposing portfolio analytics as JSON. Default base URL:
`http://localhost:8000`.

```bash
cd backend
uvicorn api:app --reload --port 8000
```

Interactive OpenAPI docs are served at `/docs`.

---

## Conventions

These hold for **every** endpoint.

| Rule | Detail |
|---|---|
| Currency | All monetary values are in the portfolio base currency, set by `base_currency` in `holdings.json` (**EUR** in the bundled example) and echoed on every response. Rounded to **2 dp**. |
| `*_pct` fields | Always a **fraction**, never a percentage. `0.1234` means 12.34%. Rounded to **4 dp**. |
| Ratios | Sharpe, Sortino, beta and correlations are unitless, rounded to **4 dp**. |
| Dates | ISO `YYYY-MM-DD` strings. Timestamps are ISO 8601 UTC. |
| Missing values | Serialised as `null`. The payload never contains `NaN`, `Infinity` or `-Infinity`, so `JSON.parse` always succeeds. |
| Envelope | Every response includes `as_of`, `base_currency` and `generated_at`. |

`as_of` is the date of the most recent market close in the dataset — not
today's date. Markets are shut at weekends and holidays.

### Errors

| Status | Meaning |
|---|---|
| `200` | Success. |
| `404` | Unknown route. |
| `503` | Analytics could not be built (Yahoo Finance unreachable, malformed `holdings.json`). The `detail` field carries the reason. |

### CORS

Enabled for `http://localhost:*` and `http://127.0.0.1:*` (any port), covering
the Vite dev server and preview server. Configure via `cors_origins` in
`backend/config.py`.

---

## `GET /health`

Liveness plus a description of the loaded dataset.

```json
{
  "status": "ok",
  "version": "1.0.0",
  "as_of": "2026-08-14",
  "base_currency": "EUR",
  "generated_at": "2026-08-17T12:16:59+00:00",
  "holdings_count": 12,
  "benchmark": "^GSPC",
  "history_start": "2024-08-08",
  "history_days": 506,
  "prices_fetched_at": "2026-08-17T12:16:59+00:00"
}
```

| Field | Unit | Notes |
|---|---|---|
| `history_days` | count | Trading days in the aligned price history. |
| `prices_fetched_at` | ISO 8601 | When the underlying prices were downloaded (may be served from the disk cache). |

---

## `GET /holdings`

Priced positions — the source for the holdings grid.

```json
{
  "as_of": "2026-08-14",
  "base_currency": "EUR",
  "generated_at": "2026-08-17T12:16:59+00:00",
  "total_value": 79999.97,
  "holdings": [
    {
      "ticker": "IWDA.AS",
      "name": "iShares Core MSCI World",
      "asset_class": "ETF",
      "region": "Global",
      "currency": "EUR",
      "quantity": 108.661909,
      "price_native": 128.84,
      "price_base": 128.84,
      "value_base": 14000.0,
      "allocation_pct": 0.175,
      "cost_basis_native": 110.2,
      "cost_basis_base": 110.2,
      "cost_total_base": 11974.54,
      "unrealized_pnl": 2025.46,
      "unrealized_pnl_pct": 0.1691,
      "day_change_pct": -0.0043,
      "acquired": "2025-11-14",
      "sparkline": [126.11, 126.48, "... 90 values ..."]
    }
  ]
}
```

| Field | Unit | Notes |
|---|---|---|
| `quantity` | units | Fractional allowed; frozen in `holdings.json`. |
| `price_native` | native currency | As quoted by the exchange (see `currency`). |
| `price_base` | base currency | `price_native * rate`, where the rate comes from the `{quote}{base}=X` pair. Minor units (London's `GBp`) are normalised first. |
| `allocation_pct` | fraction | Share of `total_value`. Sums to 1 across holdings. |
| `cost_basis_base` | EUR | Entry price converted at the FX rate **on `acquired`**, so P&L includes the currency move. |
| `unrealized_pnl` | EUR | `quantity * (price_base - cost_basis_base)`. |
| `day_change_pct` | fraction | Change in `price_base` versus the previous trading day. |
| `sparkline` | EUR | Trailing 90 trading days of `price_base`, oldest first. |

---

## `GET /portfolio/summary`

Headline value, P&L, period changes and allocation breakdowns.

```json
{
  "as_of": "2026-08-14",
  "base_currency": "EUR",
  "generated_at": "2026-08-17T12:16:59+00:00",
  "total_value": 79999.97,
  "total_cost": 83599.14,
  "total_unrealized_pnl": -3599.16,
  "total_unrealized_pnl_pct": -0.0431,
  "holdings_count": 12,
  "changes": {
    "day":   { "period": "day",   "start_date": "2026-08-13", "start_value": 80154.92, "end_value": 79999.97, "absolute": -154.94,   "pct": -0.0019 },
    "week":  { "period": "week",  "start_date": "2026-08-07", "start_value": 80922.19, "end_value": 79999.97, "absolute": -922.21,   "pct": -0.0114 },
    "month": { "period": "month", "start_date": "2026-07-14", "start_value": 77910.61, "end_value": 79999.97, "absolute": 2089.36,   "pct": 0.0268 },
    "ytd":   { "period": "ytd",   "start_date": "2025-12-31", "start_value": 79295.15, "end_value": 79999.97, "absolute": 704.83,    "pct": 0.0089 },
    "all":   { "period": "all",   "start_date": "2024-08-08", "start_value": 66149.14, "end_value": 79999.97, "absolute": 13850.83,  "pct": 0.2094 }
  },
  "allocation_by_class": [
    { "key": "Stock", "value": 36000.0, "allocation_pct": 0.45, "holdings": 7 }
  ],
  "allocation_by_region": [
    { "key": "US", "value": 29000.0, "allocation_pct": 0.3625, "holdings": 4 }
  ],
  "sparkline": { "dates": ["2026-04-08", "..."], "values": [77123.44, "..."] }
}
```

Period windows: `day` steps back one trading day; `week` and `month` step back
one calendar week/month and snap to the last trading day at or before that
date; `ytd` uses the final close of the previous year; `all` uses the first
observation. Crypto has no separate weekend calendar here — see
[Calendar alignment](README.md#calendar-alignment).

`holdings` inside an allocation bucket is the number of positions in it.

---

## `GET /portfolio/history`

Time series, returned as **parallel arrays sharing one `dates` array**. This is
materially smaller than repeating a date per point across twelve per-holding
series. Index `i` of every array corresponds to `dates[i]`.

```json
{
  "as_of": "2026-08-14",
  "base_currency": "EUR",
  "generated_at": "2026-08-17T12:16:59+00:00",
  "benchmark": "^GSPC",
  "benchmark_name": "S&P 500",
  "dates": ["2024-08-08", "2024-08-09", "..."],
  "portfolio": [66149.14, 66011.23, "..."],
  "benchmark_rebased": [66149.14, 66458.17, "..."],
  "drawdown_pct": [0.0, -0.0021, "..."],
  "per_holding": {
    "IWDA.AS": [11321.55, "..."],
    "BTC-USD": [12983.21, "..."]
  }
}
```

| Field | Unit | Notes |
|---|---|---|
| `portfolio` | EUR | `sum(quantity_i * price_base_i)` per day. |
| `benchmark_rebased` | EUR | Benchmark scaled to the portfolio's **starting value**, so both fit one axis. It is not a price. |
| `drawdown_pct` | fraction | `value / running_peak - 1`. Always `<= 0`. |
| `per_holding` | EUR | Position value per day, keyed by ticker. Sums to `portfolio`. |

---

## `GET /portfolio/returns`

Daily return series and distribution statistics. `dates` here has one **fewer**
entry than `/portfolio/history` — the first day has no prior close.

```json
{
  "as_of": "2026-08-14",
  "base_currency": "EUR",
  "generated_at": "2026-08-17T12:16:59+00:00",
  "dates": ["2024-08-09", "..."],
  "daily_pct": [-0.0021, "..."],
  "cumulative_pct": [-0.0021, "..."],
  "monthly_pct": [{ "month": "2024-08", "pct": -0.031 }],
  "observations": 505,
  "best_day":  { "date": "2024-11-11", "pct": 0.0425 },
  "worst_day": { "date": "2024-08-26", "pct": -0.0564 },
  "positive_days": 260,
  "negative_days": 245,
  "hit_rate_pct": 0.5149,
  "average_gain_pct": 0.0102,
  "average_loss_pct": -0.0098
}
```

| Field | Unit | Notes |
|---|---|---|
| `daily_pct` | fraction | `v_t / v_{t-1} - 1`. |
| `cumulative_pct` | fraction | `prod(1 + r) - 1` from the start of the history. |
| `hit_rate_pct` | fraction | Share of days with a positive return. |

---

## `GET /portfolio/risk`

```json
{
  "as_of": "2026-08-14",
  "base_currency": "EUR",
  "generated_at": "2026-08-17T12:16:59+00:00",
  "lookback_days": 505,
  "risk_free_rate": 0.02,
  "trading_days_per_year": 252,
  "volatility_annualized_pct": 0.2114,
  "downside_deviation_pct": 0.151,
  "sharpe_ratio": 0.4611,
  "sortino_ratio": 0.6452,
  "max_drawdown": {
    "pct": -0.2541,
    "peak_date": "2025-02-20",
    "trough_date": "2025-04-08",
    "peak_value": 81963.97,
    "trough_value": 61138.05,
    "recovery_date": "2025-08-12"
  },
  "value_at_risk": {
    "95": { "confidence": 0.95, "historical_pct": 0.0188, "parametric_pct": 0.0214, "historical_value": 1506.45, "parametric_value": 1714.8 },
    "99": { "confidence": 0.99, "historical_pct": 0.0416, "parametric_pct": 0.0305, "historical_value": 3330.88, "parametric_value": 2440.69 }
  },
  "beta": { "value": 0.866, "benchmark": "^GSPC", "benchmark_name": "S&P 500" },
  "correlation": {
    "tickers": ["IWDA.AS", "VUSA.AS", "..."],
    "matrix": [[1.0, 0.98, "..."], [0.98, 1.0, "..."]]
  }
}
```

| Field | Formula | Unit |
|---|---|---|
| `volatility_annualized_pct` | `std(r) * sqrt(252)` | fraction |
| `downside_deviation_pct` | `sqrt(mean(min(r - rf, 0)^2)) * sqrt(252)` | fraction |
| `sharpe_ratio` | `(mean(r) - rf_daily) / std(r) * sqrt(252)` | ratio |
| `sortino_ratio` | `(mean(r) - rf_daily) * 252 / downside_deviation` | ratio |
| `max_drawdown.pct` | `min(v_t / cummax(v) - 1)` | fraction, `<= 0` |
| `beta.value` | `cov(r_p, r_b) / var(r_b)` | ratio |

**Value at Risk** is a **positive** fraction representing the 1-day loss
threshold. `historical_pct: 0.0188` at 95% means: on the worst 5% of days the
portfolio lost at least 1.88% of its value. `*_value` is that fraction applied
to today's total, in EUR.

- `historical_*` reads the empirical quantile — no distributional assumption.
- `parametric_*` assumes normally distributed returns: `-(mu + z * sigma)`.

Where historical VaR 99% **exceeds** the parametric figure (as it does here),
real losses have fatter tails than a normal distribution predicts.

`correlation.matrix` is row-major and symmetric; `matrix[i][j]` is the
correlation between `tickers[i]` and `tickers[j]`. The diagonal is `1.0`.

`risk_free_rate` is the **annual** rate (default 2%); it is de-annualised
geometrically to a daily rate for Sharpe and Sortino.

---

## `GET /portfolio/montecarlo`

10,000 simulated paths over 252 trading days. See
[Monte Carlo method](README.md#monte-carlo-method) for the model and its
assumptions.

```json
{
  "as_of": "2026-08-14",
  "base_currency": "EUR",
  "generated_at": "2026-08-17T12:16:59+00:00",
  "paths": 10000,
  "horizon_days": 252,
  "start_value": 79999.97,
  "dates": ["2026-08-14", "2026-08-17", "...", "2027-08-03"],
  "percentile_bands": {
    "p5":  [79999.97, 78511.76, "..."],
    "p25": [79999.97, 79416.19, "..."],
    "p50": [79999.97, 80057.57, "..."],
    "p75": [79999.97, 80702.55, "..."],
    "p95": [79999.97, 81664.62, "..."]
  },
  "final_values": { "p5": 71462.03, "p25": 84378.82, "p50": 95712.5, "p75": 109178.72, "p95": 132908.62 },
  "histogram": [{ "start": 47030.1, "end": 50596.91, "count": 1, "probability": 0.0001 }],
  "expected_value": 97993.28,
  "median_value": 95712.5,
  "probability_below_start_pct": 0.1637,
  "expected_return_pct": 0.2249,
  "annualized_drift_pct": 0.1355,
  "assumptions": {
    "distribution": "multivariate normal on daily log returns",
    "correlation": "historical covariance across all holdings",
    "rebalancing": "none (buy and hold, weights drift)",
    "lookback_days": 505
  }
}
```

| Field | Unit | Notes |
|---|---|---|
| `dates` | ISO date | `horizon_days + 1` entries. `dates[0]` is `as_of` (day 0). |
| `percentile_bands` | EUR | Each array aligns 1:1 with `dates`; all start at `start_value`. |
| `histogram` | EUR / count | Contiguous bins of terminal value; `probability` sums to 1. |
| `expected_value` | EUR | **Mean** terminal value. Exceeds the median because compounded outcomes are right-skewed. |
| `probability_below_start_pct` | fraction | Share of paths ending below today's value. |
| `annualized_drift_pct` | fraction | Value-weighted mean **log** drift, annualised and expressed as a simple return. Not directly comparable to `expected_return_pct`, which also carries the variance term. |

Results are deterministic: the RNG seed is fixed in `config.py` (`mc_seed`), so
the committed snapshot is reproducible.

---

## `POST /refresh`

Rebuilds the analytics from freshly downloaded prices, bypassing the disk
cache. Returns `{"status": "refreshed", "as_of": "2026-08-14"}`.

This triggers a full download and a 10,000-path simulation, so it takes a few
seconds.

---

## Snapshot format

`generate_snapshot.py` writes every endpoint's output to `snapshot.json` at the
repository root, keyed by route:

```json
{
  "generated_at": "2026-08-17T12:16:59+00:00",
  "as_of": "2026-08-14",
  "base_currency": "EUR",
  "endpoints": {
    "/health": { "...": "..." },
    "/holdings": { "...": "..." },
    "/portfolio/summary": { "...": "..." },
    "/portfolio/history": { "...": "..." },
    "/portfolio/returns": { "...": "..." },
    "/portfolio/risk": { "...": "..." },
    "/portfolio/montecarlo": { "...": "..." }
  }
}
```

The frontend reads either this file or the live API — see
[Data sources](README.md#data-sources).
