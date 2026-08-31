/**
 * PositionModal — detail pozice: graf, nákupy, daňový test.
 */
import { useEffect, useRef } from 'react'
import { createChart, LineSeries, type Time } from 'lightweight-charts'
import { formatQuantity, signClass } from '../lib/format'
import type { Holding } from '../lib/types'
import { chartTheme } from '../charts/theme'

interface Props {
  holding: Holding
  onClose: () => void
}

function taxFreeDate(dateStr: string): Date {
  const d = new Date(dateStr)
  d.setFullYear(d.getFullYear() + 3)
  return d
}

function freeStr(dateStr: string): string {
  return taxFreeDate(dateStr).toLocaleDateString('cs-CZ')
}

function isFree(dateStr: string): boolean {
  return taxFreeDate(dateStr) <= new Date()
}

// Vygeneruj obchodní dny zpětně od dnešního dne
function tradingDates(count: number): string[] {
  const dates: string[] = []
  const d = new Date()
  while (dates.length < count) {
    const day = d.getDay()
    if (day !== 0 && day !== 6) {
      dates.unshift(d.toISOString().slice(0, 10))
    }
    d.setDate(d.getDate() - 1)
  }
  return dates
}

export function PositionModal({ holding, onClose }: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  const theme = chartTheme()
  const symbol = holding.currency === 'USD' ? '$' : '€'
  const pctNative = holding.cost_basis_native > 0
    ? (holding.price_native - holding.cost_basis_native) / holding.cost_basis_native
    : (holding.unrealized_pnl_pct ?? 0)

  const lots = holding.lots ?? []
  const freeLots = lots.filter(l => isFree(l.date))
  const lockedLots = lots.filter(l => !isFree(l.date))
  const freeQty = freeLots.reduce((s, l) => s + l.quantity, 0)
  const lockedQty = lockedLots.reduce((s, l) => s + l.quantity, 0)
  const nextFree = lockedLots.sort((a, b) => a.date.localeCompare(b.date))[0]

  // Vygeneruj přibližné obchodní dny pro sparkline
  const dates90 = tradingDates(holding.sparkline?.length ?? 90)

  useEffect(() => {
    if (!chartRef.current) return
    const el = chartRef.current
    const chart = createChart(el, {
      width: el.clientWidth || 660,
      height: 260,
      layout: {
        background: { color: 'transparent' },
        textColor: theme.textSecondary,
        fontFamily: theme.fontMono,
      },
      grid: {
        vertLines: { color: theme.grid },
        horzLines: { color: theme.grid },
      },
      rightPriceScale: {
        borderColor: theme.axis,
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      timeScale: {
        borderColor: theme.axis,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: { mode: 1 },
    })

    const series = chart.addSeries(LineSeries, {
      color: theme.accent,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    })

    // Nastav sparkline data
    if (holding.sparkline?.length) {
      const data = holding.sparkline.map((value, i) => ({
        time: dates90[i] as Time,
        value,
      }))
      series.setData(data)

      // Přidej nákupy jako price lines (žluté horizontální čáry s popiskem)
      lots
        .filter(lot => lot.date >= dates90[0])
        .forEach(lot => {
          series.createPriceLine({
            price: lot.price,
            color: '#f1c21b',
            lineWidth: 1,
            lineStyle: 3, // dashed
            axisLabelVisible: true,
            title: `${lot.quantity.toFixed(2)} ks`,
          })
        })

      chart.timeScale().fitContent()
    }

    const resize = () => {
      chart.applyOptions({ width: el.clientWidth })
    }
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      chart.remove()
    }
  }, [holding])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface-panel)',
          border: '1px solid var(--line-strong)',
          width: 'min(860px, 96vw)',
          maxHeight: '92vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 24px', borderBottom: '1px solid var(--line)',
          background: 'var(--surface-raised)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 22, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
              {holding.ticker}
            </span>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{holding.name}</span>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', background: 'var(--surface-active)', padding: '2px 8px' }}>
              {holding.asset_class}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
                {symbol}{holding.price_native.toFixed(2)}
              </div>
              <div className={signClass(pctNative)} style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                {pctNative >= 0 ? '+' : ''}{(pctNative * 100).toFixed(2)}% nativní P&L
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'var(--surface-active)', border: '1px solid var(--line)',
                color: 'var(--text-secondary)', cursor: 'pointer',
                padding: '6px 14px', fontFamily: 'var(--font-mono)', fontSize: 12,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Graf ── */}
        <div style={{ padding: '16px 24px 0', borderBottom: '1px solid var(--line-faint)' }}>
          <div style={{ fontSize: 9, color: 'var(--text-tertiary)', letterSpacing: '0.15em', marginBottom: 8 }}>
            CENA · POSLEDNÍCH 90 OBCHODNÍCH DNÍ · žluté šipky = nákupy
          </div>
          <div ref={chartRef} style={{ width: '100%' }} />
          <div style={{ fontSize: 10, color: 'var(--text-disabled)', padding: '6px 0 12px' }}>
            {lots.filter(l => l.date >= dates90[0]).length === 0 && lots.length > 0
              ? '⚠ Žádné nákupy v posledních 90 dnech — starší nákupy jsou v tabulce níže'
              : ''}
          </div>
        </div>

        {/* ── Daňový test ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 1, background: 'var(--line)', borderBottom: '1px solid var(--line)',
        }}>
          {[
            {
              label: 'DAŇOVĚ VOLNÉ',
              value: freeQty > 0 ? `${formatQuantity(freeQty)} ks` : '—',
              sub: `${freeLots.length} lot${freeLots.length !== 1 ? 'y/ů' : ''}`,
              color: freeQty > 0 ? 'var(--positive)' : 'var(--text-tertiary)',
            },
            {
              label: 'JEŠTĚ ZAMČENO',
              value: lockedQty > 0 ? `${formatQuantity(lockedQty)} ks` : '—',
              sub: `${lockedLots.length} lot${lockedLots.length !== 1 ? 'y/ů' : ''}`,
              color: lockedQty > 0 ? 'var(--warning)' : 'var(--text-tertiary)',
            },
            {
              label: 'NEJBLIŽŠÍ UVOLNĚNÍ',
              value: nextFree ? freeStr(nextFree.date) : '—',
              sub: nextFree ? `${formatQuantity(nextFree.quantity)} ks` : 'vše volné',
              color: nextFree ? 'var(--warning)' : 'var(--text-tertiary)',
            },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--surface-raised)', padding: '14px 20px' }}>
              <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-tertiary)', marginBottom: 6 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 500, fontFamily: 'var(--font-mono)', color: item.color }}>
                {item.value}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{item.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Tabulka lotů ── */}
        <div style={{ padding: '16px 24px 24px' }}>
          <div style={{ fontSize: 9, color: 'var(--text-tertiary)', letterSpacing: '0.15em', marginBottom: 10 }}>
            VŠECHNY NÁKUPY · {lots.length} lot{lots.length !== 1 ? 'y/ů' : ''}
          </div>
          {lots.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '12px 0' }}>
              Loty budou dostupné po příštím workflow runu (aktualizace cen).
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Datum nákupu', 'Počet', 'Nákupní cena', 'Aktuální hodnota', 'P&L', 'Daňový stav'].map(h => (
                    <th key={h} style={{ textAlign: 'right', padding: '6px 10px', color: 'var(--text-tertiary)', fontWeight: 400, fontSize: 10, letterSpacing: '0.08em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lots.map((lot, i) => {
                  const free = isFree(lot.date)
                  const currentVal = lot.quantity * holding.price_native
                  const costVal = lot.quantity * lot.price
                  const pnl = currentVal - costVal
                  const pnlPct = costVal > 0 ? pnl / costVal : 0
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line-faint)' }}>
                      <td style={{ padding: '8px 10px', color: 'var(--text-secondary)', textAlign: 'right' }}>
                        {lot.date}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                        {formatQuantity(lot.quantity)}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {symbol}{lot.price.toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                        {symbol}{currentVal.toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}
                          className={signClass(pnl)}>
                        {pnlPct >= 0 ? '+' : ''}{(pnlPct * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                        {free
                          ? <span style={{ color: 'var(--positive)' }}>✓ Volné</span>
                          : <span style={{ color: 'var(--warning)' }}>🔒 {freeStr(lot.date)}</span>
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
