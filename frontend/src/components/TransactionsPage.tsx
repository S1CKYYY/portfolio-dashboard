/**
 * TransactionsPage  –  Historie transakcí z XTB exportů.
 *
 * Nahoře: progress bar ukazující, kolik z 100 000 CZK ročního limitu
 *         pro osvobozené příjmy (§4 ZDP) bylo vyčerpáno prodeji.
 * Dole:   tabulka všech transakcí (nákupy + prodeje), filtrovaná
 *         podle roku a tickeru.
 */
import { useEffect, useMemo, useState } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────
interface Transaction {
  date: string
  datetime: string
  ticker: string
  name: string
  type: 'buy' | 'sell'
  shares: number
  price: number
  total: number
  currency: 'EUR' | 'USD'
  profit_loss?: number
  position_id?: string
  source: string
}

interface TaxYear {
  used_czk: number
  limit_czk: number
  pct: number
  count: number
}

interface TransactionsData {
  generated_at: string
  czk_eur_rate: number
  czk_usd_rate: number
  transactions: Transaction[]
  tax_by_year: Record<string, TaxYear>
}

// ─── Fetch ──────────────────────────────────────────────────────────────────
const base = () => (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')

async function fetchTransactions(): Promise<TransactionsData | null> {
  try {
    const r = await fetch(`${base()}/transactions.json?t=${Date.now()}`)
    if (!r.ok) return null
    return await r.json() as TransactionsData
  } catch {
    return null
  }
}

// ─── Formatters ─────────────────────────────────────────────────────────────
function fmtCzk(v: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency', currency: 'CZK',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v)
}

function fmtMoney(v: number, cur: string) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency', currency: cur,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v)
}

