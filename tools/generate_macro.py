"""
tools/generate_macro.py — makroekonomická data pro dashboard.
Zdroje: Yahoo Finance + FRED CSV + CME ZQ Futures + Manifold Markets
"""

import json, sys, time, warnings
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
        v = float(val); return None if v != v else v
    except Exception: return None

def sparkline(s: pd.Series, n=30) -> list:
    return [round(float(v), 4) for v in s.dropna().tail(n)]

def yoy(s: pd.Series) -> pd.Series:
    return ((s / s.shift(12)) - 1) * 100

def history_data(s: pd.Series, n=252) -> dict:
    sl = s.dropna().tail(n)
    return {"dates": [d.strftime("%Y-%m-%d") for d in sl.index],
            "values": [round(float(v), 4) for v in sl]}

# ── Yahoo Finance ──────────────────────────────────────────────────────────

def fetch_yahoo(tickers: dict, period="1y") -> dict:
    symbols = list(tickers.values())
    print(f"  Yahoo Finance: {list(tickers.keys())}")
    try:
        raw = yf.download(symbols, period=period, auto_adjust=True, progress=False)
        if raw.empty: return {}
        closes = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw[["Close"]].rename(columns={"Close": symbols[0]})
        closes = closes.ffill()
    except Exception as e:
        print(f"  ⚠️ Yahoo: {e}", file=sys.stderr); return {}

    result = {}
    for key, sym in tickers.items():
        if sym not in closes.columns: continue
        s = closes[sym].dropna()
        if len(s) < 2: continue
        val = safe_float(s.iloc[-1]); prev = safe_float(s.iloc[-2])
        if val is None: continue
        chg_pct = round((val / prev - 1) * 100, 3) if prev and prev != 0 else 0.0
        result[key] = {
            "value": round(val, 4), "change_pct": chg_pct,
            "change_abs": round(val - prev, 4) if prev is not None else 0.0,
            "sparkline": sparkline(s), "history": history_data(s),
        }
    return result

# ── FRED CSV ───────────────────────────────────────────────────────────────

FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id="

def fetch_fred(sid: str, n=60) -> pd.Series:
    for attempt in range(3):
        try:
            df = pd.read_csv(FRED_URL + sid, parse_dates=["DATE"], index_col="DATE", timeout=15)
            return df.iloc[:, 0].replace(".", float("nan")).astype(float).dropna().tail(n)
        except Exception as e:
            if attempt < 2: time.sleep(2)
            else: print(f"  ⚠️ FRED {sid}: {e}", file=sys.stderr)
    return pd.Series(dtype=float)

def fred_card(s: pd.Series, yoy_mode=False) -> dict | None:
    if s.empty or len(s) < 2: return None
    if yoy_mode: s = yoy(s).dropna()
    if s.empty or len(s) < 2: return None
    val = safe_float(s.iloc[-1]); prev = safe_float(s.iloc[-2])
    if val is None: return None
    return {"value": round(val, 3), "prev": round(prev, 3) if prev else None,
            "change": round(val - prev, 3) if prev else None,
            "date": s.index[-1].strftime("%Y-%m-%d"),
            "sparkline": sparkline(s, 24), "history": history_data(s, 36)}

# ── News ───────────────────────────────────────────────────────────────────

PORTFOLIO = ["BRK-B", "DUOL", "PYPL", "META", "MSFT", "NFLX"]
MARKET    = ["^VIX", "^TNX", "GC=F"]

def fetch_news() -> list:
    print("  Stahuji news...")
    seen, items = set(), []
    for sym in PORTFOLIO + MARKET:
        try:
            for n in (yf.Ticker(sym).news or [])[:3]:
                url = n.get("link") or n.get("url") or ""
                title = n.get("title", "")
                if not url or url in seen or not title: continue
                seen.add(url)
                items.append({"ticker": sym, "title": title,
                              "publisher": n.get("publisher") or n.get("source") or "",
                              "url": url, "ts": int(n.get("providerPublishTime") or n.get("publish_time") or 0)})
        except Exception: pass
    items.sort(key=lambda x: x["ts"], reverse=True)
    print(f"  {len(items)} zpráv")
    return items[:40]

# ── Yield spread ───────────────────────────────────────────────────────────

def yield_spread(market: dict) -> dict | None:
    t10 = market.get("us10y", {}).get("value")
    t2  = market.get("us2y",  {}).get("value")
    if t10 is None or t2 is None: return None
    spread = round(t10 - t2, 3)
    h10 = market.get("us10y", {}).get("history", {})
    h2  = market.get("us2y",  {}).get("history",  {})
    dates = h10.get("dates", []); v10 = h10.get("values", []); v2 = h2.get("values", [])
    spread_vals = [round(a - b, 3) for a, b in zip(v10, v2)] if dates and len(v10) == len(v2) == len(dates) else []
    return {"value": spread,
            "change_abs": round((market.get("us10y",{}).get("change_abs",0) or 0) -
                                (market.get("us2y",{}).get("change_abs",0) or 0), 3),
            "change_pct": None, "inverted": spread < 0,
            "history": {"dates": dates, "values": spread_vals}}

