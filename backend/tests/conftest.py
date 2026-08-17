"""Shared fixtures.

The suite is hermetic: it never touches the network. A synthetic portfolio and
price history stand in for Yahoo Finance so the assembly layer and the API
routes can be exercised deterministically.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from data import Holding, MarketData, Portfolio  # noqa: E402
from portfolio import PortfolioAnalytics  # noqa: E402


@pytest.fixture(scope="session")
def synthetic_portfolio() -> Portfolio:
    """Three holdings: one EUR ETF, one USD stock, one USD crypto."""
    return Portfolio(
        base_currency="EUR",
        holdings=(
            Holding("AAA.AS", "Alpha ETF", "ETF", "Europe", "EUR", 100.0, 90.0, "2025-01-02"),
            Holding("BBB", "Beta Corp", "Stock", "US", "USD", 50.0, 120.0, "2025-01-02"),
            Holding("CCC-USD", "Gamma Coin", "Crypto", None, "USD", 2.0, 20000.0, "2025-01-02"),
        ),
    )


@pytest.fixture(scope="session")
def synthetic_market(synthetic_portfolio: Portfolio) -> MarketData:
    """300 trading days of correlated geometric random walks with a fixed seed."""
    rng = np.random.default_rng(7)
    index = pd.bdate_range("2025-01-02", periods=300, name="date")
    tickers = list(synthetic_portfolio.tickers)

    starts = {"AAA.AS": 100.0, "BBB": 130.0, "CCC-USD": 25000.0}
    vols = {"AAA.AS": 0.010, "BBB": 0.018, "CCC-USD": 0.040}

    native = pd.DataFrame(
        {
            ticker: starts[ticker]
            * np.exp(np.cumsum(rng.normal(0.0004, vols[ticker], len(index))))
            for ticker in tickers
        },
        index=index,
    )
    fx = pd.Series(
        1.08 * np.exp(np.cumsum(rng.normal(0.0, 0.003, len(index)))), index=index, name="EURUSD=X"
    )
    benchmark = pd.Series(
        5000.0 * np.exp(np.cumsum(rng.normal(0.0005, 0.009, len(index)))), index=index, name="^GSPC"
    )

    base = native.copy()
    base["BBB"] = native["BBB"] / fx
    base["CCC-USD"] = native["CCC-USD"] / fx

    return MarketData(
        prices_native=native,
        prices_base=base,
        fx=fx,
        benchmark=benchmark,
        fetched_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


@pytest.fixture(scope="session")
def analytics(synthetic_portfolio: Portfolio, synthetic_market: MarketData) -> PortfolioAnalytics:
    """Analytics over the synthetic dataset."""
    return PortfolioAnalytics(synthetic_portfolio, synthetic_market)
