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

# ── CME FedWatch + fallback chain ─────────────────────────────────────────

# FOMC dátumy 2026 (zdroj: federalreserve.gov)
FOMC_DATES = {
    2026: ["2026-01-28","2026-03-18","2026-04-29","2026-06-17",
           "2026-07-28","2026-09-15","2026-10-28","2026-12-09"],
    2027: ["2027-01-26","2027-03-17","2027-04-28","2027-06-15",
           "2027-07-27","2027-09-14","2027-10-27","2027-12-08"],
}
MONTH_CODES = {1:"F",2:"G",3:"H",4:"J",5:"K",6:"M",
               7:"N",8:"Q",9:"U",10:"V",11:"X",12:"Z"}

def _next_fomc() -> tuple[str, int, int]:
    """Vrátí (datum, měsíc, rok) příštího FOMC zasedání."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    all_dates = []
    for dates in FOMC_DATES.values():
        all_dates.extend(dates)
    for d in sorted(all_dates):
        dt = datetime.strptime(d, "%Y-%m-%d")
        if dt > now:
            return d, dt.month, dt.year
    return "", 0, 0

def _from_cme_fedwatch(current_rate: float) -> dict | None:
    """Stáhne pravděpodobnosti z CME FedWatch API."""
    import urllib.request, urllib.error
    session_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "application/json, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html",
        "X-Requested-With": "XMLHttpRequest",
    }
    url = "https://www.cmegroup.com/CmeWS/mvc/FedWatch/probability.do?venue=G&selected=FOMC"
    try:
        req = urllib.request.Request(url, headers=session_headers)
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read())
        # Parsuj první meeting (příští)
        meetings = data.get("meetings", data.get("probabilities", []))
        if not meetings:
            return None
        m = meetings[0] if isinstance(meetings, list) else data
        # CME vrací různé formáty — zkus oba
        probs = m.get("probabilities", m)
        fomc_date, _, _ = _next_fomc()
        # Hledej cut/hold/hike klíče
        cut = hold = hike = None
        for k, v in probs.items():
            k_lower = k.lower()
            try:
                pct = float(str(v).replace("%", "")) / 100
            except Exception:
                continue
            if "cut" in k_lower or "down" in k_lower or "-" in k:
                cut = pct
            elif "hike" in k_lower or "up" in k_lower or "+" in k:
                hike = pct
            elif "unch" in k_lower or "hold" in k_lower or "no" in k_lower:
                hold = pct
        if cut is None and hold is None:
            return None
        cut  = cut  or 0.0
        hike = hike or 0.0
        hold = hold or max(0.0, 1.0 - cut - hike)
        print(f"  ✓ CME FedWatch: cut={cut:.1%} hold={hold:.1%} hike={hike:.1%}")
        return {"available": True, "source": "CME FedWatch",
                "current_rate": current_rate, "next_meeting": fomc_date,
                "cut_probability": round(cut, 3),
                "hold_probability": round(hold, 3),
                "hike_probability": round(hike, 3)}
    except Exception as e:
        print(f"  ⚠️ CME FedWatch: {e}", file=sys.stderr)
        return None

def _from_zq_futures(current_rate: float, fomc_month: int, fomc_year: int) -> dict | None:
    """Výpočet z 30-Day Fed Funds Futures (ZQ) na CME."""
    code = MONTH_CODES.get(fomc_month, "")
    yr   = str(fomc_year)[-2:]
    yr1  = str(fomc_year)[-1]
    tickers = [
        f"ZQ{code}{yr}.CBT",
        f"ZQ{code}{yr}=F",
        f"ZQ{code}{yr1}.CBT",
        "ZQ=F",  # front-month generic
    ]
    for t in tickers:
        try:
            d = yf.download(t, period="5d", auto_adjust=True, progress=False)
            if not d.empty:
                price = float(d["Close"].dropna().iloc[-1])
                implied = round(100 - price, 3)
                diff = implied - current_rate
                step = 0.25
                if diff < -(step * 0.5):
                    cut_p  = min(0.97, 0.5 + abs(diff) / step * 0.5)
                    hold_p = 1.0 - cut_p; hike_p = 0.0
                elif diff > (step * 0.5):
                    hike_p = min(0.97, 0.5 + diff / step * 0.5)
                    hold_p = 1.0 - hike_p; cut_p = 0.0
                else:
                    hold_p = 0.7
                    cut_p  = max(0, 0.3 - diff * 2)
                    hike_p = max(0, diff * 2)
                    tot = hold_p + cut_p + hike_p
                    hold_p /= tot; cut_p /= tot; hike_p /= tot
                print(f"  ✓ ZQ futures {t}: price={price:.3f} implied={implied:.3f}%")
                return {"available": True, "source": f"CME ZQ Futures ({t})",
                        "current_rate": current_rate, "implied_rate": implied,
                        "cut_probability": round(cut_p, 3),
                        "hold_probability": round(hold_p, 3),
                        "hike_probability": round(hike_p, 3)}
        except Exception:
            pass
    return None

def _from_manifold(current_rate: float, fomc_date: str) -> dict | None:
    """Fallback: Manifold Markets (veřejný prediction market)."""
    import urllib.request
    year = fomc_date[:4] if fomc_date else ""
    for query in [f"fed+rate+cut+{year}", "federal+reserve+rate+cut", "FOMC+rate"]:
        try:
            url = f"https://api.manifold.markets/v0/search-markets?term={query}&limit=5"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                markets = json.loads(resp.read())
            for mkt in markets:
                prob = mkt.get("probability")
                q    = mkt.get("question", "").lower()
                if prob is not None and "cut" in q and ("fed" in q or "fomc" in q):
                    cut_p  = float(prob)
                    hold_p = max(0, 1 - cut_p - 0.03)
                    hike_p = max(0, 1 - cut_p - hold_p)
                    print(f"  ✓ Manifold: cut={cut_p:.1%} — {mkt.get('question','')[:60]}")
                    return {"available": True, "source": "Manifold Markets",
                            "current_rate": current_rate, "next_meeting": fomc_date,
                            "cut_probability": round(cut_p, 3),
                            "hold_probability": round(hold_p, 3),
                            "hike_probability": round(hike_p, 3)}
        except Exception as e:
            print(f"  ⚠️ Manifold: {e}", file=sys.stderr)
    return None

def rate_expectations(current_rate: float | None) -> dict:
    """Pravděpodobnosti pohybu sazeb — CME FedWatch → ZQ Futures → Manifold → N/A."""
    base = {"available": False, "current_rate": current_rate}
    if current_rate is None:
        return base
    fomc_date, fomc_month, fomc_year = _next_fomc()
    base["next_meeting"] = fomc_date

    # 1. CME FedWatch (primární zdroj)
    result = _from_cme_fedwatch(current_rate)
    if result:
        result["next_meeting"] = fomc_date
        return result

    # 2. ZQ Futures (sekundární)
    result = _from_zq_futures(current_rate, fomc_month, fomc_year)
    if result:
        result["next_meeting"] = fomc_date
        return result

    # 3. Manifold Markets (fallback)
    result = _from_manifold(current_rate, fomc_date)
    if result:
        return result

    print("  ⚠️ Žádný zdroj predikcí nedostupný", file=sys.stderr)
    return {**base, "next_meeting": fomc_date}


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

# FOMC zasedání 2026 (přibližně)
FOMC_DATES_2026 = ["2026-01-28","2026-03-18","2026-04-29","2026-06-17",
                   "2026-07-28","2026-09-15","2026-10-28","2026-12-09"]
MONTH_CODES = {1:"F",2:"G",3:"H",4:"J",5:"K",6:"M",7:"N",8:"Q",9:"U",10:"V",11:"X",12:"Z"}

def next_fomc() -> tuple[str, str]:
    """Vrátí (datum, ZQ tiker) pro příští FOMC zasedání."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for d in FOMC_DATES_2026:
        dt = datetime.strptime(d, "%Y-%m-%d")
        if dt > now:
            code = MONTH_CODES[dt.month]
            yr = str(dt.year)[-2:]
            return d, f"ZQ{code}{yr}"
    return "", ""

