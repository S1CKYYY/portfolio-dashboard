/**
 * EtfHoldingsPanel  –  zobrazí top holdings pro každé ETF v portfoliu
 * Data se nacitaji z /data/etf_holdings.json (stejny soubor jako InsightsPage)
 */
import { useEffect, useState } from 'react'
import type { EtfHoldingsMap } from '../lib/insights-types'

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

// ETFs v portfoliu s jejich displayovym nazvem
const ETF_ORDER = ['VUAA.DE', 'VWCE.DE', 'ZPRV.L', 'IS3N.DE', 'XNAS.DE', '4GLD.DE']
const ETF_SHORT: Record<string, string> = {
  'VUAA.DE': 'VUAA',
  'VWCE.DE': 'VWCE',
  'ZPRV.L':  'ZPRV',
  'IS3N.DE': 'IS3N',
  'XNAS.DE': 'XNAS',
  '4GLD.DE': '4GLD',
}

const MUT = 'var(--text-tertiary)'
const POS = 'var(--positive)'

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`
}

interface EtfCardProps {
  ticker: string
  data: EtfHoldingsMap[string]
  isActive: boolean
  onSelect: () => void
}

function EtfCard({ ticker, data, isActive, onSelect }: EtfCardProps) {
  const short = ETF_SHORT[ticker] ?? ticker
  const top = data.holdings.slice(0, 10)
  const maxWeight = top[0]?.weight ?? 0.01

  return (
    <div
      onClick={onSelect}
      style={{
        cursor: 'pointer',
        border: `1px solid ${isActive ? 'var(--accent)' : 'var(--line)'}`,
        borderRadius: 4,
        padding: '10px 14px',
        background: isActive ? 'rgba(0,255,136,0.04)' : 'var(--surface-raised)',
        transition: 'all 0.15s',
        minWidth: 110,
        flexShrink: 0,
      }}
    >
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: isActive ? POS : 'var(--text-primary)', letterSpacing: '0.04em' }}>
        {short}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: MUT, marginTop: 2, lineHeight: 1.3 }}>
        {Math.round(data.coverage_pct * 100)}% pokryto
      </div>
    </div>
  )
}

export function EtfHoldingsPanel() {
  const [etfMap, setEtfMap] = useState<EtfHoldingsMap | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>(ETF_ORDER[0])

  useEffect(() => {
    fetchJson<EtfHoldingsMap>('/data/etf_holdings.json').then(data => {
      setEtfMap(data)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">ETF Složení</h2>
        </div>
        <p style={{ color: MUT, fontSize: 12, fontFamily: 'var(--font-mono)' }}>Načítám…</p>
      </section>
    )
  }

  if (!etfMap) {
    return (
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">ETF Složení</h2>
          <span className="panel__subtitle">data/etf_holdings.json není dostupný</span>
        </div>
      </section>
    )
  }

  // Only show ETFs that exist in the data
  const availableEtfs = ETF_ORDER.filter(t => etfMap[t])
  if (availableEtfs.length === 0) return null

  // Ensure selected is valid
  const activeKey = availableEtfs.includes(selected) ? selected : availableEtfs[0]
  const activeData = etfMap[activeKey]
  const top10 = activeData.holdings.slice(0, 10)
  const maxWeight = top10[0]?.weight ?? 0.01
  const top10sum = top10.reduce((s, h) => s + h.weight, 0)

  return (
    <section className="panel">
      <div className="panel__header">
        <h2 className="panel__title">ETF Složení</h2>
        <span className="panel__subtitle">
          Top 10 holdings · data manuálně aktualizována čtvrtletně
        </span>
      </div>

      {/* ETF tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {availableEtfs.map(t => (
          <EtfCard
            key={t}
            ticker={t}
            data={etfMap[t]}
            isActive={t === activeKey}
            onSelect={() => setSelected(t)}
          />
        ))}
      </div>

      {/* Active ETF name + coverage */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
          {activeData.name}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, color: MUT,
          background: 'var(--surface-raised)', border: '1px solid var(--line)',
          borderRadius: 3, padding: '2px 8px',
        }}>
          Top 10 = {pct(top10sum)} fondu · {Math.round(activeData.coverage_pct * 100)}% pokryto
        </span>
      </div>

      {activeData.holdings.length === 0 ? (
        <p style={{ color: MUT, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          {activeKey === '4GLD.DE'
            ? 'Fyzické zlato – žádné akciové holdingy.'
            : 'Data holdings nejsou dostupná.'}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            <thead>
              <tr style={{ color: MUT }}>
                <th style={{ textAlign: 'left', padding: '4px 8px 4px 0', fontWeight: 400, width: 28 }}>#</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>Ticker</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>Název</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>Váha</th>
                <th style={{ padding: '4px 8px', fontWeight: 400, width: '35%' }}></th>
              </tr>
            </thead>
            <tbody>
              {top10.map((h, i) => (
                <tr
                  key={h.ticker}
                  style={{ borderTop: '1px solid var(--line)' }}
                >
                  <td style={{ padding: '5px 8px 5px 0', color: MUT }}>{i + 1}</td>
                  <td style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                    {h.ticker}
                  </td>
                  <td style={{ padding: '5px 8px', color: 'var(--text-secondary)' }}>
                    {h.name}
                  </td>
                  <td style={{ textAlign: 'right', padding: '5px 8px', color: POS, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {pct(h.weight)}
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    <div style={{ height: 10, borderRadius: 2, overflow: 'hidden', background: 'var(--surface)' }}>
                      <div style={{
                        height: '100%',
                        width: `${(h.weight / maxWeight) * 100}%`,
                        background: POS,
                        opacity: 0.75,
                        borderRadius: 2,
                      }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
