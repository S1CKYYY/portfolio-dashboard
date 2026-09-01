"""
tools/generate_macro.py — makroekonomická data + news pro dashboard.
Zdroje: Yahoo Finance (yfinance) + FRED CSV API
"""

import json, sys, warnings, time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

warnings.filterwarnings("ignore")
yf.set_tz_cache_location("/tmp/yf-tz-macro")

OUT = Path("macro.json")
NOW = datetime.now(timezone.utc)

# ── Helpers ────────────────────────────────────────────────────────────────

def safe_float(val):
    try:
        v = float(val)
        return None if v != v else v  # NaN check
    except Exception:
        return None

def sparkline(series: pd.Series, n: int = 30) -> list:
    s = series.dropna().tail(n)
    return [round(float(v), 4) for v in s]

def yoy(series: pd.Series) -> pd.Series:
    return ((series / series.shift(12)) - 1) * 100

def history_data(series: pd.Series, n: int = 252) -> dict:
    """Vrátí dates + values pro historický graf."""
    s = series.dropna().tail(n)
    return {
        "dates":  [d.strftime("%Y-%m-%d") for d in s.index],
        "values": [round(float(v), 4) for v in s],
    }

# ── Yahoo Finance market data ──────────────────────────────────────────────

def fetch_yahoo(tickers: dict, period: str = "1y") -> dict:
    symbols = list(tickers.values())
    print(f"  Yahoo Finance: {symbols}")
    try:
        raw = yf.download(symbols, period=period, auto_adjust=True, progress=False)
        if raw.empty:
            return {}
        closes = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw[["Close"]].rename(columns={"Close": symbols[0]})
        closes = closes.ffill()
    except Exception as e:
        print(f"  ⚠️ Yahoo: {e}", file=sys.stderr)
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
            "history":    history_data(s),  # pro grafy
        }
    return result

# ── FRED CSV ───────────────────────────────────────────────────────────────

FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id="