# ── VIX stav ──────────────────────────────────────────────────────────────

def vix_state(v: float) -> str:
    if v < 15: return "Klid"
    if v < 20: return "Mírné napětí"
    if v < 25: return "Pozor"
    if v < 30: return "Strach"
    return "Panika"

# ── CME FedWatch pravděpodobnosti ─────────────────────────────────────────

# FOMC termíny (federalreserve.gov)
FOMC_DATES = [
    "2026-01-28","2026-03-18","2026-04-29","2026-06-17",
    "2026-07-28","2026-09-15","2026-10-28","2026-12-09",
    "2027-01-26","2027-03-17","2027-04-28","2027-06-15",
]
MONTH_CODES = {1:"F",2:"G",3:"H",4:"J",5:"K",6:"M",7:"N",8:"Q",9:"U",10:"V",11:"X",12:"Z"}

def _next_fomc():
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for d in FOMC_DATES:
        dt = datetime.strptime(d, "%Y-%m-%d")
        if dt > now: return d, dt.month, dt.year
    return "", 0, 0

def _from_cme_api(current_rate: float) -> dict | None:
    """Přímý CME FedWatch API endpoint."""
    import urllib.request
    url = "https://www.cmegroup.com/CmeWS/mvc/FedWatch/probability.do?venue=G&selected=FOMC"
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json", "Referer": "https://www.cmegroup.com/"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read())
        meetings = data.get("meetings", data.get("probabilities", []))
        if not meetings: return None
        m = meetings[0] if isinstance(meetings, list) else data
        probs = m.get("probabilities", m)
        cut = hold = hike = None
        for k, v in probs.items():
            try: pct = float(str(v).replace("%","")) / 100
            except Exception: continue
            kl = k.lower()
            if "cut" in kl or "down" in kl or "-" in k: cut = pct
            elif "hike" in kl or "up" in kl or "+" in k: hike = pct
            elif any(x in kl for x in ["unch","hold","no change"]): hold = pct
        if cut is None and hold is None: return None
        cut = cut or 0.0; hike = hike or 0.0
        hold = hold or max(0.0, 1.0 - cut - hike)
        fomc_date, _, _ = _next_fomc()
        print(f"  ✓ CME FedWatch API: cut={cut:.1%} hold={hold:.1%} hike={hike:.1%}")
        return {"available": True, "source": "CME FedWatch",
                "current_rate": current_rate, "next_meeting": fomc_date,
                "cut_probability": round(cut,3), "hold_probability": round(hold,3), "hike_probability": round(hike,3)}
    except Exception as e:
        print(f"  ⚠️ CME API: {e}", file=sys.stderr); return None

def _from_zq_futures(current_rate: float) -> dict | None:
    """Výpočet z 30-Day Fed Funds Futures (ZQ) — CME FedWatch metoda."""
    fomc_date, fomc_month, fomc_year = _next_fomc()
    if not fomc_date: return None
    # Pro 2. polovinu měsíce použij kontrakt měsíce PO zasedání
    import datetime as dt_mod
    fomc_dt = dt_mod.datetime.strptime(fomc_date, "%Y-%m-%d")
    if fomc_dt.day > 15:
        contract_month = fomc_month % 12 + 1
        contract_year  = fomc_year + (1 if fomc_month == 12 else 0)
    else:
        contract_month, contract_year = fomc_month, fomc_year
    code = MONTH_CODES.get(contract_month, "")
    yr   = str(contract_year)[-2:]
    tickers = [f"ZQ{code}{yr}.CBT", f"ZQ{code}{yr}=F", "ZQ=F"]
    for t in tickers:
        try:
            d = yf.download(t, period="5d", auto_adjust=True, progress=False)
            if not d.empty:
                price   = float(d["Close"].dropna().iloc[-1])
                implied = round(100 - price, 3)
                diff    = implied - current_rate
                step    = 0.25
                if diff < -(step * 0.4):
                    cut_p = min(0.97, 0.5 + abs(diff) / step * 0.5)
                    hold_p = 1 - cut_p; hike_p = 0.0
                elif diff > (step * 0.4):
                    hike_p = min(0.97, 0.5 + diff / step * 0.5)
                    hold_p = 1 - hike_p; cut_p = 0.0
                else:
                    hold_p = 0.75; cut_p = max(0, 0.25 - diff * 2); hike_p = max(0, diff * 2)
                    tot = hold_p + cut_p + hike_p
                    hold_p /= tot; cut_p /= tot; hike_p /= tot
                print(f"  ✓ ZQ futures {t}: price={price:.3f} implied={implied:.3f}%")
                return {"available": True, "source": f"CME ZQ Futures ({t})",
                        "current_rate": current_rate, "implied_rate": implied, "next_meeting": fomc_date,
                        "cut_probability": round(cut_p,3), "hold_probability": round(hold_p,3), "hike_probability": round(hike_p,3)}
        except Exception: pass
    return None

