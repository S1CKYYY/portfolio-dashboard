"""Assembly layer: turns market data + metrics into the API payloads.

This is the only module that knows the shape of the JSON contract. ``metrics``
and ``montecarlo`` stay pure and unrounded; everything user-facing is composed,
rounded and made JSON-safe here, so the wire format can be changed without
touching any computation.

Unit conventions (mirrored in ``API.md``):

* Money is in the base currency (EUR), rounded to 2 dp.
* Every field whose name ends in ``_pct`` is a **fraction**: ``0.1234`` means
  12.34%. Ratios (Sharpe, Sortino, beta, correlation) are unitless, 4 dp.
* Dates are ISO ``YYYY-MM-DD`` strings.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from functools import cached_property
from typing import Any

import pandas as pd

import metrics
import montecarlo
from config import SETTINGS, Settings
from data import MarketData, Portfolio, fx_rate_on, to_iso_dates
from serialize import iso, json_safe, money_series, ratio_series, round_money, round_ratio

SPARKLINE_DAYS: int = 90
API_VERSION: str = "1.0.0"

PERIODS: tuple[metrics.PeriodKey, ...] = ("day", "week", "month", "ytd", "all")


@dataclass(frozen=True)
class PositionView:
    """A holding enriched with everything the UI needs about it."""

    ticker: str
    name: str
    asset_class: str
    region: str
    currency: str
    quantity: float
    price_native: float
    price_base: float
    value_base: float
    allocation_pct: float
    cost_basis_native: float
    cost_basis_base: float
    cost_total_base: float
    unrealized_pnl: float
    unrealized_pnl_pct: float
    day_change_pct: float
    acquired: str
    sparkline: list[float]


class PortfolioAnalytics:
    """Computes every published figure from a portfolio and its market data.

    Results that are expensive (the Monte Carlo simulation) or reused across
    endpoints are memoised with ``cached_property``, so constructing one
    instance per process is enough to serve all endpoints cheaply.
    """

    def __init__(
        self,
        portfolio: Portfolio,
        market: MarketData,
        settings: Settings = SETTINGS,
    ) -> None:
        self.portfolio = portfolio
        self.market = market
        self.settings = settings

    # ------------------------------------------------------------------
    # Core frames
    # ------------------------------------------------------------------

    @cached_property
    def quantities(self) -> pd.Series:
        """Units held per ticker, indexed like the price frame's columns."""
        return pd.Series(
            {h.ticker: h.quantity for h in self.portfolio.holdings},
            dtype=float,
        ).reindex(self.market.prices_base.columns)

    @cached_property
    def position_values(self) -> pd.DataFrame:
        """Per-holding market value in EUR, for every trading day."""
        return metrics.position_values(self.market.prices_base, self.quantities)

    @cached_property
    def equity(self) -> pd.Series:
        """Total portfolio value in EUR, for every trading day."""
        return metrics.equity_curve(self.position_values)

    @cached_property
    def portfolio_returns(self) -> pd.Series:
        """Daily simple returns of the portfolio equity curve."""
        return metrics.daily_returns(self.equity)

    @cached_property
    def asset_returns(self) -> pd.DataFrame:
        """Daily simple returns per holding, in EUR terms."""
        return metrics.daily_returns_frame(self.market.prices_base)

    @cached_property
    def benchmark_returns(self) -> pd.Series:
        """Daily simple returns of the benchmark index."""
        return metrics.daily_returns(self.market.benchmark)

    @cached_property
    def total_value(self) -> float:
        """Latest total portfolio value in EUR."""
        return float(self.equity.iloc[-1])

    @cached_property
    def positions(self) -> list[PositionView]:
        """Every holding, priced and enriched as of the latest close."""
        latest_base = self.market.prices_base.iloc[-1]
        previous_base = self.market.prices_base.iloc[-2]
        latest_native = self.market.prices_native.iloc[-1]
        current_values = self.position_values.iloc[-1]
        weights = metrics.allocation(current_values)
        history_tail = self.market.prices_base.tail(SPARKLINE_DAYS)

        views: list[PositionView] = []
        for holding in self.portfolio.holdings:
            ticker = holding.ticker
            price_base = float(latest_base[ticker])

            # Cost basis is converted at the FX rate of the acquisition date, so
            # unrealised P&L includes the currency move since entry.
            if holding.currency == self.settings.base_currency:
                cost_base = holding.cost_basis_per_unit
            else:
                cost_base = holding.cost_basis_per_unit / fx_rate_on(self.market.fx, holding.acquired)

            pnl_abs, pnl_pct = metrics.unrealized_pnl(holding.quantity, price_base, cost_base)
            prev = float(previous_base[ticker])

            views.append(
                PositionView(
                    ticker=ticker,
                    name=holding.name,
                    asset_class=holding.asset_class,
                    region=holding.region_label,
                    currency=holding.currency,
                    quantity=holding.quantity,
                    price_native=float(latest_native[ticker]),
                    price_base=price_base,
                    value_base=float(current_values[ticker]),
                    allocation_pct=float(weights[ticker]),
                    cost_basis_native=holding.cost_basis_per_unit,
                    cost_basis_base=float(cost_base),
                    cost_total_base=float(holding.quantity * cost_base),
                    unrealized_pnl=pnl_abs,
                    unrealized_pnl_pct=pnl_pct,
                    day_change_pct=(price_base / prev - 1.0) if prev else float("nan"),
                    acquired=holding.acquired,
                    sparkline=[float(v) for v in history_tail[ticker]],
                )
            )
        return views

    @cached_property
    def monte_carlo(self) -> montecarlo.MonteCarloResult:
        """Memoised Monte Carlo simulation (the expensive computation)."""
        return montecarlo.simulate(
            self.asset_returns,
            self.position_values.iloc[-1],
            paths=self.settings.mc_paths,
            horizon_days=self.settings.mc_horizon_days,
            seed=self.settings.mc_seed,
            batch_paths=self.settings.mc_batch_paths,
            histogram_bins=self.settings.mc_histogram_bins,
            trading_days_per_year=self.settings.trading_days_per_year,
        )

    # ------------------------------------------------------------------
    # Shared fragments
    # ------------------------------------------------------------------

    @property
    def as_of(self) -> str:
        return self.market.as_of.isoformat()

    def _envelope(self) -> dict[str, Any]:
        """Fields every payload carries, so any response is self-describing."""
        return {
            "as_of": self.as_of,
            "base_currency": self.settings.base_currency,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }

    def _period_payload(self, period: metrics.PeriodKey) -> dict[str, Any]:
        change = metrics.period_change(self.equity, period)
        return {
            "period": change.period,
            "start_date": iso(change.start_date),
            "start_value": round_money(change.start_value),
            "end_value": round_money(change.end_value),
            "absolute": round_money(change.absolute),
            "pct": round_ratio(change.percent),
        }

    def _allocation_breakdown(self, attribute: str) -> list[dict[str, Any]]:
        """Group current position values by a position attribute."""
        values = pd.Series(
            {p.ticker: p.value_base for p in self.positions}, dtype=float
        )
        keys = pd.Series({p.ticker: getattr(p, attribute) for p in self.positions})
        grouped = values.groupby(keys).sum().sort_values(ascending=False)
        weights = metrics.allocation(grouped)
        return [
            {
                "key": str(key),
                "value": round_money(grouped[key]),
                "allocation_pct": round_ratio(weights[key]),
                "holdings": int((keys == key).sum()),
            }
            for key in grouped.index
        ]

    # ------------------------------------------------------------------
    # Endpoint payloads
    # ------------------------------------------------------------------

    def health(self) -> dict[str, Any]:
        """``GET /health`` — liveness plus a description of the loaded data."""
        return json_safe(
            {
                "status": "ok",
                "version": API_VERSION,
                **self._envelope(),
                "holdings_count": len(self.portfolio.holdings),
                "benchmark": self.settings.benchmark,
                "history_start": to_iso_dates(self.market.prices_base.index[:1])[0],
                "history_days": int(len(self.market.prices_base)),
                "prices_fetched_at": self.market.fetched_at.isoformat(timespec="seconds"),
            }
        )

    def holdings(self) -> dict[str, Any]:
        """``GET /holdings`` — the priced position list backing the grid."""
        return json_safe(
            {
                **self._envelope(),
                "total_value": round_money(self.total_value),
                "holdings": [
                    {
                        "ticker": p.ticker,
                        "name": p.name,
                        "asset_class": p.asset_class,
                        "region": p.region,
                        "currency": p.currency,
                        "quantity": round(p.quantity, 6),
                        "price_native": round_money(p.price_native),
                        "price_base": round_money(p.price_base),
                        "value_base": round_money(p.value_base),
                        "allocation_pct": round_ratio(p.allocation_pct),
                        "cost_basis_native": round_money(p.cost_basis_native),
                        "cost_basis_base": round_money(p.cost_basis_base),
                        "cost_total_base": round_money(p.cost_total_base),
                        "unrealized_pnl": round_money(p.unrealized_pnl),
                        "unrealized_pnl_pct": round_ratio(p.unrealized_pnl_pct),
                        "day_change_pct": round_ratio(p.day_change_pct),
                        "acquired": p.acquired,
                        "sparkline": money_series(p.sparkline),
                    }
                    for p in self.positions
                ],
            }
        )

    def summary(self) -> dict[str, Any]:
        """``GET /portfolio/summary`` — headline value, P&L and allocations."""
        total_cost = float(sum(p.cost_total_base for p in self.positions))
        total_pnl = self.total_value - total_cost
        tail = self.equity.tail(SPARKLINE_DAYS)

        return json_safe(
            {
                **self._envelope(),
                "total_value": round_money(self.total_value),
                "total_cost": round_money(total_cost),
                "total_unrealized_pnl": round_money(total_pnl),
                "total_unrealized_pnl_pct": round_ratio(total_pnl / total_cost if total_cost else None),
                "holdings_count": len(self.positions),
                "changes": {period: self._period_payload(period) for period in PERIODS},
                "allocation_by_class": self._allocation_breakdown("asset_class"),
                "allocation_by_region": self._allocation_breakdown("region"),
                "sparkline": {
                    "dates": to_iso_dates(tail.index),
                    "values": money_series(tail.to_numpy()),
                },
            }
        )

    def history(self) -> dict[str, Any]:
        """``GET /portfolio/history`` — equity curve, benchmark and drawdown.

        Series are returned as parallel arrays sharing one ``dates`` array,
        which is materially smaller than repeating a date per point across
        twelve per-holding series.
        """
        dates = to_iso_dates(self.equity.index)

        # Rebase the benchmark onto the portfolio's starting value so both fit
        # one axis: a like-for-like growth comparison, not a level comparison.
        benchmark = self.market.benchmark.reindex(self.equity.index).ffill()
        rebased = benchmark / float(benchmark.iloc[0]) * float(self.equity.iloc[0])

        return json_safe(
            {
                **self._envelope(),
                "benchmark": self.settings.benchmark,
                "benchmark_name": self.settings.benchmark_name,
                "dates": dates,
                "portfolio": money_series(self.equity.to_numpy()),
                "benchmark_rebased": money_series(rebased.to_numpy()),
                "drawdown_pct": ratio_series(metrics.drawdown_series(self.equity).to_numpy()),
                "per_holding": {
                    ticker: money_series(self.position_values[ticker].to_numpy())
                    for ticker in self.position_values.columns
                },
            }
        )

    def returns(self) -> dict[str, Any]:
        """``GET /portfolio/returns`` — daily and cumulative return series."""
        daily = self.portfolio_returns
        cumulative = (1.0 + daily).cumprod() - 1.0
        wins = daily[daily > 0]
        losses = daily[daily < 0]

        best_stamp = daily.idxmax()
        worst_stamp = daily.idxmin()

        monthly = daily.resample("ME").apply(lambda window: float((1.0 + window).prod() - 1.0))

        return json_safe(
            {
                **self._envelope(),
                "dates": to_iso_dates(daily.index),
                "daily_pct": ratio_series(daily.to_numpy()),
                "cumulative_pct": ratio_series(cumulative.to_numpy()),
                "monthly_pct": [
                    {"month": pd.Timestamp(stamp).strftime("%Y-%m"), "pct": round_ratio(value)}
                    for stamp, value in monthly.items()
                ],
                "observations": int(len(daily)),
                "best_day": {
                    "date": iso(pd.Timestamp(best_stamp).date()),
                    "pct": round_ratio(float(daily.loc[best_stamp])),
                },
                "worst_day": {
                    "date": iso(pd.Timestamp(worst_stamp).date()),
                    "pct": round_ratio(float(daily.loc[worst_stamp])),
                },
                "positive_days": int(len(wins)),
                "negative_days": int(len(losses)),
                "hit_rate_pct": round_ratio(len(wins) / len(daily) if len(daily) else None),
                "average_gain_pct": round_ratio(float(wins.mean()) if len(wins) else None),
                "average_loss_pct": round_ratio(float(losses.mean()) if len(losses) else None),
            }
        )

    def risk(self) -> dict[str, Any]:
        """``GET /portfolio/risk`` — volatility, ratios, drawdown, VaR, beta."""
        daily = self.portfolio_returns
        rf_daily = self.settings.daily_risk_free_rate
        trading_days = self.settings.trading_days_per_year
        drawdown = metrics.max_drawdown(self.equity)
        correlation = metrics.correlation_matrix(self.asset_returns)

        value_at_risk: dict[str, Any] = {}
        for confidence in self.settings.var_confidences:
            label = f"{int(confidence * 100)}"
            historical = metrics.historical_var(daily, confidence)
            parametric = metrics.parametric_var(daily, confidence)
            value_at_risk[label] = {
                "confidence": confidence,
                "historical_pct": round_ratio(historical),
                "parametric_pct": round_ratio(parametric),
                "historical_value": round_money(historical * self.total_value),
                "parametric_value": round_money(parametric * self.total_value),
            }

        return json_safe(
            {
                **self._envelope(),
                "lookback_days": int(len(daily)),
                "risk_free_rate": self.settings.risk_free_rate,
                "trading_days_per_year": trading_days,
                "volatility_annualized_pct": round_ratio(
                    metrics.annualized_volatility(daily, trading_days)
                ),
                "downside_deviation_pct": round_ratio(
                    metrics.downside_deviation(daily, rf_daily, trading_days)
                ),
                "sharpe_ratio": round_ratio(metrics.sharpe_ratio(daily, rf_daily, trading_days)),
                "sortino_ratio": round_ratio(metrics.sortino_ratio(daily, rf_daily, trading_days)),
                "max_drawdown": {
                    "pct": round_ratio(drawdown.max_drawdown),
                    "peak_date": iso(drawdown.peak_date),
                    "trough_date": iso(drawdown.trough_date),
                    "peak_value": round_money(drawdown.peak_value),
                    "trough_value": round_money(drawdown.trough_value),
                    "recovery_date": iso(drawdown.recovery_date),
                },
                "value_at_risk": value_at_risk,
                "beta": {
                    "value": round_ratio(metrics.beta(daily, self.benchmark_returns)),
                    "benchmark": self.settings.benchmark,
                    "benchmark_name": self.settings.benchmark_name,
                },
                "correlation": {
                    "tickers": list(correlation.columns),
                    "matrix": [ratio_series(row) for row in correlation.to_numpy()],
                },
            }
        )

    def montecarlo(self) -> dict[str, Any]:
        """``GET /portfolio/montecarlo`` — percentile bands and terminal spread."""
        result = self.monte_carlo

        # Real future trading days on the x-axis, starting at today's close.
        future = pd.bdate_range(
            start=pd.Timestamp(self.market.as_of) + pd.Timedelta(days=1),
            periods=result.horizon_days,
        )
        dates = [self.as_of, *to_iso_dates(future)]

        return json_safe(
            {
                **self._envelope(),
                "paths": result.paths,
                "horizon_days": result.horizon_days,
                "start_value": round_money(result.start_value),
                "dates": dates,
                "percentile_bands": {
                    key: money_series(values) for key, values in result.percentile_bands.items()
                },
                "final_values": {
                    key: round_money(value) for key, value in result.final_values_summary.items()
                },
                "histogram": [
                    {
                        "start": round_money(bucket.start),
                        "end": round_money(bucket.end),
                        "count": bucket.count,
                        "probability": round_ratio(bucket.probability),
                    }
                    for bucket in result.histogram
                ],
                "expected_value": round_money(result.expected_value),
                "median_value": round_money(result.median_value),
                "probability_below_start_pct": round_ratio(result.probability_below_start),
                "expected_return_pct": round_ratio(result.expected_return_pct),
                "annualized_drift_pct": round_ratio(result.annualized_drift_pct),
                "assumptions": {
                    "distribution": "multivariate normal on daily log returns",
                    "correlation": "historical covariance across all holdings",
                    "rebalancing": "none (buy and hold, weights drift)",
                    "lookback_days": int(len(self.asset_returns)),
                },
            }
        )

    def all_payloads(self) -> dict[str, Any]:
        """Every endpoint's output, keyed by route — the snapshot format."""
        return {
            "/health": self.health(),
            "/holdings": self.holdings(),
            "/portfolio/summary": self.summary(),
            "/portfolio/history": self.history(),
            "/portfolio/returns": self.returns(),
            "/portfolio/risk": self.risk(),
            "/portfolio/montecarlo": self.montecarlo(),
        }


def build_analytics(settings: Settings = SETTINGS, *, use_cache: bool = True) -> PortfolioAnalytics:
    """Load holdings and market data, and return a ready analytics instance."""
    from data import load_market_data, load_portfolio  # local import keeps module import cheap

    portfolio = load_portfolio(settings.holdings_path)
    market = load_market_data(portfolio, settings, use_cache=use_cache)
    return PortfolioAnalytics(portfolio, market, settings)


__all__ = ["PortfolioAnalytics", "PositionView", "build_analytics", "API_VERSION"]
