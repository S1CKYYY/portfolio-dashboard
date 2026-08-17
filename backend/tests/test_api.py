"""Contract tests for the payload assembly and the HTTP routes.

These run against the synthetic dataset from ``conftest.py``, so they assert
the shape and internal consistency of the JSON contract without any network
access. If a field the frontend reads is renamed or dropped, one of these fails.
"""

from __future__ import annotations

import json
import math
from typing import Any

import pytest
from fastapi.testclient import TestClient

import api
from portfolio import PortfolioAnalytics


@pytest.fixture()
def client(analytics: PortfolioAnalytics) -> TestClient:
    """A TestClient wired to the synthetic analytics instead of live data."""
    api._analytics = analytics
    return TestClient(api.app)


ROUTES = [
    "/health",
    "/holdings",
    "/portfolio/summary",
    "/portfolio/history",
    "/portfolio/returns",
    "/portfolio/risk",
    "/portfolio/montecarlo",
]


def assert_json_safe(payload: Any) -> None:
    """Every payload must survive a strict round-trip (no NaN/Infinity)."""
    json.loads(json.dumps(payload, allow_nan=False))


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------


@pytest.mark.parametrize("route", ROUTES)
def test_route_returns_a_json_safe_envelope(
    client: TestClient, analytics: PortfolioAnalytics, route: str
) -> None:
    response = client.get(route)
    assert response.status_code == 200

    payload = response.json()
    assert_json_safe(payload)
    assert payload["as_of"] == analytics.as_of
    assert payload["base_currency"] == "EUR"
    assert "generated_at" in payload