function fmtShares(v: number) {
  return v % 1 === 0
    ? v.toLocaleString('cs-CZ')
    : v.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

// ─── CSS constants ───────────────────────────────────────────────────────────
const MUT  = 'var(--text-tertiary)'
const POS  = 'var(--positive)'
const NEG  = 'var(--negative)'
const WARN = '#f1c21b'

// ═══════════════════════════════════════════════════════════════════════════
// Tax Limit Progress Bar
// ═══════════════════════════════════════════════════════════════════════════
function TaxLimitBar({ tax, year }: { tax: Record<string, TaxYear>; year: string }) {
  const t = tax[year]
  if (!t) {
    return (
      <div style={{ padding: '16px 0', color: MUT, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        Žádné prodeje v roce {year}.
      </div>
    )
  }

  const over  = t.used_czk > t.limit_czk
  const pct   = Math.min(t.pct * 100, 100)
  const color = over ? NEG : t.pct > 0.8 ? WARN : POS

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Header row */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 8,
      }}>
        <div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: MUT, letterSpacing: '0.08em' }}>
            DAŇOVÝ LIMIT §4 ZDP · ROK {year}
          </span>
          {over && (
            <span style={{
              marginLeft: 10, fontSize: 10, color: NEG,
              background: 'rgba(255,80,80,0.12)', borderRadius: 3, padding: '2px 6px',
              fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
            }}>
              PŘEKROČEN
            </span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color }}>
          <span style={{ fontWeight: 700 }}>{fmtCzk(t.used_czk)}</span>
          <span style={{ color: MUT }}> / {fmtCzk(t.limit_czk)}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 8, borderRadius: 4, background: 'var(--surface-raised)',
        overflow: 'hidden', position: 'relative',
        border: '1px solid var(--line)',
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: color,
          borderRadius: 4,
          transition: 'width 0.4s ease',
        }} />
      </div>

      {/* Sub-label */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: 6,
        fontFamily: 'var(--font-mono)', fontSize: 11, color: MUT,
      }}>
        <span>
          {t.count} prodej{t.count === 1 ? '' : 'ů'} · {(t.pct * 100).toFixed(1)} % limitu
        </span>
        {!over && (
          <span style={{ color: POS }}>
            zbývá {fmtCzk(t.limit_czk - t.used_czk)}
          </span>
        )}
        {over && (
          <span style={{ color: NEG }}>
            přesah {fmtCzk(t.used_czk - t.limit_czk)} – nutno zdanit!
          </span>
        )}
      </div>

      {/* Footnote */}
      <p style={{ fontSize: 11, color: MUT, marginTop: 8, lineHeight: 1.5 }}>
        Osvobození příjmů z prodeje cenných papírů (§4 odst. 1 písm. w ZDP) do {fmtCzk(t.limit_czk)} ročně.
        Po překročení limitu se příjmy z prodeje zdaňují sazbou 15 % (nebo 23 % nad 36× průměrnou mzdu).
        Přepočet: EUR × {(t as any).czk_eur ?? '24,5'} / USD × {(t as any).czk_usd ?? '22,5'}.
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Transaction Table
// ═══════════════════════════════════════════════════════════════════════════
function TransactionTable({
  transactions,
  czkEur,
  czkUsd,
}: {
  transactions: Transaction[]
  czkEur: number
  czkUsd: number
}) {
  if (transactions.length === 0) {
    return (
      <p style={{ color: MUT, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        Žádné transakce pro tento filtr.
      </p>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        fontSize: 12, fontFamily: 'var(--font-mono)',
      }}>
        <thead>
          <tr style={{ color: MUT, textAlign: 'right' }}>
            <th style={{ textAlign: 'left',  padding: '4px 8px 4px 0', fontWeight: 400, letterSpacing: '0.06em' }}>Datum</th>
            <th style={{ textAlign: 'left',  padding: '4px 8px',       fontWeight: 400 }}>Ticker</th>
            <th style={{ textAlign: 'center',padding: '4px 8px',       fontWeight: 400 }}>Typ</th>
            <th style={{ padding: '4px 8px', fontWeight: 400 }}>Počet</th>
            <th style={{ padding: '4px 8px', fontWeight: 400 }}>Cena</th>
            <th style={{ padding: '4px 8px', fontWeight: 400 }}>Celkem</th>
            <th style={{ padding: '4px 8px', fontWeight: 400 }}>Celkem CZK</th>
            <th style={{ padding: '4px 8px', fontWeight: 400 }}>P/L</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t, i) => {
            const rate   = t.currency === 'EUR' ? czkEur : czkUsd
            const czk    = t.total * rate
            const isSell = t.type === 'sell'
            const pl     = t.profit_loss

            return (
              <tr
                key={`${t.datetime}-${t.ticker}-${i}`}
                style={{
                  borderTop: '1px solid var(--line)',
                  background: isSell ? 'rgba(255,80,80,0.03)' : undefined,
                }}
              >
                {/* Date */}
                <td style={{ padding: '5px 8px 5px 0', color: MUT }}>
                  {t.date}
                </td>

                {/* Ticker + name */}
                <td style={{ padding: '5px 8px' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                    {t.ticker}
                  </span>
                  {t.name && t.name !== t.ticker && (
                    <>
                      <br />
                      <span style={{ color: MUT, fontSize: 11 }}>{t.name}</span>
                    </>
                  )}
                </td>

                {/* Type badge */}
                <td style={{ textAlign: 'center', padding: '5px 8px' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                    color: isSell ? NEG : POS,
                    background: isSell ? 'rgba(255,80,80,0.1)' : 'rgba(66,190,101,0.1)',
                    padding: '2px 6px', borderRadius: 3,
                  }}>
                    {isSell ? 'PRODEJ' : 'NÁKUP'}
                  </span>
                </td>

                {/* Shares */}
                <td style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--text-secondary)' }}>
                  {fmtShares(t.shares)}
                </td>

                {/* Price */}
                <td style={{ textAlign: 'right', padding: '5px 8px', color: MUT }}>
                  {t.price > 0 ? fmtMoney(t.price, t.currency) : '—'}
                </td>

                {/* Total in original currency */}
                <td style={{ textAlign: 'right', padding: '5px 8px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {fmtMoney(t.total, t.currency)}
                </td>

                {/* Total in CZK */}
                <td style={{ textAlign: 'right', padding: '5px 8px', color: MUT }}>
                  {fmtCzk(czk)}
                </td>

                {/* P/L (sells only) */}
                <td style={{ textAlign: 'right', padding: '5px 8px' }}>
                  {pl != null ? (
                    <span style={{ color: pl >= 0 ? POS : NEG }}>
                      {pl >= 0 ? '+' : ''}{fmtMoney(pl, t.currency)}
                    </span>
                  ) : (
                    <span style={{ color: MUT }}>—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════════
export function TransactionsPage() {
  const [data, setData]       = useState<TransactionsData | null>(null)
  const [loading, setLoading] = useState(true)

  // Filters
  const currentYear = new Date().getFullYear().toString()
  const [year,       setYear]       = useState<string>(currentYear)
  const [ticker,     setTicker]     = useState<string>('VSE')
  const [typeFilter, setTypeFilter] = useState<'all' | 'buy' | 'sell'>('all')

  useEffect(() => {
    fetchTransactions().then(d => {
      setData(d)
      setLoading(false)
    })
  }, [])

  // Available years from tax_by_year union with transaction years
  const years = useMemo(() => {
    if (!data) return [currentYear]
    const all = new Set<string>()
    data.transactions.forEach(t => all.add(t.date.slice(0, 4)))
    Object.keys(data.tax_by_year).forEach(y => all.add(y))
    return Array.from(all).sort().reverse()
  }, [data])

  // Available tickers
  const tickers = useMemo(() => {
    if (!data) return []
    const t = new Set(data.transactions.map(t => t.ticker))
    return Array.from(t).sort()
  }, [data])

  // Filtered transactions
  const filtered = useMemo(() => {
    if (!data) return []
    return data.transactions.filter(t => {
      if (t.date.slice(0, 4) !== year) return false
      if (ticker !== 'VSE' && t.ticker !== ticker) return false
      if (typeFilter !== 'all' && t.type !== typeFilter) return false
      return true
    })
  }, [data, year, ticker, typeFilter])

  // Tax data with rates for footnote
  const taxWithRates = useMemo(() => {
    if (!data) return {}
    return Object.fromEntries(
      Object.entries(data.tax_by_year).map(([y, t]) => [
        y,
        { ...t, czk_eur: data.czk_eur_rate, czk_usd: data.czk_usd_rate },
      ])
    )
  }, [data])

  if (loading) {
    return (
      <main style={{ padding: 32, textAlign: 'center', color: MUT, fontFamily: 'var(--font-mono)' }}>
        Načítám transakce…
      </main>
    )
  }

  if (!data) {
    return (
      <main className="app__main">
        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Historie transakcí</h2>
            <span className="panel__subtitle">transactions.json není k dispozici</span>
          </div>
          <p style={{ color: WARN, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            Spusť <code>python tools/generate_transactions.py *.xlsx</code> a zkopíruj výstup do{' '}
            <code>frontend/public/transactions.json</code>.
          </p>
        </section>
      </main>
    )
  }

  const sellsThisYear = filtered.filter(t => t.type === 'sell').length
  const buysThisYear  = filtered.filter(t => t.type === 'buy').length

  return (
    <main className="app__main">
      {/* ── Tax limit panel ────────────────────────────────────── */}
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Daňový limit prodejů</h2>
          <span className="panel__subtitle">
            §4 ZDP · 100 000 CZK ročně · přepočet @{data.czk_eur_rate} CZK/EUR
          </span>
        </div>

        {/* Year selector for tax bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
          {years.map(y => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className="segmented__option"
              style={{
                padding: '4px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                background: year === y ? 'var(--accent)' : 'var(--surface-raised)',
                color: year === y ? '#fff' : 'var(--text-secondary)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {y}
            </button>
          ))}
        </div>

        <TaxLimitBar tax={taxWithRates} year={year} />
      </section>

      {/* ── Transaction history ────────────────────────────────── */}
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Historie transakcí</h2>
          <span className="panel__subtitle">
            {year} · {buysThisYear} nákupů · {sellsThisYear} prodejů
          </span>
        </div>

        {/* Filters */}
        <div style={{
          display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center',
        }}>
          {/* Type filter */}
          <div style={{ display: 'flex', gap: 0, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--line)' }}>
            {(['all', 'buy', 'sell'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                style={{
                  padding: '4px 12px',
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                  background: typeFilter === t ? 'var(--surface-raised)' : 'transparent',
                  color: typeFilter === t ? 'var(--text-primary)' : MUT,
                  border: 'none', borderRight: t !== 'sell' ? '1px solid var(--line)' : 'none',
                  cursor: 'pointer',
                  fontWeight: typeFilter === t ? 700 : 400,
                }}
              >
                {t === 'all' ? 'Vše' : t === 'buy' ? 'Nákupy' : 'Prodeje'}
              </button>
            ))}
          </div>

          {/* Ticker filter */}
          <select
            value={ticker}
            onChange={e => setTicker(e.target.value)}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11,
              background: 'var(--surface-raised)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--line)', borderRadius: 4,
              padding: '4px 8px', cursor: 'pointer',
            }}
          >
            <option value="VSE">Všechny tickery</option>
            {tickers.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: MUT, marginLeft: 'auto' }}>
            {filtered.length} záznamů
          </span>
        </div>

        <TransactionTable
          transactions={filtered}
          czkEur={data.czk_eur_rate}
          czkUsd={data.czk_usd_rate}
        />

        <p style={{ color: MUT, fontSize: 11, marginTop: 12 }}>
          Data z XTB XLSX exportů · generováno {new Date(data.generated_at).toLocaleString('cs-CZ')} ·
          Přepočet na CZK je orientační (pevný kurz).
        </p>
      </section>
    </main>
  )
}
