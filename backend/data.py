"""Market-data acquisition, caching, FX conversion and calendar alignment.

Responsibilities
----------------
1. Load the portfolio definition from ``holdings.json``.
2. Fetch ~2 years of daily closes for every holding, the benchmark and the
   EUR/USD rate from Yahoo Finance, caching the result on disk.
3. Convert USD-denominated instruments into the base currency (EUR).
4. Align the crypto (7-day) and equity (5-day) calendars onto a single
   trading-day index.

FX handling
-----------
Any base currency is supported, and holdings may be quoted in any number of
currencies. Yahoo Finance names a pair ``{FROM}{TO}=X``, quoted as *TO per 1
FROM*, so converting an instrument priced in ``C`` into base ``B`` needs the
series ``{C}{B}=X`` and a multiplication: ``price_B = price_C * rate``.

The full daily FX series is applied across the whole history, not just today,
so the equity curve reflects both asset performance and currency movement —
the honest view for an investor reporting in ``B``. Cost bases are converted at
the rate observed on the acquisition date, not today's, so unrealised P&L
includes the currency effect.

Some venues quote in a minor unit: London lists in ``GBp`` (pence), not pounds.
Those are normalised to the major unit before conversion, otherwise every UK
holding would be overstated by 100x.

Calendar alignment
------------------
Crypto trades 7 days a week, listed equities do not. Mixing the two naively
either inflates the observation count (breaking the ``sqrt(252)`` annualisation
convention) or injects artificial zero-return days. We therefore take the
benchmark's trading calendar (NYSE via ``^GSPC``) as the master index, drop
crypto observations on non-trading days, and forward-fill instrument prices
across venue-specific holidays (e.g. Euronext closed while NYSE is open). Every
series then has exactly one observation per trading day.
"""

from __future__ import annotations

import hashlib
import json
import logging
import pickle
import time
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Sequence

import pandas as pd
import yfinance as yf

from config import SETTINGS, Settings

logger = logging.getLogger(__name__)

CACHE_FORMAT_VERSION = 4

MINOR_UNITS: dict[str, tuple[str, float]] = {
    "GBp": ("GBP", 0.01),
    "ZAc": ("ZAR", 0.01),
    "ILA": ("ILS", 0.01),
}


def normalise_currency(code: str) -> tuple[str, float]:
    major, factor = MINOR_UNITS.get(code, (code, 1.0))
    return major, factor


def fx_symbol(from_currency: str, to_currency: str) -> str:
    return f"{from_currency}{to_currency}=X"


@dataclass(frozen=True)
class Holding:
    ticker: str
    name: str
    asset_class: str
    region: str | None
    currency: str
    quantity: float
    cost_basis_per_unit: float
    acquired: str

    @property
    def region_label(self) -> str:
        return self.region or "Crypto"


@dataclass(frozen=True)
class Portfolio:
    base_currency: str
    holdings: tuple[Holding, ...]

    @property
    def tickers(self) -> tuple[str, ...]:
        return tuple(h.ticker for h in self.holdings)

    def by_ticker(self, ticker: str) -> Holding:
        for holding in self.holdings:
            if holding.ticker == ticker:
                return holding
        raise KeyError(ticker)


@dataclass(frozen=True)
class MarketData:
    prices_native: pd.DataFrame
    prices_base: pd.DataFrame
    fx: dict[str, pd.Series]
    benchmark: pd.Series
    base_currency: str
    fetched_at: datetime

    @property
    def as_of(self) -> date:
        return self.prices_base.index[-1].date()

    def rate_series(self, currency: str) -> pd.Series:
        major, _ = normalise_currency(currency)
        if major == self.base_currency:
            return pd.Series(1.0, index=self.prices_base.index)
        return self.fx[major]


def load_portfolio(path: Path | None = None) -> Portfolio:
    path = path or SETTINGS.holdings_path
    raw = json.loads(Path(path).read_text(encoding="utf-8"))

    if "holdings" not in raw:
        raise ValueError(f"{path}: missing 'holdings' array")

    holdings: list[Holding] = []
    for index, item in enumerate(raw["holdings"]):
        try:
            holdings.append(
                Holding(
                    ticker=str(item["ticker"]),
                    name=str(item["name"]),
                    asset_class=str(item["asset_class"]),
                    region=item.get("region") or None,
                    currency=str(item["currency"]),
                    quantity=float(item["quantity"]),
                    cost_basis_per_unit=float(item["cost_basis_per_unit"]),
                    acquired=str(item["acquired"]),
                )
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"{path}: holding #{index} is invalid: {exc}") from exc

    if not holdings:
        raise ValueError(f"{path}: portfolio is empty")

    counts = Counter(h.ticker for h in holdings)
    duplicates = sorted(t for t, n in counts.items() if n > 1)
    if duplicates:
        raise ValueError(f"{path}: duplicate tickers {duplicates}")

    return Portfolio(base_currency=str(raw.get("base_currency", "EUR")), holdings=tuple(holdings))