def test_cors_headers_are_present_for_a_browser_origin(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_unknown_route_is_404(client: TestClient) -> None:
    assert client.get("/portfolio/nope").status_code == 404


def test_route_failure_surfaces_as_503(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def explode() -> dict[str, Any]:
        raise RuntimeError("yahoo unreachable")

    monkeypatch.setattr(api._analytics, "summary", explode)
    response = client.get("/portfolio/summary")
    assert response.status_code == 503
    assert "yahoo unreachable" in response.json()["detail"]


# --------------------------------------------------------------------------
# Payload contracts
# --------------------------------------------------------------------------


def test_health_describes_the_loaded_dataset(analytics: PortfolioAnalytics) -> None:
    payload = analytics.health()
    assert payload["status"] == "ok"
    assert payload["holdings_count"] == 3
    assert payload["history_days"] == 300


def test_holdings_allocations_sum_to_one(analytics: PortfolioAnalytics) -> None:
    payload = analytics.holdings()
    holdings = payload["holdings"]
    assert len(holdings) == 3
    assert sum(h["allocation_pct"] for h in holdings) == pytest.approx(1.0, abs=1e-3)
    assert sum(h["value_base"] for h in holdings) == pytest.approx(payload["total_value"], abs=0.05)


def test_holdings_expose_every_field_the_grid_renders(analytics: PortfolioAnalytics) -> None:
    required = {
        "ticker", "name", "asset_class", "region", "currency", "quantity",
        "price_native", "price_base", "value_base", "allocation_pct",
        "cost_basis_native", "cost_basis_base", "cost_total_base",
        "unrealized_pnl", "unrealized_pnl_pct", "day_change_pct", "acquired", "sparkline",
    }
    for holding in analytics.holdings()["holdings"]:
        assert required <= set(holding)
        assert len(holding["sparkline"]) > 0


def test_usd_holdings_are_converted_into_the_base_currency(analytics: PortfolioAnalytics) -> None:
    """A USD position's EUR price must equal price_native * (EUR per USD)."""
    holdings = {h["ticker"]: h for h in analytics.holdings()["holdings"]}
    rate = float(analytics.market.rate_series("USD").iloc[-1])

    usd_position = holdings["BBB"]
    assert usd_position["price_base"] == pytest.approx(usd_position["price_native"] * rate, rel=1e-4)

    eur_position = holdings["AAA.AS"]
    assert eur_position["price_base"] == pytest.approx(eur_position["price_native"], rel=1e-9)


def test_summary_pnl_reconciles_with_value_minus_cost(analytics: PortfolioAnalytics) -> None:
    payload = analytics.summary()
    assert payload["total_unrealized_pnl"] == pytest.approx(
        payload["total_value"] - payload["total_cost"], abs=0.05
    )


def test_summary_allocations_partition_the_portfolio(analytics: PortfolioAnalytics) -> None:
    payload = analytics.summary()
    for key in ("allocation_by_class", "allocation_by_region"):
        breakdown = payload[key]
        assert sum(row["allocation_pct"] for row in breakdown) == pytest.approx(1.0, abs=1e-3)
        assert sum(row["value"] for row in breakdown) == pytest.approx(payload["total_value"], abs=0.05)
        assert sum(row["holdings"] for row in breakdown) == 3


def test_summary_period_changes_share_the_same_end_value(analytics: PortfolioAnalytics) -> None:
    payload = analytics.summary()
    total = payload["total_value"]
    for period, change in payload["changes"].items():
        assert change["period"] == period
        assert change["end_value"] == pytest.approx(total, abs=0.05)
        assert change["absolute"] == pytest.approx(change["end_value"] - change["start_value"], abs=0.05)


def test_history_series_are_parallel_arrays_of_equal_length(analytics: PortfolioAnalytics) -> None:
    payload = analytics.history()
    length = len(payload["dates"])
    assert length == 300
    assert len(payload["portfolio"]) == length
    assert len(payload["benchmark_rebased"]) == length
    assert len(payload["drawdown_pct"]) == length
    for series in payload["per_holding"].values():
        assert len(series) == length


def test_history_benchmark_is_rebased_onto_the_portfolio_start(analytics: PortfolioAnalytics) -> None:
    payload = analytics.history()
    assert payload["benchmark_rebased"][0] == pytest.approx(payload["portfolio"][0], abs=0.05)


def test_history_per_holding_values_sum_to_the_equity_curve(analytics: PortfolioAnalytics) -> None:
    payload = analytics.history()
    for day in (0, 150, 299):
        total = sum(series[day] for series in payload["per_holding"].values())
        assert total == pytest.approx(payload["portfolio"][day], abs=0.05)


def test_history_drawdown_is_never_positive(analytics: PortfolioAnalytics) -> None:
    assert max(analytics.history()["drawdown_pct"]) <= 0.0


def test_returns_day_counts_reconcile(analytics: PortfolioAnalytics) -> None:
    payload = analytics.returns()
    assert payload["observations"] == 299  # one fewer than the price history
    assert payload["positive_days"] + payload["negative_days"] <= payload["observations"]
    assert 0.0 <= payload["hit_rate_pct"] <= 1.0
    assert payload["worst_day"]["pct"] <= payload["best_day"]["pct"]


def test_risk_exposes_every_metric_the_panel_renders(analytics: PortfolioAnalytics) -> None:
    payload = analytics.risk()
    assert payload["volatility_annualized_pct"] > 0
    assert math.isfinite(payload["sharpe_ratio"])
    assert math.isfinite(payload["sortino_ratio"])
    assert payload["max_drawdown"]["pct"] <= 0.0
    assert payload["beta"]["benchmark"] == "^GSPC"


def test_risk_var_rises_with_confidence(analytics: PortfolioAnalytics) -> None:
    var = analytics.risk()["value_at_risk"]
    assert var["99"]["parametric_pct"] > var["95"]["parametric_pct"]

    # The money figure is derived from the unrounded fraction, so it can differ
    # from pct * value by up to half a unit of the 4 dp rounding.
    tolerance = 1e-4 * analytics.total_value
    for level in ("95", "99"):
        assert var[level]["historical_value"] == pytest.approx(
            var[level]["historical_pct"] * analytics.total_value, abs=tolerance
        )


def test_risk_correlation_matrix_is_square_and_unit_diagonal(analytics: PortfolioAnalytics) -> None:
    correlation = analytics.risk()["correlation"]
    tickers, matrix = correlation["tickers"], correlation["matrix"]
    assert len(tickers) == 3
    assert all(len(row) == 3 for row in matrix)
    for i in range(3):
        assert matrix[i][i] == pytest.approx(1.0)
        for j in range(3):
            assert matrix[i][j] == pytest.approx(matrix[j][i])


def test_montecarlo_dates_align_with_the_bands(analytics: PortfolioAnalytics) -> None:
    payload = analytics.montecarlo()
    assert payload["dates"][0] == payload["as_of"]
    assert len(payload["dates"]) == payload["horizon_days"] + 1
    for band in payload["percentile_bands"].values():
        assert len(band) == len(payload["dates"])


def test_montecarlo_starts_from_todays_value(analytics: PortfolioAnalytics) -> None:
    payload = analytics.montecarlo()
    assert payload["start_value"] == pytest.approx(analytics.summary()["total_value"], abs=0.05)


def test_montecarlo_reports_a_valid_probability_and_ordered_finals(analytics: PortfolioAnalytics) -> None:
    payload = analytics.montecarlo()
    assert 0.0 <= payload["probability_below_start_pct"] <= 1.0
    finals = payload["final_values"]
    assert finals["p5"] < finals["p25"] < finals["p50"] < finals["p75"] < finals["p95"]


def test_all_payloads_covers_every_route(analytics: PortfolioAnalytics) -> None:
    payloads = analytics.all_payloads()
    assert set(payloads) == set(ROUTES)
    assert_json_safe(payloads)
