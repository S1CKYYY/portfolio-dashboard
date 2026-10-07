/**
 * InsightsPage  –  3 panels:
 *   1. Look-Through Exposure  (client-side, uses etf_holdings.json + snapshot)
 *   2. Earnings Calendar      (Finnhub data, insights.json)
 *   3. Insider Transactions   (Finnhub data, insights.json)
 */
import { useEffect, useMemo, useState } from 'react'
import type {
  EtfHoldingsMap,
  InsightsData,
  LookThroughRow,
} from '../lib/insights-types'
import { usePortfolio } from '../lib/portfolio-context'
import { useAnalytics } from '../lib/useAnalytics'

// ─── Fetch helpers ─────────────────────────────────────────────────────────
const base = () => (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${base()}${path}?t=${Date.now()}`)
    if (!r.ok) return null
    return await r.json() as T
  } catch {
    return null
  }
}

// ─── Look-Through computation ──────────────────────────────────────────────
function computeLookThrough(
  holdings: any[],
  totalValue: number,
  etfMap: EtfHoldingsMap
): LookThroughRow[] {
  const directPct: Record<string, { pct: number; name: string }> = {}
  const viaEtfPct: Record<string, { pct: number; name: string }> = {}

  for (const h of holdings) {
    const alloc = h.allocation_pct ?? (totalValue > 0 ? h.value_base / totalValue : 0)
    const etfDef = etfMap[h.ticker]
    if (etfDef) {
      // This holding is an ETF – distribute its weight through underlying holdings
      for (const sub of etfDef.holdings) {
        const contrib = alloc * sub.weight
        if (!viaEtfPct[sub.ticker]) {
          viaEtfPct[sub.ticker] = { pct: 0, name: sub.name }
        }
        viaEtfPct[sub.ticker].pct += contrib
      }
    } else {
      // Direct stock
      const t = h.ticker
      if (!directPct[t]) directPct[t] = { pct: 0, name: h.name ?? t }
      directPct[t].pct += alloc
    }
  }

  const allTickers = new Set([...Object.keys(directPct), ...Object.keys(viaEtfPct)])
  const rows: LookThroughRow[] = []
  for (const ticker of allTickers) {
    const d = directPct[ticker]?.pct ?? 0
    const v = viaEtfPct[ticker]?.pct ?? 0
    const name = directPct[ticker]?.name ?? viaEtfPct[ticker]?.name ?? ticker
    rows.push({
      ticker,
      name,
      direct_pct: d,
      via_etf_pct: v,
      total_pct: d + v,
      also_direct: d > 0 && v > 0,
    })
  }
  return rows.sort((a, b) => b.total_pct - a.total_pct)
}

// ─── Formatters ────────────────────────────────────────────────────────────
function pct(v: number, decimals = 2) {
  return `${(v * 100).toFixed(decimals)} %`
}
function usd(v: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v)
}
function relDay(n: number) {
  if (n === 0) return 'dnes'
  if (n === 1) return 'zitra'
  if (n < 0)  return `pred ${Math.abs(n)} dny`
  return `za ${n} dni`
}

// ─── Colour helpers ────────────────────────────────────────────────────────
const POS  = 'var(--positive)'
const NEG  = 'var(--negative)'
const MUT  = 'var(--text-tertiary)'
const WARN = '#f1c21b'

// ═══════════════════════════════════════════════════════════════════════════
// Section 1: Look-Through
// ═══════════════════════════════════════════════════════════════════════════
function LookThroughSection({
  etfMap,
  rows,
}: {
  etfMap: EtfHoldingsMap
  rows: LookThroughRow[]
}) {
  const top15 = rows.slice(0, 15)
  const top10sum = rows.slice(0, 10).reduce((s, r) => s + r.total_pct, 0)
  const maxPct = top15[0]?.total_pct ?? 0.01

  // Weighted average ETF coverage
  const etfTickers = Object.keys(etfMap)
  const coverageNote = etfTickers.map(t => {
    const c = etfMap[t]?.coverage_pct ?? 0
    return `${t}: ${Math.round(c * 100)} %`
  }).join(' · ')

  return (
    <section className="panel">
      <div className="panel__header">
        <h2 className="panel__title">Look-Through Expozice</h2>
        <span className="panel__subtitle">
          Efektivni vaha vcetne ETF holdings · Pokryti ETF: {coverageNote}
        </span>
      </div>

      {/* Top-10 summary card */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 12,
        background: 'var(--surface-raised)', borderRadius: 4,
        padding: '8px 16px', marginBottom: 16,
        border: '1px solid var(--line)',
      }}>
        <span style={{ color: MUT, fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
          TOP 10 FIREM
        </span>
        <span style={{ fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 700, color: POS }}>
          {pct(top10sum, 1)}
        </span>
        <span style={{ color: MUT, fontSize: 11 }}>portfolia</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          <thead>
            <tr style={{ color: MUT, textAlign: 'right' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px 4px 0', fontWeight: 400, letterSpacing: '0.06em' }}>#</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400, letterSpacing: '0.06em' }}>Firma</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>Primo</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>Pres ETF</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>Celkem</th>
              <th style={{ padding: '4px 8px', fontWeight: 400, width: '30%' }}>Vizualizace</th>
            </tr>
          </thead>
          <tbody>
            {top15.map((row, i) => (
              <tr
                key={row.ticker}
                style={{
                  borderTop: '1px solid var(--line)',
                  background: row.also_direct ? 'rgba(66,190,101,0.04)' : undefined,
                }}
              >
                <td style={{ padding: '5px 8px 5px 0', color: MUT }}>{i + 1}</td>
                <td style={{ padding: '5px 8px' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    {row.ticker}
                  </span>
                  {row.also_direct && (
                    <span title="Drzeno primo i pres ETF" style={{
                      marginLeft: 5, fontSize: 10, color: POS,
                      background: 'rgba(66,190,101,0.15)', borderRadius: 2, padding: '1px 4px',
                    }}>+ETF</span>
                  )}
                  <br />
                  <span style={{ color: MUT, fontSize: 11 }}>{row.name}</span>
                </td>
                <td style={{ textAlign: 'right', padding: '5px 8px', color: row.direct_pct > 0 ? 'var(--text-primary)' : MUT }}>
                  {row.direct_pct > 0 ? pct(row.direct_pct) : '—'}
                </td>
                <td style={{ textAlign: 'right', padding: '5px 8px', color: row.via_etf_pct > 0.0001 ? 'var(--text-secondary)' : MUT }}>
                  {row.via_etf_pct > 0.0001 ? pct(row.via_etf_pct) : '—'}
                </td>
                <td style={{ textAlign: 'right', padding: '5px 8px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {pct(row.total_pct)}
                </td>
                <td style={{ padding: '5px 8px' }}>
                  <div style={{ display: 'flex', height: 12, borderRadius: 2, overflow: 'hidden', background: 'var(--surface-raised)' }}>
                    {row.direct_pct > 0 && (
                      <div style={{
                        width: `${(row.direct_pct / maxPct) * 100}%`,
                        background: POS, opacity: 0.9,
                      }} />
                    )}
                    {row.via_etf_pct > 0.0001 && (
                      <div style={{
                        width: `${(row.via_etf_pct / maxPct) * 100}%`,
                        background: 'rgba(66,190,101,0.35)',
                      }} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: MUT, fontSize: 11, marginTop: 10 }}>
        Temnejsi zelena = prima drzba · svetlejsi zelena = pres ETF · zlate pozadrí = drzeno primo i pres ETF.
        Data ETF holdingu jsou manualne aktualizovana ctvrtletne (data/etf_holdings.json).
      </p>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Section 2: Earnings Calendar
// ═══════════════════════════════════════════════════════════════════════════
function EarningsSection({ data }: { data: InsightsData }) {
  const events = data.earnings
  if (events.length === 0) {
    return (
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Earnings Calendar</h2>
          <span className="panel__subtitle">Zadne nadchazejici vysledky</span>
        </div>
        <NoDataNote data={data} />
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2 className="panel__title">Earnings Calendar</h2>
        <span className="panel__subtitle">
          Nadchazejici vysledky · USD pozice · do 90 dni
        </span>
      </div>
      <NoDataNote data={data} />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          <thead>
            <tr style={{ color: MUT, textAlign: 'right' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px 4px 0', fontWeight: 400 }}>Ticker</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>Datum</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>Cas</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>EPS odhad</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>Revenue</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>Beat rate</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>Posledni 4Q</th>
            </tr>
          </thead>
          <tbody>
            {events.map(ev => {
              const soon = ev.days_until >= 0 && ev.days_until <= 7
              return (
                <tr
                  key={`${ev.ticker}-${ev.date}`}
                  style={{
                    borderTop: '1px solid var(--line)',
                    background: soon ? 'rgba(241,194,27,0.06)' : undefined,
                  }}
                >
                  <td style={{ padding: '6px 8px 6px 0' }}>
                    <span style={{ fontWeight: 700, color: soon ? WARN : 'var(--text-primary)' }}>
                      {ev.ticker}
                    </span>
                    {soon && (
                      <span style={{ marginLeft: 5, fontSize: 9, color: WARN, letterSpacing: '0.1em' }}>
                        BRZY
                      </span>
                    )}
                    <br />
                    <span style={{ color: MUT, fontSize: 11 }}>{ev.name}</span>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{ color: 'var(--text-primary)' }}>{ev.date}</span>
                    <br />
                    <span style={{ color: soon ? WARN : MUT, fontSize: 11 }}>{relDay(ev.days_until)}</span>
                  </td>
                  <td style={{ padding: '6px 8px', color: MUT, fontSize: 11 }}>
                    {ev.time === 'before_market' ? 'pred open' : ev.time === 'after_market' ? 'po close' : '—'}
                  </td>
                  <td style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-primary)' }}>
                    {ev.eps_estimate != null ? `$${ev.eps_estimate.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', padding: '6px 8px', color: MUT }}>
                    {ev.revenue_estimate != null ? `${(ev.revenue_estimate / 1000).toFixed(1)} mld` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                    {ev.beat_rate != null ? (
                      <span style={{ color: ev.beat_rate >= 0.5 ? POS : NEG }}>
                        {Math.round(ev.beat_rate * 100)} %
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {ev.history.map((h, i) => (
                        <div
                          key={i}
                          title={`${h.period}: skutecnost ${h.actual ?? '?'} vs odhad ${h.estimate ?? '?'}`}
                          style={{
                            width: 12, height: 12, borderRadius: 2,
                            background: h.beat === true ? POS : h.beat === false ? NEG : MUT,
                            opacity: h.beat === null ? 0.3 : 0.9,
                          }}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Section 3: Insider Transactions
// ═══════════════════════════════════════════════════════════════════════════
function InsiderSection({ data }: { data: InsightsData }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const summaries = data.insider.filter(s =>
    s.buy_count > 0 || s.sell_count > 0
  )
  if (summaries.length === 0) {
    return (
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Insider Transakce</h2>
          <span className="panel__subtitle">Zadne transakce za poslednich 180 dni</span>
        </div>
        <NoDataNote data={data} />
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2 className="panel__title">Insider Transakce</h2>
        <span className="panel__subtitle">
          Otevreny trh P=nakup / S=prodej · USD pozice · poslednich 180 dni
        </span>
      </div>
      <NoDataNote data={data} />

      <p style={{ color: MUT, fontSize: 11, marginBottom: 12 }}>
        Pozn.: Prodeje mohou byt planovane v ramci pravidel 10b5-1 a nemusej odraze negativni nazor managementu.
        Nakupy (P) jsou silnejsi signal.
      </p>

      {/* Summary table */}
      <div style={{ overflowX: 'auto', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          <thead>
            <tr style={{ color: MUT, textAlign: 'right' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px 4px 0', fontWeight: 400 }}>Ticker</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>Nakupy</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>Prodeji</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>Cista hodnota</th>
              <th style={{ padding: '4px 8px', fontWeight: 400 }}>MSPR</th>
              <th style={{ textAlign: 'center', padding: '4px 8px', fontWeight: 400 }}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map(s => {
              const net   = s.net_value_usd
              const isExp = expanded === s.ticker
              return (
                <>
                  <tr
                    key={s.ticker}
                    style={{ borderTop: '1px solid var(--line)', cursor: 'pointer' }}
                    onClick={() => setExpanded(isExp ? null : s.ticker)}
                  >
                    <td style={{ padding: '6px 8px 6px 0' }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{s.ticker}</span>
                      <br />
                      <span style={{ color: MUT, fontSize: 11 }}>{s.company_name}</span>
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                      {s.buy_count > 0 ? (
                        <span style={{ color: POS, fontWeight: 700 }}>
                          {s.buy_count}x
                        </span>
                      ) : <span style={{ color: MUT }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                      {s.sell_count > 0 ? (
                        <span style={{ color: MUT }}>
                          {s.sell_count}x
                        </span>
                      ) : <span style={{ color: MUT }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                      <span style={{ color: net > 0 ? POS : net < 0 ? NEG : MUT, fontWeight: 600 }}>
                        {net >= 0 ? '+' : ''}{usd(net)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                      {s.mspr != null ? (
                        <span style={{ color: s.mspr > 0 ? POS : s.mspr < 0 ? NEG : MUT }}>
                          {s.mspr.toFixed(2)}
                        </span>
                      ) : <span style={{ color: MUT }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'center', padding: '6px 8px', color: MUT, fontSize: 14 }}>
                      {isExp ? '▲' : '▼'}
                    </td>
                  </tr>
                  {isExp && s.transactions.length > 0 && (
                    <tr key={`${s.ticker}-detail`}>
                      <td colSpan={6} style={{ padding: '0 0 8px 0' }}>
                        <table style={{ width: '100%', fontSize: 11, fontFamily: 'var(--font-mono)', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ color: MUT }}>
                              <th style={{ textAlign: 'left', padding: '4px 16px', fontWeight: 400 }}>Datum</th>
                              <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>Osoba / Funkce</th>
                              <th style={{ textAlign: 'center', padding: '4px 8px', fontWeight: 400 }}>Typ</th>
                              <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>Kusy</th>
                              <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>Cena</th>
                              <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>Hodnota</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.transactions.slice(0, 15).map((t, idx) => (
                              <tr key={idx} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                <td style={{ padding: '3px 16px', color: MUT }}>{t.date}</td>
                                <td style={{ padding: '3px 8px', color: 'var(--text-secondary)' }}>
                                  {t.name}
                                  {t.title && <span style={{ color: MUT }}> · {t.title}</span>}
                                </td>
                                <td style={{ textAlign: 'center', padding: '3px 8px' }}>
                                  <span style={{
                                    color: t.transaction_type === 'P' ? POS : MUT,
                                    fontWeight: t.transaction_type === 'P' ? 700 : 400,
                                    fontSize: 10, letterSpacing: '0.05em',
                                  }}>
                                    {t.transaction_type === 'P' ? 'NAKUP' : 'PRODEJ'}
                                  </span>
                                </td>
                                <td style={{ textAlign: 'right', padding: '3px 8px', color: 'var(--text-secondary)' }}>
                                  {t.shares.toLocaleString('cs-CZ')}
                                </td>
                                <td style={{ textAlign: 'right', padding: '3px 8px', color: MUT }}>
                                  ${t.price.toFixed(2)}
                                </td>
                                <td style={{ textAlign: 'right', padding: '3px 8px', color: t.transaction_type === 'P' ? POS : MUT }}>
                                  {usd(t.value_usd)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ─── "Data age" note when Finnhub hasn't been fetched ────────────────────
function NoDataNote({ data }: { data: InsightsData }) {
  if (data.finnhub_fetched_at) {
    const age = Math.round(
      (Date.now() - new Date(data.finnhub_fetched_at).getTime()) / 3_600_000
    )
    return (
      <p style={{ color: MUT, fontSize: 11, marginBottom: 10 }}>
        Data ze dne {new Date(data.finnhub_fetched_at).toLocaleString('cs-CZ')}{' '}
        ({age} hodin stara)
      </p>
    )
  }
  return (
    <p style={{ color: WARN, fontSize: 11, marginBottom: 10 }}>
      Finnhub data nejsou k dispozici – nastav FINNHUB_API_KEY jako GitHub secret.
      Zobrazuji naposledy ulozena data.
    </p>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main page component
// ═══════════════════════════════════════════════════════════════════════════
export function InsightsPage() {
  const [insights, setInsights]   = useState<InsightsData | null>(null)
  const [etfMap, setEtfMap]       = useState<EtfHoldingsMap | null>(null)
  const [loading, setLoading]     = useState(true)

  const { data } = useAnalytics()
  const { view }  = usePortfolio()

  useEffect(() => {
    Promise.all([
      fetchJson<InsightsData>('/insights.json'),
      fetchJson<EtfHoldingsMap>('/data/etf_holdings.json'),
    ]).then(([ins, etf]) => {
      setInsights(ins)
      setEtfMap(etf)
      setLoading(false)
    })
  }, [])

  const lookThroughRows = useMemo(() => {
    if (!etfMap || !data) return []
    const holdings = data.holdings?.holdings ?? []
    const filteredHoldings = view === 'all'
      ? holdings
      : holdings.filter((h: any) => h.portfolio_type === view)
    const totalValue = filteredHoldings.reduce((s: number, h: any) => s + (h.value_base ?? 0), 0)
    return computeLookThrough(filteredHoldings, totalValue, etfMap)
  }, [etfMap, data, view])

  if (loading) {
    return (
      <main style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
        Nacitam insights data…
      </main>
    )
  }

  return (
    <main className="app__main">
      {/* ── 1. Look-Through ──────────────────────────────── */}
      {etfMap && lookThroughRows.length > 0 ? (
        <LookThroughSection etfMap={etfMap} rows={lookThroughRows} />
      ) : (
        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Look-Through Expozice</h2>
            <span className="panel__subtitle">Nelze vypocitat – data ETF nebo portfolia nedostupna</span>
          </div>
        </section>
      )}

      {/* ── 2. Earnings Calendar ─────────────────────────── */}
      {insights ? (
        <EarningsSection data={insights} />
      ) : (
        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Earnings Calendar</h2>
            <span className="panel__subtitle">insights.json neni dostupny</span>
          </div>
        </section>
      )}

      {/* ── 3. Insider Transactions ──────────────────────── */}
      {insights ? (
        <InsiderSection data={insights} />
      ) : null}
    </main>
  )
}
