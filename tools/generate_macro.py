"""
tools/generate_macro.py
Generuje macro.json s makroekonomickými daty pro Makro stránku dashboardu.
Zdroje: Yahoo Finance (yfinance) + FRED CSV API (bez klíče)
"""

import json
import sys
import warnings
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

warnings.filterwarnings("ignore")
yf.set_tz_cache_location("/tmp/yf-tz-macro")

OUT = Path("macro.json")
NOW = datetime.now(timezone.utc)

# ── Helpers ──────────────────────────────────────────────────────────────────

def safe_float(val):
    try:
        v = float(val)
        return v if not (v != v) else None  # NaN check
    except Exception:
        return None

def sparkline(series: pd.Series, n: int = 30) -> list:
    s = series.dropna().tail(n)
    return [round(float(v), 4) for v in s]

def yoy(series: pd.Series) -> pd.Series:
    """Meziroční změna v procentech."""
    return ((series / series.shift(12)) - 1) * 100


# ── Yahoo Finance ─────────────────────────────────────────────────────────────

def fetch_yahoo(tickers: dict, period: str = "3mo") -> dict:
    """Stáhne close ceny pro tickers a vrátí karty s hodnotou + change + sparkline."""
    print(f"  Stahuji Yahoo Finance: {list(tickers.keys())}")
    symbols = list(tickers.values())
    try:
        raw = yf.download(symbols, period=period, auto_adjust=True, progress=False)
        if raw.empty:
            return {}
        closes = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw[["Close"]].rename(columns={"Close": symbols[0]})
        closes = closes.ffill()
    except Exception as e:
        print(f"  ⚠️ Yahoo download selhal: {e}", file=sys.stderr)
        return {}

    result = {}
    for key, sym in tickers.items():
        if sym not in closes.columns:
            continue
        s = closes[sym].dropna()
        if len(s) < 2:
            continue
        val  = safe_float(s.iloc[-1])
        prev = safe_float(s.iloc[-2])
        if val is None:
            continue
        chg_pct = round((val / prev - 1) * 100, 3) if prev and prev != 0 else 0.0
        chg_abs = round(val - prev, 4) if prev is not None else 0.0
        result[key] = {
            "value":      round(val, 4),
            "change_pct": chg_pct,
            "change_abs": chg_abs,
            "sparkline":  sparkline(s),
        }
    return result


# ── FRED CSV ─────────────────────────────────────────────────────────────────

FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id="

def fetch_fred(series_id: str, n_periods: int = 36) -> pd.Series:
    try:
        url = FRED_URL + series_id
        df = pd.read_csv(url, parse_dates=["DATE"], index_col="DATE")
        s = df.iloc[:, 0].replace(".", float("nan")).astype(float).dropna()
        return s.tail(n_periods)
    except Exception as e:
        print(f"  ⚠️ FRED {series_id} selhal: {e}", file=sys.stderr)
        return pd.Series(dtype=float)

def fred_card(series: pd.Series, label: str, is_yoy: bool = False) -> dict | None:
    if series.empty or len(series) < 2:
        return None
    if is_yoy:
        s = yoy(fetch_fred(label, n_periods=60)).dropna()
    else:
        s = series
    if s.empty or len(s) < 2:
        return None
    val  = safe_float(s.iloc[-1])
    prev = safe_float(s.iloc[-2])
    if val is None:
        return None
    return {
        "value":    round(val, 3),
        "prev":     round(prev, 3) if prev is not None else None,
        "change":   round(val - prev, 3) if prev is not None else None,
        "date":     s.index[-1].strftime("%Y-%m-%d"),
        "sparkline": sparkline(s, 24),
    }


# ── Yield spread ──────────────────────────────────────────────────────────────

def yield_spread(market: dict) -> dict | None:
    t10 = market.get("us10y", {}).get("value")
    t2  = market.get("us2y",  {}).get("value")
    if t10 is None or t2 is None:
        return None
    spread = round(t10 - t2, 3)
    sp_prev = (market.get("us10y", {}).get("change_abs", 0) or 0) - (market.get("us2y", {}).get("change_abs", 0) or 0)
    return {
        "value":      spread,
        "change_abs": round(sp_prev, 3),
        "change_pct": None,
        "sparkline":  [],
        "inverted":   spread < 0,
    }


# ── VIX stav ──────────────────────────────────────────────────────────────────

def vix_state(vix_val: float) -> str:
    if vix_val < 15:   return "Klid"
    if vix_val < 20:   return "Mírné napětí"
    if vix_val < 25:   return "Pozor"
    if vix_val < 30:   return "Strach"
    return "Panika"


# ── Fed Funds Futures (ZQ) ────────────────────────────────────────────────────

