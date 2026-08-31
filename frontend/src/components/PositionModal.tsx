/**
 * PositionModal — detail pozice s grafem, nákupy, daňovým testem.
 * Graf: kompletní historická data od prvního nákupu.
 * Nákupy: vertikální žluté čáry přes SVG overlay.
 * Hodnoty: v CZK (nebo EUR dle nastavení).
 */
import { useEffect, useRef, useCallback } from 'react'
import { createChart, LineSeries, type IChartApi, type Time } from 'lightweight-charts'
import { formatQuantity, signClass } from '../lib/format'
import type { Holding } from '../lib/types'
import { chartTheme } from '../charts/theme'
import { useCurrency } from '../lib/currency'

interface Props {
  holding: Holding
  onClose: () => void
}

function taxFreeDate(dateStr: string): Date {
  const d = new Date(dateStr); d.setFullYear(d.getFullYear() + 3); return d
}
function freeStr(dateStr: string) {
  return taxFreeDate(dateStr).toLocaleDateString('cs-CZ')
}
function isFree(dateStr: string) {
  return taxFreeDate(dateStr) <= new Date()
}

export function PositionModal({ holding, onClose }: Props) {
  const { multiplier, displayCurrency } = useCurrency()
  const chartRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const chartInstance = useRef<IChartApi | null>(null)
  const theme = chartTheme()

  const nativeSym = holding.currency === 'USD' ? '$' : '€'
  const lots = holding.lots ?? []
  const freeLots = lots.filter(l => isFree(l.date))
  const lockedLots = lots.filter(l => !isFree(l.date))
  const freeQty = freeLots.reduce((s, l) => s + l.quantity, 0)
  const lockedQty = lockedLots.reduce((s, l) => s + l.quantity, 0)
  const nextFree = [...lockedLots].sort((a, b) => a.date.localeCompare(b.date))[0]

  // CZK konverze pro lot hodnoty
  // Pro USD: odvod EURUSD z aktuálních dat holdingy
  const eurUsd = holding.currency === 'USD' && holding.price_base > 0
    ? holding.price_native / holding.price_base
    : 1
  const toCzk = (nativeAmount: number) =>
    holding.currency === 'USD'
      ? nativeAmount / eurUsd * multiplier
      : nativeAmount * multiplier

  const avgCost = holding.cost_basis_native
  const pctNative = avgCost > 0
    ? (holding.price_native - avgCost) / avgCost
    : (holding.unrealized_pnl_pct ?? 0)

  // Vykresli SVG vertikální čáry pro nákupy
  const drawLines = useCallback(() => {
    if (!svgRef.current || !chartInstance.current || !chartRef.current) return
    const svg = svgRef.current
    const h = chartRef.current.clientHeight
    const w = chartRef.current.clientWidth
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    svg.setAttribute('width', String(w))
    svg.setAttribute('height', String(h))
    while (svg.firstChild) svg.removeChild(svg.firstChild)

    const ts = chartInstance.current.timeScale()
    lots.forEach(lot => {
      const x = ts.timeToCoordinate(lot.date as Time)
      if (x === null || x < 0 || x > w) return

      // Vertikální čára
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x))
      line.setAttribute('y1', '0'); line.setAttribute('y2', String(h))
      line.setAttribute('stroke', '#f1c21b'); line.setAttribute('stroke-width', '1.5')
      line.setAttribute('stroke-dasharray', '4,3'); line.setAttribute('opacity', '0.8')
      svg.appendChild(line)

      // Popisek (nativní cena)
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      label.setAttribute('x', String(x + 4)); label.setAttribute('y', '18')
      label.setAttribute('fill', '#f1c21b'); label.setAttribute('font-size', '9')
      label.setAttribute('font-family', 'IBM Plex Mono, monospace')
      label.textContent = `${nativeSym}${lot.price.toFixed(0)}`
      svg.appendChild(label)
    })
  }, [lots, nativeSym])

  // Vytvoř graf
  useEffect(() => {
    if (!chartRef.current) return
    const el = chartRef.current

    const chart = createChart(el, {
      width: el.clientWidth || 820,
      height: 280,
      layout: { background: { color: 'transparent' }, textColor: theme.textSecondary, fontFamily: theme.fontMono },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderColor: theme.axis, scaleMargins: { top: 0.1, bottom: 0.08 } },
      timeScale: { borderColor: theme.axis, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 1 },
    })
    chartInstance.current = chart

    const series = chart.addSeries(LineSeries, {
      color: theme.accent, lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true,
    })

    // Použij price_history nebo sparkline
    const history = holding.price_history
    if (history && history.length > 0) {
      series.setData(history.map(p => ({ time: p.time as Time, value: p.value })))
    } else if (holding.sparkline?.length) {
      // Fallback: sparkline s přibližnými daty
      const today = new Date()
      const data = holding.sparkline.map((value, i) => {
        const d = new Date(today)
        let days = (holding.sparkline.length - 1 - i) * 1.4
        d.setDate(d.getDate() - Math.round(days))
        return { time: d.toISOString().slice(0, 10) as Time, value }
      })
      series.setData(data)
    }

    chart.timeScale().fitContent()

    // Čáry po načtení grafu
    setTimeout(drawLines, 100)

    // Subscribe na zoom/scroll
    chart.timeScale().subscribeVisibleTimeRangeChange(drawLines)

    const resize = () => {
      chart.applyOptions({ width: el.clientWidth })
      setTimeout(drawLines, 50)
    }
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      chart.remove()
      chartInstance.current = null
    }
  }, [holding])

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--surface-panel)', border: '1px solid var(--line-strong)', width: 'min(920px, 97vw)', maxHeight: '94vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--line)', background: 'var(--surface-raised)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 22, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{holding.ticker}</span>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{holding.name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
                {nativeSym}{holding.price_native.toFixed(2)}
              </div>
              <div className={signClass(pctNative)} style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                {pctNative >= 0 ? '+' : ''}{(pctNative * 100).toFixed(2)}%
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'var(--surface-active)', border: '1px solid var(--line)', color: 'var(--text-secondary)', cursor: 'pointer', padding: '6px 14px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>✕</button>
          </div>
        </div>

        {/* Průměrná nákupní cena + rychlý přehled */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--line)', borderBottom: '1px solid var(--line)' }}>
          {[
            { label: 'PRŮM. NÁKUP', value: `${nativeSym}${avgCost.toFixed(2)}`, sub: `≈ ${Math.round(toCzk(avgCost)).toLocaleString('cs-CZ')} ${displayCurrency}` },
            { label: 'AKTUÁLNÍ CENA', value: `${nativeSym}${holding.price_native.toFixed(2)}`, sub: `≈ ${Math.round(toCzk(holding.price_native)).toLocaleString('cs-CZ')} ${displayCurrency}` },
            { label: 'POČET KUSŮ', value: `${formatQuantity(holding.quantity)} ks`, sub: `${lots.length} nákupů` },
            { label: 'CELKOVÁ HODNOTA', value: `${Math.round(toCzk(holding.price_native * holding.quantity)).toLocaleString('cs-CZ')}`, sub: displayCurrency },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--surface-panel)', padding: '12px 18px' }}>
              <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 17, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{item.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{item.sub}</div>
            </div>
          ))}
        </div>

        {/* Graf */}
        <div style={{ padding: '16px 24px 0', borderBottom: '1px solid var(--line-faint)' }}>
          <div style={{ fontSize: 9, color: 'var(--text-tertiary)', letterSpacing: '0.14em', marginBottom: 8 }}>
            HISTORICKÁ CENA · žluté čáry = nákupy (nativní cena v {nativeSym})
          </div>
          <div style={{ position: 'relative' }}>
            <div ref={chartRef} style={{ width: '100%' }} />
            <svg
              ref={svgRef}
              style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}
            />
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-disabled)', padding: '6px 0 10px' }}>
            {!holding.price_history && '⚠ Delší historie bude k dispozici po příštím workflow runu'}
          </div>
        </div>

        {/* Daňový test */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--line)', borderBottom: '1px solid var(--line)' }}>
          {[
            { label: 'DAŇOVĚ VOLNÉ (§4 ZDP)', value: freeQty > 0 ? `${formatQuantity(freeQty)} ks` : '—', sub: `${freeLots.length} lot${freeLots.length !== 1 ? 'y/ů' : ''}`, color: freeQty > 0 ? 'var(--positive)' : 'var(--text-tertiary)' },
            { label: 'JEŠTĚ ZAMČENO', value: lockedQty > 0 ? `${formatQuantity(lockedQty)} ks` : '—', sub: `${lockedLots.length} lot${lockedLots.length !== 1 ? 'y/ů' : ''}`, color: lockedQty > 0 ? 'var(--warning)' : 'var(--text-tertiary)' },
            { label: 'NEJBLIŽŠÍ UVOLNĚNÍ', value: nextFree ? freeStr(nextFree.date) : '—', sub: nextFree ? `${formatQuantity(nextFree.quantity)} ks` : 'vše volné', color: nextFree ? 'var(--warning)' : 'var(--text-tertiary)' },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--surface-raised)', padding: '14px 20px' }}>
              <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontSize: 20, fontWeight: 500, fontFamily: 'var(--font-mono)', color: item.color }}>{item.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{item.sub}</div>
            </div>
          ))}
        </div>

        {/* Tabulka lotů */}
        <div style={{ padding: '16px 24px 24px' }}>
          <div style={{ fontSize: 9, color: 'var(--text-tertiary)', letterSpacing: '0.14em', marginBottom: 10 }}>
            INDIVIDUÁLNÍ NÁKUPY
          </div>
          {lots.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '12px 0' }}>
              Nákupy budou dostupné po příštím workflow runu.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Datum', 'Počet', `Cena (${nativeSym})`, `Zaplaceno (${displayCurrency})`, 'P&L %', 'Dnes (${displayCurrency})', 'Daň'].map(h => (
                    <th key={h} style={{ textAlign: 'right', padding: '6px 10px', color: 'var(--text-tertiary)', fontWeight: 400, fontSize: 10, letterSpacing: '0.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lots.map((lot, i) => {
                  const free = isFree(lot.date)
                  const costCzk = toCzk(lot.price * lot.quantity)
                  const valueCzk = toCzk(lot.quantity * holding.price_native)
                  const pnl = (holding.price_native - lot.price) / lot.price
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line-faint)' }}>
                      <td style={{ padding: '7px 10px', color: 'var(--text-secondary)', textAlign: 'right' }}>{lot.date}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{formatQuantity(lot.quantity)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>{nativeSym}{lot.price.toFixed(2)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{Math.round(costCzk).toLocaleString('cs-CZ')}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }} className={signClass(pnl)}>
                        {pnl >= 0 ? '+' : ''}{(pnl * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{Math.round(valueCzk).toLocaleString('cs-CZ')}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                        {free
                          ? <span style={{ color: 'var(--positive)' }}>✓ Volné</span>
                          : <span style={{ color: 'var(--warning)', fontSize: 11 }}>🔒 {freeStr(lot.date)}</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
