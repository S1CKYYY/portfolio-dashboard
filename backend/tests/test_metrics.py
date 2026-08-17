"""Closed-form tests for the metric functions.

Each test pins a metric against a hand-computable input, so a refactor that
silently changes a formula fails here rather than in the dashboard.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

import metrics


def series(values: list[float], start: str = "2025-01-01") -> pd.Series:
    return pd.Series(values, index=pd.bdate_range(start, periods=len(values)), dtype=float)


# --------------------------------------------------------------------------
# Returns
# --------------------------------------------------------------------------


def test_daily_returns_drops_first_and_computes_simple_returns() -> None:
    result = metrics.daily_returns(series([100.0, 110.0, 99.0]))
    assert len(result) == 2
    assert result.iloc[0] == pytest.approx(0.10)
    assert result.iloc[1] == pytest.approx(-0.10)


def test_daily_returns_frame_computes_each_column_independently() -> None:
    frame = pd.DataFrame(
        {"A": [1.0, 2.0, 4.0], "B": [10.0, 20.0, 25.0]},
        index=pd.bdate_range("2025-01-01", periods=3),
    )
    result = metrics.daily_returns_frame(frame)
    assert list(result.columns) == ["A", "B"]
    assert list(result["A"]) == pytest.approx([1.0, 1.0])
    assert list(result["B"]) == pytest.approx([1.0, 0.25])


def test_daily_returns_frame_drops_rows_touched_by_a_gap() -> None:
    """A missing price is never imputed: the gap row and the row after it go.

    ``data.py`` forward-fills before this is ever called, so in production the
    frame has no gaps; this pins the fail-safe behaviour if one appears.
    """
    frame = pd.DataFrame(
        {"A": [1.0, 2.0, 4.0], "B": [10.0, np.nan, 20.0]},
        index=pd.bdate_range("2025-01-01", periods=3),
    )
    result = metrics.daily_returns_frame(frame)
    assert result.empty
    assert not result.isna().to_numpy().any()


# --------------------------------------------------------------------------
# Volatility, Sharpe, Sortino
# --------------------------------------------------------------------------


def test_annualized_volatility_matches_manual_calculation() -> None:
    returns = series([0.01, -0.02, 0.015, 0.0, -0.005])
    expected = returns.std(ddof=1) * math.sqrt(252)
    assert metrics.annualized_volatility(returns) == pytest.approx(expected)


def test_annualized_volatility_is_nan_for_a_single_observation() -> None:
    assert math.isnan(metrics.annualized_volatility(series([0.01])))


def test_sharpe_ratio_with_zero_risk_free_rate() -> None:
    returns = series([0.01, -0.005, 0.02, 0.0, 0.004])
    expected = returns.mean() / returns.std(ddof=1) * math.sqrt(252)
    assert metrics.sharpe_ratio(returns, 0.0) == pytest.approx(expected)


def test_sharpe_ratio_falls_with_a_higher_risk_free_rate() -> None:
    returns = series([0.01, -0.005, 0.02, 0.0, 0.004])
    assert metrics.sharpe_ratio(returns, 0.001) < metrics.sharpe_ratio(returns, 0.0)


def test_sharpe_ratio_is_nan_without_volatility() -> None:
    assert math.isnan(metrics.sharpe_ratio(series([0.01] * 5), 0.0))


def test_downside_deviation_ignores_upside() -> None:
    returns = series([0.05, -0.02, 0.05, 0.05])
    # Only the -0.02 day contributes: sqrt(0.02^2 / 4) * sqrt(252)
    expected = math.sqrt((0.02**2) / 4) * math.sqrt(252)
    assert metrics.downside_deviation(returns, 0.0) == pytest.approx(expected)


def test_sortino_exceeds_sharpe_when_downside_is_rare() -> None:
    returns = series([0.03, 0.03, -0.01, 0.03, 0.03, -0.005])
    assert metrics.sortino_ratio(returns, 0.0) > metrics.sharpe_ratio(returns, 0.0)


def test_sortino_is_nan_without_any_downside() -> None:
    assert math.isnan(metrics.sortino_ratio(series([0.01, 0.02, 0.03]), 0.0))


# --------------------------------------------------------------------------
# Drawdown
# --------------------------------------------------------------------------


def test_max_drawdown_finds_peak_trough_and_recovery() -> None:
    equity = series([100.0, 120.0, 90.0, 105.0, 125.0])
    result = metrics.max_drawdown(equity)

    assert result.max_drawdown == pytest.approx(-0.25)  # 120 -> 90
    assert result.peak_value == pytest.approx(120.0)
    assert result.trough_value == pytest.approx(90.0)
    assert result.peak_date.isoformat() == "2025-01-02"
    assert result.trough_date.isoformat() == "2025-01-03"
    assert result.recovery_date.isoformat() == "2025-01-07"


def test_max_drawdown_reports_no_recovery_when_still_underwater() -> None:
    result = metrics.max_drawdown(series([100.0, 120.0, 90.0, 95.0]))
    assert result.recovery_date is None


def test_max_drawdown_is_zero_for_a_monotonic_curve() -> None:
    result = metrics.max_drawdown(series([100.0, 101.0, 102.0]))
    assert result.max_drawdown == pytest.approx(0.0)


def test_drawdown_series_tracks_the_running_peak() -> None:
    result = metrics.drawdown_series(series([100.0, 120.0, 90.0, 120.0]))
    assert list(result) == pytest.approx([0.0, 0.0, -0.25, 0.0])


# --------------------------------------------------------------------------
# Value at Risk
# --------------------------------------------------------------------------


def test_historical_var_reads_the_empirical_quantile() -> None:
    returns = series([-0.10, -0.05, 0.0, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08])
    expected = -float(np.quantile(returns.to_numpy(), 0.05))
    assert metrics.historical_var(returns, 0.95) == pytest.approx(expected)


def test_historical_var_is_never_negative() -> None:
    assert metrics.historical_var(series([0.01, 0.02, 0.03]), 0.95) == 0.0


def test_parametric_var_matches_the_normal_quantile() -> None:
    returns = series([0.01, -0.02, 0.015, -0.005, 0.004, -0.011])
    mu, sigma = returns.mean(), returns.std(ddof=1)
    expected = -(mu + (-1.6448536269514729) * sigma)  # z at the 5% tail
    assert metrics.parametric_var(returns, 0.95) == pytest.approx(expected, rel=1e-6)


def test_var_increases_with_confidence() -> None:
    returns = series(list(np.linspace(-0.08, 0.08, 60)))
    assert metrics.parametric_var(returns, 0.99) > metrics.parametric_var(returns, 0.95)


# --------------------------------------------------------------------------
# Benchmark relationship
# --------------------------------------------------------------------------


def test_beta_of_a_doubled_benchmark_is_two() -> None:
    benchmark = series([0.01, -0.02, 0.03, -0.01, 0.005])
    assert metrics.beta(benchmark * 2.0, benchmark) == pytest.approx(2.0)


def test_beta_of_an_uncorrelated_constant_is_zero() -> None:
    benchmark = series([0.01, -0.02, 0.03, -0.01, 0.005])
    flat = series([0.001] * 5)
    assert metrics.beta(flat, benchmark) == pytest.approx(0.0)


def test_beta_aligns_on_overlapping_dates_only() -> None:
    benchmark = series([0.01, -0.02, 0.03, -0.01, 0.005])
    portfolio = (benchmark * 2.0).iloc[1:]
    assert metrics.beta(portfolio, benchmark) == pytest.approx(2.0)


def test_correlation_matrix_is_unit_diagonal_and_symmetric() -> None:
    frame = pd.DataFrame(
        {"A": [0.01, -0.02, 0.03, 0.005], "B": [0.02, -0.01, 0.025, -0.004]},
        index=pd.bdate_range("2025-01-01", periods=4),
    )
    corr = metrics.correlation_matrix(frame)
    assert corr.loc["A", "A"] == pytest.approx(1.0)
    assert corr.loc["A", "B"] == pytest.approx(corr.loc["B", "A"])
    assert -1.0 <= corr.loc["A", "B"] <= 1.0


# --------------------------------------------------------------------------
# Period changes
# --------------------------------------------------------------------------


def test_period_change_day_uses_the_previous_trading_day() -> None:
    equity = series([100.0, 110.0, 121.0])
    change = metrics.period_change(equity, "day")
    assert change.start_value == pytest.approx(110.0)
    assert change.absolute == pytest.approx(11.0)
    assert change.percent == pytest.approx(0.10)


def test_period_change_all_uses_the_first_observation() -> None:
    change = metrics.period_change(series([100.0, 110.0, 121.0]), "all")
    assert change.start_value == pytest.approx(100.0)
    assert change.percent == pytest.approx(0.21)


def test_period_change_ytd_uses_last_close_of_previous_year() -> None:
    index = pd.DatetimeIndex(["2024-12-30", "2024-12-31", "2025-01-02", "2025-01-03"])
    equity = pd.Series([90.0, 100.0, 105.0, 110.0], index=index)
    change = metrics.period_change(equity, "ytd")
    assert change.start_date.isoformat() == "2024-12-31"
    assert change.percent == pytest.approx(0.10)


def test_period_change_falls_back_to_the_first_point_for_short_history() -> None:
    equity = series([100.0, 105.0])
    change = metrics.period_change(equity, "month")
    assert change.start_value == pytest.approx(100.0)


# --------------------------------------------------------------------------
# Position arithmetic
# --------------------------------------------------------------------------


def test_position_values_multiply_prices_by_quantities() -> None:
    prices = pd.DataFrame(
        {"A": [10.0, 11.0], "B": [100.0, 90.0]}, index=pd.bdate_range("2025-01-01", periods=2)
    )
    values = metrics.position_values(prices, pd.Series({"A": 3.0, "B": 0.5}))
    assert list(values["A"]) == pytest.approx([30.0, 33.0])
    assert list(metrics.equity_curve(values)) == pytest.approx([80.0, 78.0])


def test_allocation_sums_to_one() -> None:
    weights = metrics.allocation(pd.Series({"A": 25.0, "B": 75.0}))
    assert weights.sum() == pytest.approx(1.0)
    assert weights["B"] == pytest.approx(0.75)


def test_allocation_of_an_empty_portfolio_is_all_zero() -> None:
    assert metrics.allocation(pd.Series({"A": 0.0, "B": 0.0})).sum() == pytest.approx(0.0)


def test_unrealized_pnl_absolute_and_percent() -> None:
    absolute, percent = metrics.unrealized_pnl(10.0, 120.0, 100.0)
    assert absolute == pytest.approx(200.0)
    assert percent == pytest.approx(0.20)


def test_unrealized_pnl_is_negative_for_a_loser() -> None:
    absolute, percent = metrics.unrealized_pnl(4.0, 75.0, 100.0)
    assert absolute == pytest.approx(-100.0)
    assert percent == pytest.approx(-0.25)