def rate_expectations(current_rate: float | None) -> dict:
    base = {"available": False, "current_rate": current_rate}
    if current_rate is None:
        return base
    fomc_date, zq_base = next_fomc()
    price = None
    # Zkus různé formáty tikeru
    for suffix in [".CBT", "=F"]:
        t = zq_base + suffix
        try:
            d = yf.download(t, period="5d", auto_adjust=True, progress=False)
            if not d.empty:
                price = float(d["Close"].dropna().iloc[-1])
                print(f"  ZQ futures {t}: {price:.3f}")
                break
        except Exception:
            pass
    if price is None:
        # Fallback: zkus Manifold Markets API (veřejné, bez bloku)
        try:
            import urllib.request
            url = "https://api.manifold.markets/v0/search-markets?term=fed+rate+cut+september+2026&limit=3"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                markets = json.loads(resp.read())
                for mkt in markets:
                    prob = mkt.get("probability")
                    q = mkt.get("question", "").lower()
                    if prob is not None and "cut" in q and "fed" in q:
                        cut_p = float(prob)
                        hold_p = max(0, 1 - cut_p - 0.05)
                        hike_p = max(0, 1 - cut_p - hold_p)
                        print(f"  Manifold Markets: cut={cut_p:.1%} ({mkt.get('question','')})")
                        return {"available": True, "source": "Manifold Markets",
                                "current_rate": current_rate, "next_meeting": fomc_date,
                                "cut_probability": round(cut_p, 3),
                                "hold_probability": round(hold_p, 3),
                                "hike_probability": round(hike_p, 3)}
        except Exception as e:
            print(f"  ⚠️ Manifold: {e}", file=sys.stderr)
        print("  ⚠️ Futures ani Manifold nedostupné", file=sys.stderr)
        return {**base, "next_meeting": fomc_date}
    # Výpočet pravděpodobností z futures ceny
    implied = round(100 - price, 3)
    diff = implied - current_rate
    step = 0.25  # Fed hýbe po 25bp
    if diff < -(step * 0.6):
        cut_p = min(0.97, 0.5 + abs(diff) / step * 0.5)
        hold_p = 1 - cut_p; hike_p = 0.0
    elif diff > (step * 0.6):
        hike_p = min(0.97, 0.5 + diff / step * 0.5)
        hold_p = 1 - hike_p; cut_p = 0.0
    else:
        hold_p = 0.7; cut_p = max(0, 0.3 - diff * 2); hike_p = max(0, 0.3 + diff * 2)
        tot = hold_p + cut_p + hike_p; hold_p /= tot; cut_p /= tot; hike_p /= tot
    return {"available": True, "source": "CME ZQ Futures",
            "current_rate": current_rate, "implied_rate": implied, "next_meeting": fomc_date,
            "cut_probability": round(cut_p, 3), "hold_probability": round(hold_p, 3),
            "hike_probability": round(hike_p, 3)}

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

    # Fallback pro fed_funds: ^IRX (3M T-bill) z Yahoo Finance
    if "fed_funds" not in fred and "us2y" in market:
        irx = market["us2y"]
        chg = irx.get("change_abs") or 0
        fred["fed_funds"] = {
            "value":    round(irx["value"], 3),
            "prev":     round(irx["value"] - chg, 3),
            "change":   round(chg, 3),
            "date":     NOW.strftime("%Y-%m-%d"),
            "sparkline": irx.get("sparkline", []),
            "history":  irx.get("history", {}),
            "note":     "^IRX (3M T-bill proxy)",
        }
        print(f"  fed_funds fallback ^IRX: {irx['value']:.3f}%")

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
