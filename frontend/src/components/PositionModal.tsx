/**
 * PositionModal — detail otevřené pozice.
 * Zobrazuje sparkline graf s vyznačenými nákupy, seznam lotů a daňový test.
 */
import { useEffect, useRef } from 'react'
import { createChart, LineSeries, LineStyle } from 'lightweight-charts'
import { formatQuantity, signClass } from '../lib/format'
import type { Holding } from '../lib/types'
import { chartTheme } from '../charts/theme'

interface Props {
  holding: Holding
  onClose: () => void
}

// Česká daňová svoboda: po 3 letech od nákupu
function taxFreeDate(dateStr: string): Date {
  const d = new Date(dateStr)
  d.setFullYear(d.getFullYear() + 3)
  return d
}

function taxStatus(dateStr: string): { free: boolean; freeDate: string } {
  const freeDate = taxFreeDate(dateStr)
  const now = new Date()
  return {
    free: now >= freeDate,
    freeDate: freeDate.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' }),
  }
}

export function PositionModal({ holding, onClose }: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  const theme = chartTheme()
  const symbol = holding.currency === 'USD' ? '$' : '€'
  const pctNative = holding.cost_basis_native > 0
    ? (holding.price_native - holding.cost_basis_native) / holding.cost_basis_native
    : (holding.unrealized_pnl_pct ?? 0)

  // Sparkline chart s nákupy
  useEffect(() => {
    if (!chartRef.current || !holding.sparkline?.length) return
    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: 180,
      layout: { background: { color: 'transparent' }, textColor: theme.textSecondary },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderColor: theme.axis, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: theme.axis, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 1 },
    })

    const series = chart.addSeries(LineSeries, {
      color: theme.accent,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    })

    // Sparkline data — posledních 90 obchodních dní od dnes zpětně
    const today = new Date()
    const data = holding.sparkline.map((value, i) => {
      const d = new Date(today)
      d.setDate(d.getDate() - (holding.sparkline.length - 1 - i) * 1.4)
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return { time: `${year}-${month}-${day}` as const, value }
    })
    series.setData(data)

    // Vyznač nákupy jako vertikální čáry (posledních 90 dní)
    const cutoff = new Date(today)
    cutoff.setDate(cutoff.getDate() - 130)
    holding.lots?.forEach(lot => {
      const lotDate = new Date(lot.date)
      if (lotDate >= cutoff) {
        series.createPriceLine({
          price: lot.price,
          color: '#f1c21b',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${lot.quantity.toFixed(2)}ks`,
        })
      }
    })

    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [holding])

  // Daňový souhrn
  const freeLots = holding.lots?.filter(l => taxFreeDate(l.date) <= new Date()) ?? []
  const lockedLots = holding.lots?.filter(l => taxFreeDate(l.date) > new Date()) ?? []
  const freeQty = freeLots.reduce((s, l) => s + l.quantity, 0)
  const lockedQty = lockedLots.reduce((s, l) => s + l.quantity, 0)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.7)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface-panel)', border: '1px solid var(--line)',
          width: 'min(720px, 95vw)', maxHeight: '90vh', overflowY: 'auto',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <span style={{ fontSize: 18, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{holding.ticker}</span>
            <span style={{ marginLeft: 10, color: 'var(--text-secondary)', fontSize: 13 }}>{holding.name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500 }}>
              {symbol}{holding.price_native.toFixed(2)}
            </span>
            <span className={`num ${signClass(pctNative)}`} style={{ fontSize: 14 }}>
              {(pctNative ?? 0) >= 0 ? '+' : ''}{((pctNative ?? 0) * 100).toFixed(2)}%
            </span>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--line)', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px 10px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              ✕ Zavřít
            </button>
          </div>
        </div>

        {/* Sparkline chart */}
        <div style={{ padding: '14px 20px 0', borderBottom: '1px solid var(--line-faint)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 6, letterSpacing: '0.1em' }}>
            CENA · 90D · žluté čáry = nákupy
          </div>
          <div ref={chartRef} style={{ width: '100%' }} />
        </div>

        {/* Daňový test */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', background: 'var(--surface-raised)', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.12em', width: '100%', marginBottom: 4 }}>DAŇOVÝ TEST — osvobození po 3 letech (§4 ZDP)</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--positive)' }}>
              {freeQty > 0 ? `${formatQuantity(freeQty)} ks` : '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>daňově volné</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 500, fontFamily: 'var(--font-mono)', color: lockedQty > 0 ? 'var(--warning)' : 'var(--text-tertiary)' }}>
              {lockedQty > 0 ? `${formatQuantity(lockedQty)} ks` : '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>ještě zamčeno</div>
          </div>
          {lockedLots.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--warning)' }}>
                {taxStatus(lockedLots.sort((a,b) => a.date.localeCompare(b.date))[0].date).freeDate}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>nejbližší uvolnění</div>
            </div>
          )}
        </div>

        {/* Tabulka lotů */}
        <div style={{ padding: '12px 20px 20px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.12em', marginBottom: 8 }}>INDIVIDUÁLNÍ NÁKUPY</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                {['Datum', 'Počet', 'Nákupní cena', 'Hodnota', 'Daňový stav'].map(h => (
                  <th key={h} style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--text-tertiary)', fontWeight: 400, fontSize: 10, letterSpacing: '0.1em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(holding.lots ?? []).map((lot, i) => {
                const status = taxStatus(lot.date)
                const currentValue = lot.quantity * holding.price_native
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line-faint)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', textAlign: 'right' }}>{lot.date}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatQuantity(lot.quantity)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{symbol}{lot.price.toFixed(2)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{symbol}{currentValue.toFixed(2)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      {status.free
                        ? <span style={{ color: 'var(--positive)' }}>✓ Volné</span>
                        : <span style={{ color: 'var(--warning)' }}>🔒 {status.freeDate}</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
