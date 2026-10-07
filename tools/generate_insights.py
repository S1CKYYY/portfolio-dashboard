#!/usr/bin/env python3
"""
generate_insights.py  –  Fetch earnings + insider data from Finnhub.

Rules:
- Always runs in CI (every build), but only hits the Finnhub API if:
    (a) FINNHUB_API_KEY is set in env, AND
    (b) cache is older than 6 hours OR --force flag is passed
- On any Finnhub failure (timeout, 403, rate-limit) use the cached file;
  never crash the build.
- Rate limit: 60 req/min on free tier → sleep between calls.
- API key MUST come from env / GitHub secret, never committed.
"""
from __future__ import annotations
import json, os, sys, time, pathlib, datetime, argparse
from typing import Any

# ── Paths ──────────────────────────────────────────────────────────────────
ROOT        = pathlib.Path(__file__).parent.parent
CACHE_PATH  = ROOT / "insights_cache.json"    # in repo root, committed
OUT_PATH    = ROOT / "insights.json"           # copied to frontend/public

# ── Config ─────────────────────────────────────────────────────────────────
CACHE_MAX_AGE_H = 6
RATE_DELAY_S    = 1.2   # 60 req/min → keep well under limit
TIMEOUT_S       = 15

# ── Finnhub helpers ────────────────────────────────────────────────────────
def _get(url: str, params: dict, api_key: str) -> dict | None:
    """GET request; returns parsed JSON or None on any failure."""
    try:
        import urllib.request, urllib.parse
        params["token"] = api_key
        full = url + "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(full, headers={"User-Agent": "portfolio-dashboard/1.0"})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"  [WARN] Finnhub GET failed for {url}: {e}")
        return None

BASE = "https://finnhub.io/api/v1"

def fetch_earnings_calendar(api_key: str, tickers: list[str]) -> list[dict]:
    today = datetime.date.today()
    to    = today + datetime.timedelta(days=90)
    data = _get(f"{BASE}/calendar/earnings", {
        "from": today.isoformat(), "to": to.isoformat()
    }, api_key)
    time.sleep(RATE_DELAY_S)
    if data is None:
        return []

    # Keep only our tickers
    our = {t.upper() for t in tickers}
    events = []
    for item in (data.get("earningsCalendar") or []):
        sym = (item.get("symbol") or "").upper()
        if sym not in our:
            continue
        date_str = item.get("date", "")
        try:
            ev_date = datetime.date.fromisoformat(date_str)
            days_until = (ev_date - today).days
        except ValueError:
            days_until = 999

        events.append({
            "ticker":           sym,
            "name":             item.get("company", sym),
            "date":             date_str,
            "time":             item.get("hour", "unknown"),   # "bmo" / "amc" / ""
            "eps_estimate":     item.get("epsEstimate"),
            "revenue_estimate": item.get("revenueEstimate"),   # in millions
            "days_until":       days_until,
            "history":          [],
        })
    return events

def fetch_earnings_history(api_key: str, ticker: str) -> list[dict]:
    data = _get(f"{BASE}/stock/earnings", {"symbol": ticker, "limit": 4}, api_key)
    time.sleep(RATE_DELAY_S)
    if not data:
        return []
    result = []
    for item in (data or []):
        actual   = item.get("actual")
        estimate = item.get("estimate")
        beat: bool | None = None
        if actual is not None and estimate is not None:
            beat = float(actual) >= float(estimate)
        result.append({
            "period":   item.get("period", ""),
            "actual":   actual,
            "estimate": estimate,
            "beat":     beat,
        })
    return result

def fetch_insider(api_key: str, ticker: str) -> dict:
    today  = datetime.date.today()
    frm    = (today - datetime.timedelta(days=180)).isoformat()
    data   = _get(f"{BASE}/stock/insider-transactions",
                  {"symbol": ticker, "from": frm}, api_key)
    time.sleep(RATE_DELAY_S)

    summary: dict[str, Any] = {
        "ticker":        ticker,
        "company_name":  ticker,
        "buy_count":     0,
        "sell_count":    0,
        "net_value_usd": 0.0,
        "mspr":          None,
        "transactions":  [],
    }
    if not data:
        return summary

    txns = data.get("data") or []
    for t in txns:
        tx_type = (t.get("transactionCode") or "").upper()
        # Only open-market buys (P) and sells (S); skip grants, options, etc.
        if tx_type not in ("P", "S"):
            continue
        shares = t.get("share", 0) or 0
        price  = t.get("price", 0) or 0
        val    = abs(float(shares) * float(price))
        tx = {
            "ticker":           ticker,
            "name":             t.get("name", ""),
            "title":            t.get("title", ""),
            "transaction_type": tx_type,
            "shares":           int(shares),
            "price":            float(price),
            "value_usd":        val,
            "date":             t.get("transactionDate", ""),
            "filing_date":      t.get("filingDate", ""),
        }
        summary["transactions"].append(tx)
        if tx_type == "P":
            summary["buy_count"]  += 1
            summary["net_value_usd"] += val
        else:
            summary["sell_count"] += 1
            summary["net_value_usd"] -= val

    # Optional: insider sentiment (MSPR)
    mspr_data = _get(f"{BASE}/stock/insider-sentiment",
                     {"symbol": ticker,
                      "from": (today - datetime.timedelta(days=30)).isoformat()},
                     api_key)
    time.sleep(RATE_DELAY_S)
    if mspr_data and mspr_data.get("data"):
        msprs = [d.get("mspr") for d in mspr_data["data"] if d.get("mspr") is not None]
        if msprs:
            summary["mspr"] = round(float(msprs[-1]), 3)

    return summary