FRED_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,text/csv,*/*',
    'Referer': 'https://fred.stlouisfed.org/',
}

def fetch_fred(series_id: str, n: int = 60) -> pd.Series:
    for attempt in range(3):
        try:
            url = FRED_URL + series_id
            resp = requests.get(url, headers=FRED_HEADERS, timeout=20)
            resp.raise_for_status()
            from io import StringIO
            df = pd.read_csv(StringIO(resp.text), parse_dates=["DATE"], index_col="DATE")
            s = df.iloc[:, 0].replace(".", float("nan")).astype(float).dropna()
            result = s.tail(n)
            if not result.empty:
                print(f"    FRED {series_id}: {len(result)} bodů, poslední {result.iloc[-1]:.3f}")
            return result
        except Exception as e:
            print(f"  ⚠️ FRED {series_id} attempt {attempt+1}: {e}", file=sys.stderr)
            if attempt < 2:
                time.sleep(3)
    return pd.Series(dtype=float)

def fred_card(s: pd.Series, yoy_mode: bool = False) -> dict | None:
    if s.empty or len(s) < 2:
        return None
    if yoy_mode:
        s = yoy(s).dropna()
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
        "history":  history_data(s, 36),
    }

# ── News ───────────────────────────────────────────────────────────────────

PORTFOLIO_TICKERS = ["BRK-B", "DUOL", "PYPL", "META", "MSFT", "NFLX"]
MARKET_TICKERS    = ["^VIX", "^TNX", "GC=F"]

def fetch_news() -> list:
    print("  Stahuji news...")
    seen = set()
    items = []
    all_tickers = PORTFOLIO_TICKERS + MARKET_TICKERS
    for sym in all_tickers:
        try:
            news = yf.Ticker(sym).news or []
            for n in news[:3]:
                url = n.get("link") or n.get("url") or ""
                if not url or url in seen:
                    continue
                seen.add(url)
                # Rozhoduj relevanci
                title = n.get("title", "")
                if not title:
                    continue
                ts = n.get("providerPublishTime") or n.get("publish_time") or 0
                items.append({
                    "ticker":    sym,
                    "title":     title,
                    "publisher": n.get("publisher") or n.get("source") or "",
                    "url":       url,
                    "ts":        int(ts),
                })
        except Exception:
            pass
    # Seřaď podle času, nejnovější první
    items.sort(key=lambda x: x["ts"], reverse=True)
    return items[:40]

# ── Yield spread ───────────────────────────────────────────────────────────

def yield_spread(market: dict) -> dict | None:
    t10 = market.get("us10y", {}).get("value")
    t2  = market.get("us2y",  {}).get("value")
    if t10 is None or t2 is None:
        return None
    spread = round(t10 - t2, 3)
    h10 = market.get("us10y", {}).get("history", {})
    h2  = market.get("us2y",  {}).get("history",  {})
    # Spread history
    dates = h10.get("dates", [])
    v10   = h10.get("values", [])
    v2    = h2.get("values", [])
    if dates and len(v10) == len(v2) == len(dates):
        spread_vals = [round(a - b, 3) for a, b in zip(v10, v2)]
    else:
        spread_vals = []
    return {
        "value":      spread,
        "change_abs": round((market.get("us10y", {}).get("change_abs", 0) or 0) -
                            (market.get("us2y",  {}).get("change_abs", 0) or 0), 3),
        "change_pct": None,
        "inverted":   spread < 0,
        "history":    {"dates": dates, "values": spread_vals},
    }

# ── VIX stav ────────────────────────────────────────────────────────────────

def vix_state(v: float) -> str:
    if v < 15: return "Klid"
    if v < 20: return "Mírné napětí"
    if v < 25: return "Pozor"
    if v < 30: return "Strach"
    return "Panika"

# ── Polymarket / Fed Futures ───────────────────────────────────────────────

def rate_expectations(current_rate: float | None) -> dict:
    try:
        tickers_to_try = ["ZQU26.CBT", "ZQU6.CBT"]
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
            return {"available": False, "current_rate": current_rate}
        implied = round(100 - price, 3)
        diff = implied - current_rate
        if diff < -0.15:
            cut_p = min(0.95, 0.5 + abs(diff) * 2); hold_p = 1 - cut_p; hike_p = 0.0
        elif diff > 0.15:
            hike_p = min(0.95, 0.5 + diff * 2); hold_p = 1 - hike_p; cut_p = 0.0
        else:
            hold_p = 0.6; cut_p = max(0, 0.4 - diff * 2); hike_p = max(0, 0.4 + diff * 2)
            t = hold_p + cut_p + hike_p; hold_p /= t; cut_p /= t; hike_p /= t
        return {"available": True, "current_rate": current_rate, "implied_rate": implied,
                "cut_probability": round(cut_p, 3), "hold_probability": round(hold_p, 3),
                "hike_probability": round(hike_p, 3)}
    except Exception as e:
        print(f"  ⚠️ Futures: {e}", file=sys.stderr)
        return {"available": False, "current_rate": current_rate}

# ── Main ────────────────────────────────────────────────────────────────────

def main():
    print("\n📊 generate_macro.py...")

    print("\n🌐 Yahoo Finance...")
    yahoo_tickers = {
        "vix":     "^VIX",
        "dxy":     "DX-Y.NYB",
        "eur_usd": "EURUSD=X",
        "usd_czk": "USDCZK=X",
        "eur_czk": "EURCZK=X",
        "brent":   "BZ=F",
        "gold":    "GC=F",
        "us10y":   "^TNX",
        "us2y":    "^IRX",
        "us30y":   "^TYX",
    }
    market = fetch_yahoo(yahoo_tickers, period="1y")

    if "us10y" in market and "us2y" in market:
        market["yield_spread"] = yield_spread(market)
    if "vix" in market:
        market["vix"]["state"] = vix_state(market["vix"]["value"])

    print("\n📈 FRED...")
    fred_series = {
        "cpi":          ("CPIAUCSL", True,  60),
        "core_cpi":     ("CPILFESL", True,  60),
        "pce":          ("PCEPI",    True,  60),
        "wages":        ("CES0500000003", True, 60),
        "unemployment": ("UNRATE",   False, 24),
        "fed_funds":    ("FEDFUNDS", False, 24),
        "gdp":          ("A191RL1Q225SBEA", False, 16),
    }
    fred = {}
    for key, (sid, is_yoy, n) in fred_series.items():
        raw = fetch_fred(sid, n)
        card = fred_card(raw, is_yoy)
        if card:
            label = f"{key}_yoy" if is_yoy else key
            fred[label] = card
            print(f"  {label}: {card['value']:.2f}")
        else:
            print(f"  ⚠️ {key}: žádná data")

    print("\n📉 CPI vs mzdy...")
    cpi_raw  = fetch_fred("CPIAUCSL", 60)
    wage_raw = fetch_fred("CES0500000003", 60)
    cpi_hist  = yoy(cpi_raw).dropna().tail(24)
    wage_hist = yoy(wage_raw).dropna().tail(24)
    common = cpi_hist.index.intersection(wage_hist.index)
    cpi_wages_history = {
        "dates":     [d.strftime("%Y-%m") for d in common],
        "cpi_yoy":   [round(float(cpi_hist.loc[d]), 3) for d in common],
        "wages_yoy": [round(float(wage_hist.loc[d]), 3) for d in common],
    }

    print("\n🏦 Fed futures...")
    current_rate = fred.get("fed_funds", {}).get("value")
    rate_exp = rate_expectations(current_rate)

    print("\n📰 News...")
    news = fetch_news()
    print(f"  {len(news)} zpráv")

    macro = {
        "generated_at":      NOW.isoformat(),
        "market":            market,
        "fred":              fred,
        "cpi_wages_history": cpi_wages_history,
        "rate_expectations": rate_exp,
        "news":              news,
    }
    OUT.write_text(json.dumps(macro, ensure_ascii=False, separators=(",", ":")))
    print(f"\n✅ macro.json hotov ({len(json.dumps(macro)) // 1024} KB)")

if __name__ == "__main__":
    main()
