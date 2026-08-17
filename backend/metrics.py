"""Portfolio risk and performance metrics.

Every public function is pure: it takes pandas/numpy inputs and returns plain
Python or numpy values, with the formula it implements stated in its docstring.
No I/O, no configuration lookups, no rounding — presentation concerns live in
``portfolio.py`` and ``serialize.py``.

Conventions
-----------
* *Returns* are simple (arithmetic) daily returns, ``p_t / p_{t-1} - 1``.
* *Annualisation* uses ``TRADING_DAYS = 252`` unless a caller overrides it.
* *VaR* is returned as a **positive fraction of portfolio value** representing
  the loss threshold, e.g. ``0.0212`` means "a 1-day loss of 2.12% or worse is
  expected on 5% of days" at 95% confidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from statistics import NormalDist
from typing import Literal

import numpy as np
import pandas as pd

TRADING_DAYS: int = 252

PeriodKey = Literal["day", "week", "month", "ytd", "all"]


# --------------------------------------------------------------------------
# Returns
# --------------------------------------------------------------------------


def daily_returns(prices: pd.Series) -> pd.Series:
    """Simple daily returns.

    Formula: ``r_t = p_t / p_{t-1} - 1``

    The first observation has no predecessor and is dropped.
    """
    return prices.astype(float).pct_change().dropna()


def daily_returns_frame(prices: pd.DataFrame) -> pd.DataFrame:
    """Column-wise simple daily returns; rows with any missing value dropped.

    Formula: ``r_{t,i} = p_{t,i} / p_{t-1,i} - 1``
    """
    return prices.astype(float).pct_change().dropna(how="any")


# --------------------------------------------------------------------------
# Dispersion and risk-adjusted return
# --------------------------------------------------------------------------


def annualized_volatility(returns: pd.Series, trading_days: int = TRADING_DAYS) -> float:
    """Annualised standard deviation of daily returns.

    Formula: ``sigma_annual = std(r) * sqrt(trading_days)``

    Uses the sample standard deviation (``ddof=1``).
    """
    if len(returns) < 2:
        return float("nan")
    return float(returns.std(ddof=1) * np.sqrt(trading_days))


def sharpe_ratio(
    returns: pd.Series,
    daily_risk_free_rate: float,
    trading_days: int = TRADING_DAYS,
) -> float:
    """Annualised Sharpe ratio.

    Formula: ``((mean(r) - rf_daily) / std(r)) * sqrt(trading_days)``

    Args:
        returns: Daily simple returns.
        daily_risk_free_rate: Risk-free rate per trading day.
        trading_days: Annualisation factor.

    Returns:
        The annualised Sharpe ratio, or NaN if volatility is zero.
    """
    if len(returns) < 2:
        return float("nan")
    std = float(returns.std(ddof=1))
    if std == 0.0:
        return float("nan")
    excess = float(returns.mean()) - daily_risk_free_rate
    return float(excess / std * np.sqrt(trading_days))


def downside_deviation(
    returns: pd.Series,
    daily_risk_free_rate: float,
    trading_days: int = TRADING_DAYS,
) -> float:
    """Annualised downside deviation (the Sortino denominator).

    Formula: ``sqrt(mean(min(r - rf_daily, 0)^2)) * sqrt(trading_days)``

    Shortfalls are squared against the full sample length (not just the losing
    days), which is the standard definition — averaging over losing days only
    would penalise portfolios that rarely lose.
    """
    if len(returns) < 2:
        return float("nan")
    shortfall = np.minimum(returns.to_numpy(dtype=float) - daily_risk_free_rate, 0.0)
    return float(np.sqrt(np.mean(shortfall**2)) * np.sqrt(trading_days))


def sortino_ratio(
    returns: pd.Series,
    daily_risk_free_rate: float,
    trading_days: int = TRADING_DAYS,
) -> float:
    """Annualised Sortino ratio: excess return per unit of *downside* risk.

    Formula: ``(mean(r) - rf_daily) * trading_days / downside_deviation``

    Returns NaN when there is no downside deviation (no losing days).
    """
    if len(returns) < 2:
        return float("nan")
    dd = downside_deviation(returns, daily_risk_free_rate, trading_days)
    if not np.isfinite(dd) or dd == 0.0:
        return float("nan")
    annual_excess = (float(returns.mean()) - daily_risk_free_rate) * trading_days
    return float(annual_excess / dd)


# --------------------------------------------------------------------------
# Drawdown
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Drawdown:
    """Result of a maximum-drawdown search.

    Attributes:
        max_drawdown: Worst peak-to-trough decline as a negative fraction
            (``-0.243`` == a 24.3% fall).
        peak_date: Date of the running maximum preceding the trough.
        trough_date: Date of the trough.
        peak_value: Portfolio value at the peak.
        trough_value: Portfolio value at the trough.
        recovery_date: First date the portfolio regained the peak, or ``None``
            if it has not yet recovered.
    """

    max_drawdown: float
    peak_date: date | None
    trough_date: date | None
    peak_value: float
    trough_value: float
    recovery_date: date | None


def max_drawdown(equity: pd.Series) -> Drawdown:
    """Largest peak-to-trough decline of an equity curve.

    Formula: ``min_t ( v_t / max_{s<=t} v_s - 1 )``
    """
    values = equity.astype(float)
    if values.empty:
        return Drawdown(float("nan"), None, None, float("nan"), float("nan"), None)

    running_peak = values.cummax()
    drawdown_series = values / running_peak - 1.0

    trough_stamp = drawdown_series.idxmin()
    trough_value = float(values.loc[trough_stamp])
    peak_stamp = values.loc[:trough_stamp].idxmax()
    peak_value = float(values.loc[peak_stamp])

    after_trough = values.loc[trough_stamp:]
    recovered = after_trough[after_trough >= peak_value]
    recovery_stamp = recovered.index[0] if not recovered.empty else None

    return Drawdown(
        max_drawdown=float(drawdown_series.min()),
        peak_date=pd.Timestamp(peak_stamp).date(),
        trough_date=pd.Timestamp(trough_stamp).date(),
        peak_value=peak_value,
        trough_value=trough_value,
        recovery_date=pd.Timestamp(recovery_stamp).date() if recovery_stamp is not None else None,
    )


def drawdown_series(equity: pd.Series) -> pd.Series:
    """Drawdown at every point in time, as a negative fraction.

    Formula: ``d_t = v_t / max_{s<=t} v_s - 1``
    """
    values = equity.astype(float)
    return values / values.cummax() - 1.0


# --------------------------------------------------------------------------
# Value at Risk
# --------------------------------------------------------------------------


def historical_var(returns: pd.Series, confidence: float = 0.95) -> float:
    """1-day historical (non-parametric) Value at Risk.

    Formula: ``VaR = -quantile(r, 1 - confidence)``

    Reads the empirical loss threshold straight off the return distribution,
    making no assumption about its shape.

    Returns:
        A positive fraction of portfolio value. ``0.0` if the quantile is
        positive (i.e. even the tail was a gain over the sample).
    """
    if returns.empty:
        return float("nan")
    quantile = float(np.quantile(returns.to_numpy(dtype=float), 1.0 - confidence))
    return float(max(-quantile, 0.0))


def parametric_var(returns: pd.Series, confidence: float = 0.95) -> float:
    """1-day parametric (variance-covariance) Value at Risk.

    Formula: ``VaR = -(mu + z * sigma)`` where ``z = Phi^-1(1 - confidence)``

    Assumes returns are normally distributed, which understates tail risk for
    assets with fat tails — shown alongside the historical figure so the two
    can be compared.

    Returns:
        A positive fraction of portfolio value.
    """
    if len(returns) < 2:
        return float("nan")
    mu = float(returns.mean())
    sigma = float(returns.std(ddof=1))
    z = NormalDist().inv_cdf(1.0 - confidence)
    return float(max(-(mu + z * sigma), 0.0))


# --------------------------------------------------------------------------
# Benchmark relationship
# --------------------------------------------------------------------------


def beta(portfolio_returns: pd.Series, benchmark_returns: pd.Series) -> float:
    """Sensitivity of the portfolio to the benchmark.

    Formula: ``beta = cov(r_p, r_b) / var(r_b)``

    Both series are inner-joined on date first, so only overlapping trading
    days contribute.
    """
    joined = pd.concat([portfolio_returns, benchmark_returns], axis=1, join="inner").dropna()
    if len(joined) < 2:
        return float("nan")
    port = joined.iloc[:, 0].to_numpy(dtype=float)
    bench = joined.iloc[:, 1].to_numpy(dtype=float)
    variance = float(np.var(bench, ddof=1))
    if variance == 0.0:
        return float("nan")
    covariance = float(np.cov(port, bench, ddof=1)[0, 1])
    return float(covariance / variance)


def correlation_matrix(returns: pd.DataFrame) -> pd.DataFrame:
    """Pearson correlation matrix of daily returns.

    Formula: ``rho_ij = cov(r_i, r_j) / (sigma_i * sigma_j)``
    """
    return returns.corr(method="pearson")


# --------------------------------------------------------------------------
# Period performance
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class PeriodChange:
    """Absolute and relative change of an equity curve over a window.

    Attributes:
        period: Window identifier (``day``/``week``/``month``/``ytd``/``all``).
        start_date: Date of the opening observation used.
        start_value: Opening value.
        end_value: Closing (latest) value.
        absolute: ``end_value - start_value`` in base currency.
        percent: ``end_value / start_value - 1`` as a fraction.
    """

    period: PeriodKey
    start_date: date
    start_value: float
    end_value: float
    absolute: float
    percent: float


def _window_start_stamp(index: pd.DatetimeIndex, period: PeriodKey) -> pd.Timestamp:
    """Resolve the opening observation for a named window.

    ``day`` steps back one trading day; ``week``/``month`` step back one
    calendar week/month and snap to the last trading day at or before that
    date; ``ytd`` uses the final close of the previous year; ``all`` uses the
    first observation available.
    """
    last = index[-1]

    if period == "all":
        return index[0]
    if period == "day":
        return index[-2] if len(index) >= 2 else index[0]

    if period == "week":
        target = last - pd.Timedelta(days=7)
    elif period == "month":
        target = last - pd.DateOffset(months=1)
    elif period == "ytd":
        target = pd.Timestamp(year=last.year, month=1, day=1) - pd.Timedelta(days=1)
    else:  # pragma: no cover - guarded by the Literal type
        raise ValueError(f"unknown period {period!r}")

    earlier = index[index <= target]
    return earlier[-1] if len(earlier) else index[0]


def period_change(equity: pd.Series, period: PeriodKey) -> PeriodChange:
    """Change in an equity curve over a named window.

    Formulas: ``absolute = v_end - v_start``; ``percent = v_end / v_start - 1``
    """
    index = pd.DatetimeIndex(equity.index)
    start_stamp = _window_start_stamp(index, period)
    start_value = float(equity.loc[start_stamp])
    end_value = float(equity.iloc[-1])
    percent = (end_value / start_value - 1.0) if start_value else float("nan")

    return PeriodChange(
        period=period,
        start_date=pd.Timestamp(start_stamp).date(),
        start_value=start_value,
        end_value=end_value,
        absolute=end_value - start_value,
        percent=percent,
    )


# --------------------------------------------------------------------------
# Position-level arithmetic
# --------------------------------------------------------------------------


def position_values(prices_base: pd.DataFrame, quantities: pd.Series) -> pd.DataFrame:
    """Per-holding market value through time, in base currency.

    Formula: ``value_{t,i} = quantity_i * price_{t,i}``
    """
    return prices_base.mul(quantities.reindex(prices_base.columns), axis=1)


def equity_curve(position_value_frame: pd.DataFrame) -> pd.Series:
    """Total portfolio value through time.

    Formula: ``V_t = sum_i quantity_i * price_{t,i}``
    """
    return position_value_frame.sum(axis=1)


def allocation(values: pd.Series) -> pd.Series:
    """Share of total value per entry, as a fraction summing to 1.

    Formula: ``w_i = v_i / sum_j v_j``
    """
    total = float(values.sum())
    if total == 0.0:
        return values * 0.0
    return values / total


def unrealized_pnl(
    quantity: float,
    price_base: float,
    cost_basis_per_unit_base: float,
) -> tuple[float, float]:
    """Unrealised profit and loss for one position, in base currency.

    Formulas:
        ``pnl_abs = quantity * (price - cost_basis)``
        ``pnl_pct = price / cost_basis - 1``

    Args:
        quantity: Units held.
        price_base: Current price converted to base currency.
        cost_basis_per_unit_base: Entry price converted to base currency at the
            FX rate of the acquisition date.

    Returns:
        ``(absolute_pnl, percent_pnl)``; percent is NaN for a zero cost basis.
    """
    absolute = quantity * (price_base - cost_basis_per_unit_base)
    percent = (price_base / cost_basis_per_unit_base - 1.0) if cost_basis_per_unit_base else float("nan")
    return float(absolute), float(percent)
