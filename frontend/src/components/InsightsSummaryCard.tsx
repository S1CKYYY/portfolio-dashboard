/**
 * InsightsSummaryCard  –  mini preview Insights dat na hlavni strance.
 * Ukazuje nejblizsi earnings + top insider nakupy.
 * Klik na "Analyza →" prepne na insights stranku.
 */
import { useEffect, useState } from 'react'
import type { InsightsData } from '../lib/insights-types'

const base = () => (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')

interface Props {
  onNavigate: (p: 'analysis') => void
}

export function InsightsSummaryCard({ onNavigate }: Props) {
  const [data, setData] = useState<InsightsData | null>(null)

  useEffect(() => {
    fetch(`${base()}/insights.json?t=${Date.now()}`)
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => {})
  }, [])

  // Pokazat jen kdyz je co zobrazit
  if (!data) return null

  const upcomingEarnings = data.earnings
    .filter(e => e.days_until >= 0 && e.days_until <= 30)
    .slice(0, 3)

  const netBuys = data.insider
    .filter(s => s.net_value_usd > 0 && s.buy_count > 0)
    .slice(0, 3)

  if (upcomingEarnings.length === 0 && netBuys.length === 0) return null

  const POS  = 'var(--positive)'
  const MUT  = 'var(--text-tertiary)'
  const WARN = '#f1c21b'

  return (
    <section className="panel" style={{ padding: '14px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 className="panel__title" style={{ margin: 0 }}>Insights</h2>
        <button
          type="button"
          onClick={() => onNavigate('analysis')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: POS, fontFamily: 'var(--font-mono)',
            fontSize: 11, letterSpacing: '0.08em', padding: 0,
          }}
        >
          Vse v Analyze &rarr;
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Earnings */}
        {upcomingEarnings.length > 0 && (
          <div>
            <div style={{ color: MUT, fontSize: 10, letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
              EARNINGS
            </div>
            {upcomingEarnings.map(ev => (
              <div key={`${ev.ticker}-${ev.date}`} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                marginBottom: 6,
              }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: ev.days_until <= 7 ? WARN : 'var(--text-primary)' }}>
                  {ev.ticker}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: ev.days_until <= 7 ? WARN : MUT }}>
                  {ev.days_until === 0 ? 'dnes' : ev.days_until === 1 ? 'zitra' : `za ${ev.days_until}d`}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Insider buys */}
        {netBuys.length > 0 && (
          <div>
            <div style={{ color: MUT, fontSize: 10, letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
              INSIDER NAKUPY
            </div>
            {netBuys.map(s => {
              const val = Math.abs(s.net_value_usd)
              const valStr = val >= 1_000_000
                ? `$${(val / 1_000_000).toFixed(1)}M`
                : `$${(val / 1_000).toFixed(0)}k`
              return (
                <div key={s.ticker} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  marginBottom: 6,
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {s.ticker}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: POS }}>
                    +{valStr}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {data.finnhub_fetched_at && (
        <div style={{ marginTop: 10, color: MUT, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
          {new Date(data.finnhub_fetched_at).toLocaleDateString('cs-CZ')}
        </div>
      )}
    </section>
  )
}