def _cache_file(cache_dir: Path, symbols: Sequence[str], years: int) -> Path:
    key = f"v{CACHE_FORMAT_VERSION}-{years}y-{'_'.join(sorted(symbols))}"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]
    return cache_dir / f"prices-{years}y-{digest}.pkl"


def _download_closes(symbols: Sequence[str], start: date, end: date) -> pd.DataFrame:
    yf.set_tz_cache_location("/tmp/yf-tz-fresh")
    logger.info("Downloading %d symbols from Yahoo Finance (%s .. %s)", len(symbols), start, end)
    raw = yf.download(
        list(symbols),
        start=start.isoformat(),
        end=end.isoformat(),
        auto_adjust=True,
        progress=False,
        group_by="column",
        threads=True,
    )
    if raw is None or raw.empty:
        raise RuntimeError("Yahoo Finance returned no data; check connectivity or symbols")

    closes = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw[["Close"]]
    if isinstance(closes, pd.Series):
        closes = closes.to_frame(symbols[0])

    missing = [s for s in symbols if s not in closes.columns or closes[s].dropna().empty]
    if missing:
        raise RuntimeError(f"No price data returned for: {missing}")

    closes = closes.loc[:, list(symbols)]
    closes.index = pd.to_datetime(closes.index).tz_localize(None).normalize()
    closes.index.name = "date"
    return closes.sort_index()


def _load_cached(path: Path, ttl_hours: float) -> tuple[pd.DataFrame, datetime] | None:
    if not path.exists():
        return None
    age_hours = (time.time() - path.stat().st_mtime) / 3600.0
    if age_hours > ttl_hours:
        logger.info("Price cache is %.1fh old (ttl %.1fh); refetching", age_hours, ttl_hours)
        return None
    try:
        with path.open("rb") as handle:
            payload = pickle.load(handle)
        return payload["closes"], payload["fetched_at"]
    except Exception as exc:
        logger.warning("Ignoring unreadable price cache %s: %s", path, exc)
        return None


def _store_cache(path: Path, closes: pd.DataFrame, fetched_at: datetime) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        pickle.dump({"closes": closes, "fetched_at": fetched_at}, handle)


def _align_to_trading_calendar(closes: pd.DataFrame, benchmark_symbol: str) -> pd.DataFrame:
    calendar = closes[benchmark_symbol].dropna().index
    aligned = closes.reindex(calendar).ffill()
    return aligned.dropna(how="any")


def load_market_data(
    portfolio: Portfolio,
    settings: Settings = SETTINGS,
    *,
    use_cache: bool = True,
) -> MarketData:
    base = portfolio.base_currency

    foreign = sorted(
        {
            normalise_currency(holding.currency)[0]
            for holding in portfolio.holdings
            if normalise_currency(holding.currency)[0] != base
        }
    )
    pairs = {currency: fx_symbol(currency, base) for currency in foreign}

    symbols = list(dict.fromkeys([*portfolio.tickers, settings.benchmark, *pairs.values()]))
    end = date.today() + timedelta(days=1)
    start = end - timedelta(days=int(365.25 * settings.history_years) + 10)

    cache_path = _cache_file(settings.cache_dir, symbols, settings.history_years)
    cached = _load_cached(cache_path, settings.cache_ttl_hours) if use_cache else None

    if cached is not None:
        closes, fetched_at = cached
        logger.info("Using cached prices from %s", fetched_at.isoformat())
    else:
        closes = _download_closes(symbols, start, end)
        fetched_at = datetime.now(timezone.utc)
        _store_cache(cache_path, closes, fetched_at)

    aligned = _align_to_trading_calendar(closes, settings.benchmark)

    fx = {currency: aligned[symbol] for currency, symbol in pairs.items()}
    benchmark = aligned[settings.benchmark]
    prices_native = aligned.loc[:, list(portfolio.tickers)]

    prices_base = prices_native.copy()
    for holding in portfolio.holdings:
        currency, unit = normalise_currency(holding.currency)
        if currency == base:
            prices_base[holding.ticker] = prices_native[holding.ticker] * unit
        else:
            prices_base[holding.ticker] = prices_native[holding.ticker] * unit * fx[currency]

    return MarketData(
        prices_native=prices_native,
        prices_base=prices_base,
        fx=fx,
        benchmark=benchmark,
        base_currency=base,
        fetched_at=fetched_at,
    )


def fx_rate_on(fx: pd.Series, day: str | date) -> float:
    stamp = pd.Timestamp(day).normalize()
    window = fx.loc[:stamp]
    if window.empty:
        return float(fx.iloc[0])
    return float(window.iloc[-1])


def to_iso_dates(index: Iterable[pd.Timestamp]) -> list[str]:
    return [pd.Timestamp(ts).strftime("%Y-%m-%d") for ts in index]