# ── Cache helpers ──────────────────────────────────────────────────────────
def load_cache() -> dict | None:
    if not CACHE_PATH.exists():
        return None
    try:
        return json.loads(CACHE_PATH.read_text())
    except Exception:
        return None

def cache_is_fresh(data: dict) -> bool:
    ts = data.get("finnhub_fetched_at")
    if not ts:
        return False
    try:
        fetched = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        age_h   = (datetime.datetime.now(datetime.timezone.utc) - fetched).total_seconds() / 3600
        return age_h < CACHE_MAX_AGE_H
    except Exception:
        return False

# ── USD tickers from holdings.json ────────────────────────────────────────
def get_usd_tickers() -> list[str]:
    hpath = ROOT / "backend" / "holdings.json"
    try:
        hdata = json.loads(hpath.read_text())
        return [
            h["ticker"] for h in hdata.get("holdings", [])
            if (h.get("currency") or "").upper() == "USD"
        ]
    except Exception as e:
        print(f"  [WARN] Cannot load holdings.json: {e}")
        return []

# ── Normalise Finnhub 'hour' codes ────────────────────────────────────────
def normalise_time(code: str | None) -> str:
    if not code:
        return "unknown"
    c = (code or "").lower()
    if c in ("bmo", "before market"):
        return "before_market"
    if c in ("amc", "after market"):
        return "after_market"
    return "unknown"

# ── Main ──────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true",
                        help="Ignore cache, always re-fetch from Finnhub")
    args = parser.parse_args()

    api_key = os.environ.get("FINNHUB_API_KEY", "").strip()
    today   = datetime.date.today().isoformat()
    now_utc = datetime.datetime.now(datetime.timezone.utc).isoformat()

    # ── Try to load existing cache ─────────────────────────────────────────
    cached = load_cache()

    should_fetch = (
        api_key
        and (args.force or cached is None or not cache_is_fresh(cached))
    )

    if not api_key:
        print("  [INFO] FINNHUB_API_KEY not set – using cached insights (no fetch)")
    elif cached and cache_is_fresh(cached) and not args.force:
        print("  [INFO] Finnhub cache is fresh (<6h) – skipping fetch")

    if should_fetch:
        print("  [INFO] Fetching Finnhub data...")
        tickers = get_usd_tickers()
        print(f"  [INFO] USD tickers: {tickers}")

        earnings_events: list[dict] = []
        insider_list:    list[dict] = []

        # Earnings calendar (one request covers all tickers)
        ev = fetch_earnings_calendar(api_key, tickers)
        print(f"  [INFO] Earnings calendar: {len(ev)} upcoming events for our tickers")

        # Per-ticker historical earnings + insider data
        for ticker in tickers:
            print(f"    {ticker}: earnings history...")
            hist = fetch_earnings_history(api_key, ticker)

            # Attach history to matching calendar event, or create standalone
            matched = next((e for e in ev if e["ticker"] == ticker), None)
            if matched:
                matched["history"] = hist
                matched["time"]    = normalise_time(matched["time"])
                matched["beat_rate"] = (
                    round(sum(1 for h in hist if h["beat"]) / len(hist), 2)
                    if hist else None
                )
                earnings_events.append(matched)
            else:
                # No upcoming event – still want history available? skip for now.
                pass

            print(f"    {ticker}: insider transactions...")
            ins = fetch_insider(api_key, ticker)
            insider_list.append(ins)

        fetched_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

        result: dict = {
            "generated_at":      now_utc,
            "data_as_of":        today,
            "finnhub_fetched_at": fetched_at,
            "earnings":          sorted(earnings_events, key=lambda e: e["days_until"]),
            "insider":           insider_list,
        }
        CACHE_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(f"  [OK] Saved to {CACHE_PATH}")

    else:
        # Use cache or empty fallback
        if cached:
            result = dict(cached)
            result["generated_at"] = now_utc   # update timestamp only
        else:
            result = {
                "generated_at":      now_utc,
                "data_as_of":        today,
                "finnhub_fetched_at": None,
                "earnings":          [],
                "insider":           [],
            }

    # Write the output file (always)
    OUT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"  [OK] insights.json written ({len(result['earnings'])} earnings, {len(result['insider'])} insider summaries)")

if __name__ == "__main__":
    main()
