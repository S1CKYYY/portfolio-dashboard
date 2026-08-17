"""FastAPI application exposing the portfolio analytics.

Run with::

    uvicorn api:app --reload --port 8000

The analytics object (which owns the price history and the memoised Monte Carlo
run) is built once on first use and reused across requests. ``POST /refresh``
rebuilds it, bypassing the on-disk price cache.
"""

from __future__ import annotations

import logging
from threading import Lock
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from config import SETTINGS
from portfolio import API_VERSION, PortfolioAnalytics, build_analytics

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Portfolio Analytics API",
    version=API_VERSION,
    summary="Risk, performance and Monte Carlo analytics for a multi-asset portfolio.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(SETTINGS.cors_origins),
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_analytics: PortfolioAnalytics | None = None
_lock = Lock()


def get_analytics(*, use_cache: bool = True) -> PortfolioAnalytics:
    """Return the process-wide analytics instance, building it on first call.

    The lock prevents two concurrent first requests from each triggering a full
    download and Monte Carlo run.
    """
    global _analytics
    with _lock:
        if _analytics is None:
            logger.info("Building portfolio analytics ...")
            _analytics = build_analytics(SETTINGS, use_cache=use_cache)
            logger.info("Analytics ready as of %s", _analytics.as_of)
        return _analytics


def _serve(payload_name: str) -> dict[str, Any]:
    """Call one analytics payload method, mapping failures to HTTP 503.

    Upstream data problems (Yahoo Finance unreachable, malformed holdings) are
    operational, not client errors, so they surface as 503 with the reason.
    """
    try:
        analytics = get_analytics()
        return getattr(analytics, payload_name)()
    except Exception as exc:  # noqa: BLE001 - boundary handler
        logger.exception("Failed to build %s", payload_name)
        raise HTTPException(status_code=503, detail=f"analytics unavailable: {exc}") from exc


@app.get("/health", tags=["meta"])
def health() -> dict[str, Any]:
    """Liveness check plus a description of the loaded dataset."""
    return _serve("health")


@app.get("/holdings", tags=["portfolio"])
def holdings() -> dict[str, Any]:
    """Priced positions: quantity, price, value, allocation and P&L."""
    return _serve("holdings")


@app.get("/portfolio/summary", tags=["portfolio"])
def summary() -> dict[str, Any]:
    """Headline value, unrealised P&L, period changes and allocations."""
    return _serve("summary")


@app.get("/portfolio/history", tags=["portfolio"])
def history() -> dict[str, Any]:
    """Equity curve, rebased benchmark, drawdown and per-holding series."""
    return _serve("history")


@app.get("/portfolio/returns", tags=["portfolio"])
def returns() -> dict[str, Any]:
    """Daily, cumulative and monthly returns with distribution statistics."""
    return _serve("returns")


@app.get("/portfolio/risk", tags=["portfolio"])
def risk() -> dict[str, Any]:
    """Volatility, Sharpe, Sortino, drawdown, VaR, beta and correlations."""
    return _serve("risk")


@app.get("/portfolio/montecarlo", tags=["portfolio"])
def montecarlo() -> dict[str, Any]:
    """Simulated one-year outcome distribution with percentile bands."""
    return _serve("montecarlo")


@app.post("/refresh", tags=["meta"])
def refresh() -> dict[str, Any]:
    """Rebuild the analytics from freshly downloaded prices."""
    global _analytics
    with _lock:
        _analytics = None
    analytics = get_analytics(use_cache=False)
    return {"status": "refreshed", "as_of": analytics.as_of}