def _from_manifold(current_rate: float) -> dict | None:
    """Fallback: Manifold Markets (veřejný prediction market, EU přístupný)."""
    import urllib.request
    fomc_date, _, _ = _next_fomc()
    for query in ["federal+reserve+rate+cut+2026", "FOMC+cut+september"]:
        try:
            url = f"https://api.manifold.markets/v0/search-markets?term={query}&limit=5"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                markets = json.loads(resp.read())
            for mkt in markets:
                prob = mkt.get("probability"); q = mkt.get("question","").lower()
                if prob is not None and "cut" in q and ("fed" in q or "fomc" in q):
                    cut_p = float(prob)
                    hold_p = max(0, 1 - cut_p - 0.03); hike_p = max(0, 1 - cut_p - hold_p)
                    print(f"  ✓ Manifold: cut={cut_p:.1%} — {mkt.get('question','')[:50]}")
                    return {"available": True, "source": "Manifold Markets",
                            "current_rate": current_rate, "next_meeting": fomc_date,
                            "cut_probability": round(cut_p,3), "hold_probability": round(hold_p,3), "hike_probability": round(hike_p,3)}
        except Exception as e:
            print(f"  ⚠️ Manifold: {e}", file=sys.stderr)
    return None

def rate_expectations(current_rate: float | None) -> dict:
    """CME FedWatch API → ZQ Futures → Manifold Markets."""
    base = {"available": False, "current_rate": current_rate}
    if current_rate is None: return base
    print("  Zkouším CME FedWatch API...")
    result = _from_cme_api(current_rate)
    if result: return result
    print("  Zkouším ZQ Futures...")
    result = _from_zq_futures(current_rate)
    if result: return result
    print("  Zkouším Manifold Markets...")
    result = _from_manifold(current_rate)
    if result: return result
    print("  ⚠️ Žádný zdroj predikcí nedostupný")
    return {**base, "next_meeting": _next_fomc()[0]}

# ── Main ──────────────────────────────────────────────────────────────────

def main():
    print("\n📊 generate_macro.py...")

    print("\n🌐 Yahoo Finance...")
    market = fetch_yahoo({
        "vix":     "^VIX",    "dxy":     "DX-Y.NYB",
        "eur_usd": "EURUSD=X","usd_czk": "USDCZK=X","eur_czk": "EURCZK=X",
        "brent":   "BZ=F",    "gold":    "GC=F",
        "us10y":   "^TNX",    "us2y":    "^IRX",     "us30y":   "^TYX",
    }, period="1y")

    if "us10y" in market and "us2y" in market:
        market["yield_spread"] = yield_spread(market)
    if "vix" in market:
        market["vix"]["state"] = vix_state(market["vix"]["value"])

    print("\n📈 FRED...")
    fred_series = {
        "cpi_yoy":      ("CPIAUCSL",          True,  60),
        "core_cpi_yoy": ("CPILFESL",          True,  60),
        "pce_yoy":      ("PCEPI",             True,  60),
        "wages_yoy":    ("CES0500000003",     True,  60),
        "unemployment": ("UNRATE",            False, 24),
        "fed_funds":    ("FEDFUNDS",          False, 24),
        "gdp":          ("A191RL1Q225SBEA",   False, 16),
    }
    fred = {}
    for label, (sid, is_yoy, n) in fred_series.items():
        raw = fetch_fred(sid, n)
        card = fred_card(raw, is_yoy)
        if card:
            fred[label] = card
            print(f"  {label}: {card['value']:.2f}")
        else:
            print(f"  ⚠️ {label}: žádná data")

    print("\n📉 CPI vs mzdy...")
    cpi_h  = yoy(fetch_fred("CPIAUCSL", 60)).dropna().tail(24)
    wage_h = yoy(fetch_fred("CES0500000003", 60)).dropna().tail(24)
    common = cpi_h.index.intersection(wage_h.index)
    cpi_wages = {"dates": [d.strftime("%Y-%m") for d in common],
                 "cpi_yoy":   [round(float(cpi_h.loc[d]),3)  for d in common],
                 "wages_yoy": [round(float(wage_h.loc[d]),3) for d in common]}

    print("\n🏦 CME FedWatch...")
    current_rate = fred.get("fed_funds", {}).get("value")
    rate_exp = rate_expectations(current_rate)

    print("\n📰 News...")
    news = fetch_news()

    OUT.write_text(json.dumps({
        "generated_at": NOW.isoformat(), "market": market,
        "fred": fred, "cpi_wages_history": cpi_wages,
        "rate_expectations": rate_exp, "news": news,
    }, ensure_ascii=False, separators=(",",":")))
    print(f"\n✅ macro.json hotov ({len(OUT.read_text())//1024} KB)")

if __name__ == "__main__":
    main()