def rate_expectations(current_rate: float | None) -> dict:
    """Odhadne pravděpodobnost pohybu sazeb z Fed Funds Futures."""
    try:
        # ZQU26 = September 2026 futures (zkusíme generický ticker)
        tickers_to_try = ["ZQU26.CBT", "ZQU6.CBT", "ZQU26=F"]
        price = None
        for t in tickers_to_try:
            try:
                d = yf.download(t, period="5d", auto_adjust=True, progress=False)
                if not d.empty:
                    price = float(d["Close"].dropna().iloc[-1])
                    break
            except Exception:
                continue

        if price is None or current_rate is None:
            return {"available": False}

        implied_rate = round(100 - price, 3)
        diff = round(implied_rate - current_rate, 3)

        # Pravděpodobnosti — zjednodušený model
        # Pokud implied < current o >0.15 = cut pravděpodobný
        # Pokud implied > current o >0.15 = hike pravděpodobný
        if diff < -0.15:
            cut_p  = min(0.95, 0.5 + abs(diff) * 2)
            hold_p = 1.0 - cut_p
            hike_p = 0.0
        elif diff > 0.15:
            hike_p = min(0.95, 0.5 + diff * 2)
            hold_p = 1.0 - hike_p
            cut_p  = 0.0
        else:
            hold_p = 0.6
            cut_p  = max(0, 0.4 - diff * 2)
            hike_p = max(0, 0.4 + diff * 2)
            total  = hold_p + cut_p + hike_p
            hold_p, cut_p, hike_p = hold_p/total, cut_p/total, hike_p/total

        return {
            "available":        True,
            "current_rate":     current_rate,
            "implied_rate":     implied_rate,
            "cut_probability":  round(cut_p, 3),
            "hold_probability": round(hold_p, 3),
            "hike_probability": round(hike_p, 3),
        }
    except Exception as e:
        print(f"  ⚠️ Rate expectations selhal: {e}", file=sys.stderr)
        return {"available": False}


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("\n📊 Generuji macro.json...")

    # 1. Yahoo Finance — tržní indikátory
    print("\n🌐 Tržní indikátory (Yahoo Finance)...")
    yahoo_tickers = {
        "vix":      "^VIX",
        "sp500":    "^GSPC",
        "nasdaq":   "^IXIC",
        "dxy":      "DX-Y.NYB",
        "eur_usd":  "EURUSD=X",
        "usd_czk":  "USDCZK=X",
        "eur_czk":  "EURCZK=X",
        "brent":    "BZ=F",
        "wti":      "CL=F",
        "gold":     "GC=F",
        "us10y":    "^TNX",
        "us2y":     "^IRX",
    }
    market = fetch_yahoo(yahoo_tickers, period="3mo")

    # Yield spread
    if "us10y" in market and "us2y" in market:
        market["yield_spread"] = yield_spread(market)

    # VIX stav
    if "vix" in market:
        market["vix"]["state"] = vix_state(market["vix"]["value"])

    # 2. FRED — makro data
    print("\n📈 FRED makro data...")
    fred_raw = {
        "cpi":          fetch_fred("CPIAUCSL", 60),
        "core_cpi":     fetch_fred("CPILFESL", 60),
        "pce":          fetch_fred("PCEPI", 60),
        "wages":        fetch_fred("CES0500000003", 60),
        "unemployment": fetch_fred("UNRATE", 24),
        "fed_funds":    fetch_fred("FEDFUNDS", 24),
        "gdp":          fetch_fred("A191RL1Q225SBEA", 16),
    }

    fred = {}
    # YoY série
    for key in ["cpi", "core_cpi", "pce", "wages"]:
        s = fred_raw[key]
        if not s.empty and len(s) >= 13:
            yoy_s = yoy(s).dropna()
            card = fred_card(yoy_s, key)
            if card:
                fred[f"{key}_yoy"] = card
                print(f"  {key}_yoy: {card['value']:.2f}% (předchozí {card['prev']:.2f}%)")

    # Přímé hodnoty
    for key in ["unemployment", "fed_funds", "gdp"]:
        s = fred_raw[key]
        if not s.empty:
            card = fred_card(s, key)
            if card:
                fred[key] = card
                print(f"  {key}: {card['value']}")

    # 3. CPI vs mzdy — historická data (24 měsíců)
    print("\n📉 CPI vs mzdy — historická data...")
    cpi_hist  = yoy(fred_raw["cpi"]).dropna().tail(24)
    wage_hist = yoy(fred_raw["wages"]).dropna().tail(24)
    # Sjednoť indexy
    common_idx = cpi_hist.index.intersection(wage_hist.index)
    cpi_wages_history = {
        "dates":     [d.strftime("%Y-%m") for d in common_idx],
        "cpi_yoy":   [round(float(cpi_hist.loc[d]), 3) for d in common_idx],
        "wages_yoy": [round(float(wage_hist.loc[d]), 3) for d in common_idx],
    }

    # 4. Sazby — očekávání
    print("\n🏦 Fed Funds Futures...")
    current_rate = fred.get("fed_funds", {}).get("value")
    rate_exp = rate_expectations(current_rate)

    # 5. Sestavit výstup
    macro = {
        "generated_at":      NOW.isoformat(),
        "market":            market,
        "fred":              fred,
        "cpi_wages_history": cpi_wages_history,
        "rate_expectations": rate_exp,
    }

    OUT.write_text(json.dumps(macro, ensure_ascii=False, separators=(",", ":")))
    print(f"\n✅ macro.json uložen ({len(json.dumps(macro))} bytes)")


if __name__ == "__main__":
    main()
