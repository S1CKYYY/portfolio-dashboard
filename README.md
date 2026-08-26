# Portfolio Dashboard

[![CI](https://github.com/chrispathway/portfolio-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/chrispathway/portfolio-dashboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Enter your holdings, get an institutional-grade analytics dashboard for your own
portfolio — allocation, performance against a benchmark, drawdown, Sharpe,
Sortino, Value at Risk, beta, a correlation matrix, and a 10,000-path Monte
Carlo projection of the year ahead. 

Runs entirely on your own machine. A Python backend computes the metrics from
real market data; a React front end presents them as a dense terminal-style
dashboard.

![Dashboard](docs/dashboard.png)

> **Your data stays local.** Your holdings never leave your computer. The only
> outbound requests are to Yahoo Finance for public price history. There is no
> account, no telemetry, and no server other than the one you run.

> **Not investment advice.** This is an analytics tool, not a recommendation
> engine. The portfolio committed to this repo is a worked example, not anyone's
> real net worth.

---

## Quick start

You need **Python 3.11+** and **Node 18+**.

```bash
git clone https://github.com/chrispathway/portfolio-dashboard.git
cd portfolio-dashboard

make setup       # install backend + frontend dependencies
make holdings    # enter your positions (interactive)
make snapshot    # fetch prices and compute everything
make dev         # open http://localhost:5173
```

No `make`? The same four steps, spelled out:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cd frontend && npm install && cd ..

cd backend
python setup_holdings.py        # enter your positions
python generate_snapshot.py     # fetch prices, compute metrics
cd ../frontend && npm run dev
```

Want to look around before entering anything? Skip straight to `make dev` — the
repo ships with a worked example portfolio so the dashboard renders immediately.

---

## Entering your holdings

Three ways in, easiest first.

### 1. Interactive (recommended)

```bash
make holdings          # or: cd backend && python setup_holdings.py
```

Asks for one position at a time and fills in everything it can:

```
Ticker (blank to finish): AAPL
  Apple Inc. · Stock · 305.66 USD
  Quantity: 22
  Purchase date (YYYY-MM-DD) [2026-08-17]: 2026-01-15
  Cost per unit in USD (blank = close on that date):
  Added AAPL: 6,724.42 USD at today's price
```

You only ever type the ticker, the quantity and the date. The instrument's
name, **quote currency** and asset class are read from Yahoo Finance, and
leaving the cost blank looks up the actual closing price on your purchase date.

### 2. From a spreadsheet

Export a CSV with `ticker` and `quantity` columns (see
[`holdings.example.csv`](holdings.example.csv)):

```csv
ticker,quantity,cost_basis,acquired
IWDA.AS,110,110.20,2025-11-14
AAPL,22,,2026-07-15
BTC-USD,0.15,,2025-11-14
```

```bash
make holdings-csv FILE=holdings.example.csv
```

`cost_basis` is in the instrument's own currency; leave it blank to use the
close on `acquired`. Optional extra columns: `name`, `asset_class`, `region`.

### 3. By hand

Edit `backend/holdings.json` directly:

```jsonc
{
  "base_currency": "EUR",             // report everything in this currency
  "holdings": [
    {
      "ticker": "IWDA.AS",            // any Yahoo Finance symbol
      "name": "iShares Core MSCI World",
      "asset_class": "ETF",           // free text; drives the allocation grouping
      "region": "Global",             // null for region-less assets like crypto
      "currency": "EUR",              // the instrument's quote currency
      "quantity": 110,                // fractional units allowed
      "cost_basis_per_unit": 110.20,  // in the instrument's own currency
      "acquired": "2025-11-14"        // sets the FX rate used for the cost basis
    }
  ]
}
```

Then re-run `make snapshot`.

### Finding tickers

Search on [finance.yahoo.com](https://finance.yahoo.com) and use the symbol
exactly as shown. Non-US listings carry a suffix — `.AS` Amsterdam, `.DE`
Frankfurt, `.L` London, `.SW` Zurich, `.TO` Toronto, `.T` Tokyo, `.AX` Sydney.
Crypto is `BTC-USD`, `ETH-USD`. If the setup wizard accepts it, it will work.

### Any currency

Set `base_currency` to whatever you report in — `USD`, `GBP`, `CHF`, `SEK`,
anything Yahoo quotes. Holdings may be quoted in any mix of currencies; each is
converted using its own daily FX series. London listings priced in pence
(`GBp`) are handled correctly.

> **Forking this repo?** `backend/holdings.json` and `snapshot.json` are tracked
> so the demo works out of the box — which means they would be published along
> with your fork. `.gitignore` has commented-out lines to exclude them; uncomment
> those and run `git rm --cached backend/holdings.json snapshot.json` before
> pushing anything real.

---

## What you get

| Panel | Contents |
|---|---|
| **Headline** | Total value, today's and all-time change, unrealised P&L, inline sparkline |
| **KPI band** | Volatility, Sharpe, Sortino, max drawdown, VaR 95%, beta, probability of loss, median 1-year outcome |
| **Performance** | Equity curve against a rebased benchmark, with 1W / 1M / YTD / All ranges and a value/return toggle |
| **Allocation** | By asset class and by region |
| **Drawdown** | Underwater curve with peak, trough and recovery dates |
| **Monte Carlo** | 10,000 correlated paths over 252 trading days, p5–p95 fan and terminal distribution |
| **Holdings** | Sortable grid: quantity, price, value, weight, P&L, day change, 90-day sparkline |
| **Risk** | Full metric readout, each with a plain-English explanation |
| **Correlation** | Heatmap of daily-return correlations between every pair of holdings |

---

## Configuration

Risk conventions live in [`backend/config.py`](backend/config.py):

| Setting | Default | Meaning |
|---|---|---|
| `benchmark` | `^GSPC` | Index used for beta and the comparison line |
| `risk_free_rate` | `0.02` | Annual rate for Sharpe and Sortino |
| `history_years` | `2` | Lookback for every metric |
| `var_confidences` | `(0.95, 0.99)` | VaR levels |
| `mc_paths` | `10_000` | Monte Carlo paths |
| `mc_horizon_days` | `252` | Simulation horizon (~1 year) |
| `mc_seed` | fixed | Makes results reproducible |
| `cache_ttl_hours` | `12` | How long prices are cached before refetching |

Front-end data source is set in `frontend/.env` (see
[`.env.example`](frontend/.env.example)): read the committed `snapshot.json`
(default, no backend needed) or the live API. Append `?source=api` to the URL to
switch per-visit.

Prices are cached in `backend/.cache/` (git-ignored). Force a refresh with
`python generate_snapshot.py --no-cache`.

---

## How the numbers are computed

Every metric comes from your holdings and real price history — nothing is
hard-coded. [`backend/metrics.py`](backend/metrics.py) states the formula for
each one in its docstring, and [`API.md`](API.md) tabulates them with units.

### FX handling

Yahoo names a pair `{FROM}{TO}=X`, quoted as *TO per 1 FROM*, so an instrument
priced in `C` converts to base `B` via the series `{C}{B}=X`.

The full daily FX series is applied across the **whole history**, not just
today, so the equity curve reflects both asset performance and currency
movement — the honest view for an investor reporting in `B`. A US holding can
lose value in EUR terms on a day it rose in USD.

Cost bases convert at the rate on the **acquisition date**, not today's, so
unrealised P&L includes the currency move since you bought.

Venues quoting in a minor unit (London's `GBp` pence) are normalised to the
major unit first; otherwise every UK holding would be overstated 100x.

### Calendar alignment

Crypto trades seven days a week, listed equities do not. Mixing them naively
either inflates the observation count — breaking the `sqrt(252)` annualisation
convention — or injects artificial zero-return days that understate volatility.

The benchmark's trading calendar is therefore the master index: crypto
observations on non-trading days are dropped, and instrument-specific gaps
(one venue closed while another is open) are forward-filled. Every series then
has exactly one observation per trading day. The trade-off is explicit — a
weekend crypto crash shows up on the following Monday.

### Monte Carlo

10,000 paths over 252 trading days, simulated across the **individual
holdings** rather than the portfolio aggregate, which keeps the diversification
effect intact.

1. Convert daily simple returns to log returns, `x = ln(1 + r)`.
2. Estimate the mean vector `mu` and covariance `Sigma`.
3. Draw `x_t ~ N(mu, Sigma)` via a Cholesky factor, reproducing the historical
   correlation structure.
4. Compound each asset and sum.

Log returns make compounding exact and keep prices positive — sampling *simple*
returns from a normal distribution can draw below -100%, implying a negative
price. Paths run in batches so memory stays bounded, and a singular covariance
matrix is repaired by eigenvalue clipping rather than crashing.

**Assumptions:** buy and hold, no rebalancing, contributions, fees or taxes;
normally distributed log returns with constant parameters; and the lookback
window taken as representative of the year ahead. Real markets have fatter tails
and time-varying volatility, so the extreme percentile bands are optimistic.

---

## Design decisions

The brief was an institutional finance tool — a Bloomberg terminal or a FINOS
internal tool — not a template.

**Governing system: [IBM Carbon](https://carbondesignsystem.com/).** Its 2/4/8
spacing scale, type scale and colour-token discipline are adopted directly in
`tokens.css`, which is why the density reads as enterprise software rather than
as arbitrary numbers.

**Typography.** IBM Plex Sans for UI text, **IBM Plex Mono for every number** —
prices, percentages, ratios, dates, axis labels. Self-hosted via `@fontsource`,
so there are no external font requests. Numerals use `tabular-nums`, so digits
occupy identical widths and columns align exactly down the grid.

**Colour.** Flat, solid tokens only: no gradients anywhere, no shadows, no
elevation. A true black page with panels lifted only three or four points of
luminance, separated by 1px hairline rules rather than floating cards. One
accent; semantic green/red reserved for the sign of a number and never used as
decorative fill.

**Layout** is ordered by decreasing generality, so the opening view answers
"what is this worth, how risky is it, where is it heading" before showing any
individual position. The holdings table — densest but least summarising — sits
below the fold. Drawdown gets its own panel rather than a toggle, because depth
and duration of losses is exactly what an equity curve hides.

**Motion** introduces data and never decorates it. On first load the numbers
count into place, the donuts sweep open, and the curves plot themselves left to
right; then the dashboard is still. `prefers-reduced-motion` disables all of it.

### Libraries, and why

| Concern | Library | Why |
|---|---|---|
| Equity, drawdown curves | [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) | The professional standard for financial time series. Thin lines, hairline axes, magnet crosshair. Its default area *gradients* are deliberately unused. |
| Heatmap, Monte Carlo fan, histogram, donuts | [Apache ECharts](https://echarts.apache.org/) | Best-in-class heatmap and stacked-band support. Imported through `echarts/core` with only the pieces used, so tree shaking keeps the bundle small. |
| Holdings grid | [TanStack Table](https://tanstack.com/table) | Headless — sorting and row models with zero styling, which is what a bespoke design system needs. |
| Row sparklines | Hand-rolled inline SVG | At 84×18px a charting runtime would cost more than the twenty lines of path maths it replaces. |

Both chart libraries read their colours from the live CSS custom properties, so
`tokens.css` stays the single source of truth: change a token and every chart
follows.

---

## Project layout

```
├── backend/
│   ├── config.py             # every tunable: benchmark, rf rate, MC size, seed
│   ├── data.py               # yfinance fetch, cache, FX, calendar alignment
│   ├── metrics.py            # pure metric functions, each documenting its formula
│   ├── montecarlo.py         # batched correlated simulation
│   ├── portfolio.py          # assembly layer: the only module that knows the JSON contract
│   ├── serialize.py          # rounding + JSON-safety (no NaN/inf on the wire)
│   ├── api.py                # FastAPI routes, CORS, error boundary
│   ├── setup_holdings.py     # interactive + CSV portfolio builder
│   ├── generate_snapshot.py  # runs everything once, writes ../snapshot.json
│   ├── holdings.json         # your portfolio — edit this
│   └── tests/                # 87 tests, no network access
├── frontend/src/
│   ├── styles/               # tokens.css (the design contract), base, layout, panels
│   ├── lib/                  # API types, data access, formatters, motion
│   ├── charts/               # ECharts + Lightweight Charts wrappers, token bridge
│   └── components/           # one file per panel
├── snapshot.json             # committed, so the frontend runs with no backend
└── API.md                    # every endpoint, with units and example JSON
```

The layering rule: `metrics.py` and `montecarlo.py` are pure and unrounded;
`portfolio.py` composes, rounds and shapes; `api.py` only routes. The wire
format can change without touching a computation.

---

## Testing

```bash
make test        # or: cd backend && python -m pytest
```

87 tests, hermetic — the suite never touches the network, using a synthetic
portfolio and price history instead, so it passes offline and in CI.

- `test_metrics.py` pins each metric against a hand-computable input.
- `test_montecarlo.py` asserts the properties a stochastic simulation must
  satisfy: determinism under a fixed seed, ordered and widening percentile
  bands, a normalised histogram, preserved correlation structure, and recovery
  from a singular covariance matrix.
- `test_currency.py` covers pair direction and the minor-unit (pence) trap.
- `test_api.py` checks the JSON contract: allocations summing to 1, per-holding
  series summing to the equity curve, VaR rising with confidence, strict
  JSON-safety on every route.

---

## Limitations

Worth knowing before reading anything into the output:

- **Yahoo Finance is the single data source.** It is free and occasionally
  wrong: adjusted closes get revised, and thin instruments carry bad prints.
- **Two years of history** is a short window for volatility and correlation
  estimates, and covers one particular regime.
- **Correlations are not stable.** The matrix is a historical average; in a
  sell-off correlations tend toward 1 exactly when diversification is needed.
- **Monte Carlo assumes normal log returns** with constant parameters. Real
  markets have fatter tails, so the p5/p95 bands are wider in reality.
- **No fees, taxes, cash dividends, contributions or rebalancing** are modelled.
  Prices are auto-adjusted, so dividends are reflected in the price series.
- **Beta is measured against the benchmark in its own currency** while the
  portfolio is valued in yours, so the FX move sits inside the portfolio's
  returns but not the benchmark's.

---

## License

[MIT](LICENSE) — use it, fork it, change it.
