"""Central configuration for the portfolio analytics backend.

Every tunable lives here so the app can be re-pointed at a different portfolio,
benchmark, or risk convention without touching computation code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR: Path = Path(__file__).resolve().parent
REPO_ROOT: Path = BACKEND_DIR.parent


@dataclass(frozen=True)
class Settings:
    """Immutable runtime settings.

    Attributes:
        base_currency: Fallback reporting currency. ``holdings.json`` is the
            authority; this is only used when that file omits the field.
        benchmark: yfinance symbol used for beta and relative comparisons.
        history_years: Years of daily history to fetch.
        trading_days_per_year: Annualisation factor for volatility/Sharpe.
        risk_free_rate: Annual risk-free rate as a decimal (0.02 == 2%).
        var_confidences: Confidence levels for Value at Risk.
        mc_paths: Number of Monte Carlo paths.
        mc_horizon_days: Simulation horizon in trading days (252 ~ 1 year).
        mc_seed: RNG seed; fixed so snapshots are reproducible.
        mc_batch_paths: Paths simulated per batch, to bound peak memory.
        mc_histogram_bins: Bin count for the final-value histogram.
        money_dp: Decimal places for monetary values.
        ratio_dp: Decimal places for ratios, betas and percentages.
        cache_ttl_hours: Age at which the on-disk price cache is refetched.
        cors_origins: Allowed browser origins for the API.
    """

    base_currency: str = "EUR"
    benchmark: str = "^GSPC"
    benchmark_name: str = "S&P 500"

    history_years: int = 2
    trading_days_per_year: int = 252
    risk_free_rate: float = 0.02
    var_confidences: tuple[float, ...] = (0.95, 0.99)

    mc_paths: int = 10_000
    mc_horizon_days: int = 252
    mc_seed: int = 20240517
    mc_batch_paths: int = 1_000
    mc_histogram_bins: int = 48

    money_dp: int = 2
    ratio_dp: int = 4

    cache_ttl_hours: float = 12.0

    cors_origins: tuple[str, ...] = (
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    )

    holdings_path: Path = field(default=BACKEND_DIR / "holdings.json")
    cache_dir: Path = field(default=BACKEND_DIR / ".cache")
    snapshot_path: Path = field(default=REPO_ROOT / "snapshot.json")

    @property
    def daily_risk_free_rate(self) -> float:
        """Risk-free rate per trading day, de-annualised geometrically.

        Formula: ``(1 + rf_annual) ** (1 / trading_days) - 1``
        """
        return (1.0 + self.risk_free_rate) ** (1.0 / self.trading_days_per_year) - 1.0


SETTINGS = Settings()
