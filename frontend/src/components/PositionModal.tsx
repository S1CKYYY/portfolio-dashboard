import { useEffect, useRef, useState } from 'react'
import { createChart, LineSeries, type Time, type IChartApi } from 'lightweight-charts'
import { formatQuantity, signClass } from '../lib/format'
import type { Holding, Lot } from '../lib/types'
import { chartTheme } from '../charts/theme'
import { useCurrency } from '../lib/currency'

interface Props { holding: Holding; onClose: () => void }

const CHART_H = 300

function taxFreeDate(d: string) { const dt = new Date(d); dt.setFullYear(dt.getFullYear() + 3); return dt }
function freeStr(d: string) { return taxFreeDate(d).toLocaleDateString('cs-CZ') }
function isFree(d: string) { return taxFreeDate(d) <= new Date() }

export function PositionModal({ holding, onClose }: Props) {
  const { multiplier, displayCurrency } = useCurrency()
  const chartRef  = useRef<HTMLDivElement>(null)
  const svgRef    = useRef<SVGSVGElement>(null)
  const chartInst = useRef<IChartApi | null>(null)
  const theme = chartTheme()
  const [hoveredLot, setHoveredLot] = useState<Lot | null>(null)

  const sym = holding.currency === 'USD' ? '$' : '€'
  const lots = holding.lots ?? []
  const freeLots   = lots.filter(l => isFree(l.date))
  const lockedLots = lots.filter(l => !isFree(l.date))
  const freeQty    = freeLots.reduce((s, l) => s + l.quantity, 0)
  const lockedQty  = lockedLots.reduce((s, l) => s + l.quantity, 0)
  const nextFree   = [...lockedLots].sort((a, b) => a.date.localeCompare(b.date))[0]

  // OPRAVA: price_base je v HoldingsPanel přenásoben multiplierem (je v CZK) → vrátit zpět na EUR
  const priceBaseEur = multiplier > 0 ? holding.price_base / multiplier : holding.price_base
  const eurUsd = holding.currency === 'USD' && priceBaseEur > 0
    ? holding.price_native / priceBaseEur
    : 1
  const toCzk = (nativeAmount: number) =>
    holding.currency === 'USD'
      ? nativeAmount / eurUsd * multiplier
      : nativeAmount * multiplier

  const pct = holding.cost_basis_native > 0
    ? (holding.price_native - holding.cost_basis_native) / holding.cost_basis_native
    : (holding.unrealized_pnl_pct ?? 0)

  const historyData = (holding.price_history ?? []).map(p => ({ time: p.time as Time, value: p.value }))
  const firstDate = historyData[0]?.time ?? '—'
  const lastDate  = historyData[historyData.length - 1]?.time ?? '—'

  const redrawLines = () => {
    const chart = chartInst.current
    const svg   = svgRef.current
    const el    = chartRef.current
    if (!chart || !svg || !el) return
    const w = el.clientWidth
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    svg.setAttribute('width', String(w))
    svg.setAttribute('height', String(CHART_H))
    const ns = 'http://www.w3.org/2000/svg'
    lots.forEach(lot => {
      const x = chart.timeScale().timeToCoordinate(lot.date as Time)
      if (x === null || x < 0 || x > w) return
      // Jemná přerušovaná čára (méně výrazná)
      const line = document.createElementNS(ns, 'line')
      line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x))
      line.setAttribute('y1', '0');       line.setAttribute('y2', String(CHART_H))
      line.setAttribute('stroke', '#f1c21b')
      line.setAttribute('stroke-width', '1')
      line.setAttribute('stroke-dasharray', '3,5')
      line.setAttribute('opacity', '0.45')
      svg.appendChild(line)
      // Malý trojúhelník nahoře
      const tri = document.createElementNS(ns, 'polygon')
      tri.setAttribute('points', `${x-4},0 ${x+4},0 ${x},6`)
      tri.setAttribute('fill', '#f1c21b')
      tri.setAttribute('opacity', '0.7')
      svg.appendChild(tri)
      // Hit-area
      const hit = document.createElementNS(ns, 'rect')
      hit.setAttribute('x', String(x - 9)); hit.setAttribute('y', '0')
      hit.setAttribute('width', '18');       hit.setAttribute('height', String(CHART_H))
      hit.setAttribute('fill', 'transparent'); hit.setAttribute('style', 'cursor:crosshair')
      hit.addEventListener('mouseenter', () => setHoveredLot(lot))
      hit.addEventListener('mouseleave', () => setHoveredLot(null))
      svg.appendChild(hit)
    })
  }

  useEffect(() => {
    if (!chartRef.current) return
    const el = chartRef.current
    const chart = createChart(el, {
      width: el.clientWidth || 860, height: CHART_H,
      layout: { background: { color: 'transparent' }, textColor: theme.textSecondary, fontFamily: theme.fontMono },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderColor: theme.axis, scaleMargins: { top: 0.1, bottom: 0.08 } },
      timeScale: { borderColor: theme.axis },
      crosshair: { mode: 1 },
    })
    chartInst.current = chart
    const series = chart.addSeries(LineSeries, {
      color: theme.accent, lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true,
    })
    if (historyData.length > 0) {
      series.setData(historyData)
      chart.timeScale().fitContent()
    } else if (holding.sparkline?.length) {
      const today = new Date()
      series.setData(holding.sparkline.map((value, i) => {
        const d = new Date(today)
        d.setDate(d.getDate() - Math.round((holding.sparkline!.length - 1 - i) * 1.4))
        return { time: d.toISOString().slice(0, 10) as Time, value }
      }))
      chart.timeScale().fitContent()
    }
    setTimeout(redrawLines, 150)
    chart.timeScale().subscribeVisibleTimeRangeChange(redrawLines)
    const resize = () => { chart.applyOptions({ width: el.clientWidth }); setTimeout(redrawLines, 50) }
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.remove(); chartInst.current = null }
  }, [holding])

  return (
    <div style={{ position:'fixed', inset:0, zIndex:200, background:'rgba(0,0,0,0.82)', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(6px)' }} onClick={onClose}>
      <div style={{ background:'var(--surface-panel)', border:'1px solid var(--line-strong)', width:'min(920px, 97vw)', maxHeight:'94vh', overflowY:'auto', display:'flex', flexDirection:'column' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 24px', borderBottom:'1px solid var(--line)', background:'var(--surface-raised)' }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:12 }}>
            <span style={{ fontSize:22, fontWeight:500, fontFamily:'var(--font-mono)' }}>{holding.ticker}</span>
            <span style={{ fontSize:14, color:'var(--text-secondary)' }}>{holding.name}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:20 }}>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:22, fontWeight:500, fontFamily:'var(--font-mono)' }}>{sym}{holding.price_native.toFixed(2)}</div>
              <div className={signClass(pct)} style={{ fontSize:13, fontFamily:'var(--font-mono)' }}>{pct >= 0 ? '+' : ''}{(pct*100).toFixed(2)}%</div>
            </div>
            <button onClick={onClose} style={{ background:'var(--surface-active)', border:'1px solid var(--line)', color:'var(--text-secondary)', cursor:'pointer', padding:'6px 14px', fontFamily:'var(--font-mono)', fontSize:12 }}>✕</button>
          </div>
        </div>

        {/* Přehled */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:1, background:'var(--line)', borderBottom:'1px solid var(--line)' }}>
          {[
            { label:'PRŮM. NÁKUP',     val:`${sym}${holding.cost_basis_native.toFixed(2)}`,                                     sub:`≈ ${Math.round(toCzk(holding.cost_basis_native)).toLocaleString('cs-CZ')} ${displayCurrency}` },
            { label:'AKTUÁLNÍ CENA',   val:`${sym}${holding.price_native.toFixed(2)}`,                                          sub:`≈ ${Math.round(toCzk(holding.price_native)).toLocaleString('cs-CZ')} ${displayCurrency}` },
            { label:'POČET KUSŮ',      val:`${formatQuantity(holding.quantity)} ks`,                                             sub:`${lots.length} nákupů` },
            { label:'CELKOVÁ HODNOTA', val:`${Math.round(toCzk(holding.price_native*holding.quantity)).toLocaleString('cs-CZ')}`, sub:displayCurrency },
          ].map(item => (
            <div key={item.label} style={{ background:'var(--surface-panel)', padding:'12px 18px' }}>
              <div style={{ fontSize:9, letterSpacing:'0.14em', color:'var(--text-tertiary)', marginBottom:4 }}>{item.label}</div>
              <div style={{ fontSize:17, fontWeight:500, fontFamily:'var(--font-mono)' }}>{item.val}</div>
              <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:2 }}>{item.sub}</div>
            </div>
          ))}
        </div>

        {/* Graf + SVG overlay */}
        <div style={{ padding:'16px 24px 0', borderBottom:'1px solid var(--line-faint)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
            <span style={{ fontSize:9, color:'var(--text-tertiary)', letterSpacing:'0.14em' }}>
              HISTORICKÁ CENA · přerušované čáry = nákupy (najeď pro detail)
            </span>
            <span style={{ fontSize:10, color:'var(--text-tertiary)', fontFamily:'var(--font-mono)' }}>
              {String(firstDate)} → {String(lastDate)} · {historyData.length} dní
            </span>
          </div>
          <div style={{ position:'relative', height:CHART_H }}>
            <div ref={chartRef} style={{ width:'100%', height:CHART_H }} />
            <svg ref={svgRef} style={{ position:'absolute', top:0, left:0, pointerEvents:'none' }} />
          </div>

          {/* Hover buňka s detailem nákupu */}
          <div style={{ minHeight:54, borderTop:'1px solid var(--line-faint)', transition:'background 0.15s' }}>
            {hoveredLot ? (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:1, background:'var(--line)' }}>
                {[
                  { label:'DATUM',    val: hoveredLot.date },
                  { label:'CENA',     val:`${sym}${hoveredLot.price.toFixed(2)}` },
                  { label:'POČET',    val:`${formatQuantity(hoveredLot.quantity)} ks` },
                  { label:'ZAPLACENO', val:`${Math.round(toCzk(hoveredLot.price * hoveredLot.quantity)).toLocaleString('cs-CZ')} ${displayCurrency}` },
                  { label:'DAŇ',      val: isFree(hoveredLot.date) ? '✓ Volné' : `🔒 ${freeStr(hoveredLot.date)}`, color: isFree(hoveredLot.date) ? 'var(--positive)' : 'var(--warning)' },
                ].map(item => (
                  <div key={item.label} style={{ background:'var(--surface-raised)', padding:'8px 14px' }}>
                    <div style={{ fontSize:8, letterSpacing:'0.14em', color:'var(--text-tertiary)', marginBottom:3 }}>{item.label}</div>
                    <div style={{ fontSize:13, fontWeight:500, fontFamily:'var(--font-mono)', color:(item as any).color ?? 'var(--text-primary)' }}>{item.val}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding:'12px 16px', color:'var(--text-disabled)', fontSize:11, fontFamily:'var(--font-mono)' }}>
                ← najeď na žlutou čáru pro detail nákupu
              </div>
            )}
          </div>
        </div>

        {/* Daňový test */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:1, background:'var(--line)', borderBottom:'1px solid var(--line)' }}>
          {[
            { label:'DAŇOVĚ VOLNÉ (§4 ZDP)', val: freeQty > 0 ? `${formatQuantity(freeQty)} ks` : '—',   sub:`${freeLots.length} lotů`,   color: freeQty > 0  ? 'var(--positive)' : 'var(--text-tertiary)' },
            { label:'JEŠTĚ ZAMČENO',         val: lockedQty > 0 ? `${formatQuantity(lockedQty)} ks` : '—', sub:`${lockedLots.length} lotů`, color: lockedQty > 0 ? 'var(--warning)'  : 'var(--text-tertiary)' },
            { label:'NEJBLIŽŠÍ UVOLNĚNÍ',    val: nextFree ? freeStr(nextFree.date) : '—', sub: nextFree ? `${formatQuantity(nextFree.quantity)} ks` : 'vše volné', color: nextFree ? 'var(--warning)' : 'var(--text-tertiary)' },
          ].map(item => (
            <div key={item.label} style={{ background:'var(--surface-raised)', padding:'14px 20px' }}>
              <div style={{ fontSize:9, letterSpacing:'0.14em', color:'var(--text-tertiary)', marginBottom:6 }}>{item.label}</div>
              <div style={{ fontSize:20, fontWeight:500, fontFamily:'var(--font-mono)', color:item.color }}>{item.val}</div>
              <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:2 }}>{item.sub}</div>
            </div>
          ))}
        </div>

        {/* Tabulka lotů */}
        <div style={{ padding:'16px 24px 24px' }}>
          <div style={{ fontSize:9, color:'var(--text-tertiary)', letterSpacing:'0.14em', marginBottom:10 }}>INDIVIDUÁLNÍ NÁKUPY</div>
          {lots.length === 0 ? (
            <div style={{ color:'var(--text-tertiary)', fontSize:13 }}>Nákupy budou po příštím workflow runu.</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontFamily:'var(--font-mono)', fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:'1px solid var(--line)' }}>
                  {['Datum','Počet',`Cena (${sym})`,`Zaplaceno (${displayCurrency})`,`P&L (${displayCurrency})`,'P&L %','Daň'].map(h => (
                    <th key={h} style={{ textAlign:'right', padding:'6px 10px', color:'var(--text-tertiary)', fontWeight:400, fontSize:10, letterSpacing:'0.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lots.map((lot, i) => {
                  const free    = isFree(lot.date)
                  const paid    = lot.price * lot.quantity
                  const current = lot.quantity * holding.price_native
                  const pnlNat  = current - paid
                  const pnlPct  = paid > 0 ? pnlNat / paid : 0
                  return (
                    <tr key={i} style={{ borderBottom:'1px solid var(--line-faint)', background: hoveredLot?.date === lot.date ? 'var(--surface-raised)' : 'transparent' }}>
                      <td style={{ padding:'7px 10px', color:'var(--text-secondary)', textAlign:'right' }}>{lot.date}</td>
                      <td style={{ padding:'7px 10px', textAlign:'right' }}>{formatQuantity(lot.quantity)}</td>
                      <td style={{ padding:'7px 10px', textAlign:'right', color:'var(--text-secondary)' }}>{sym}{lot.price.toFixed(2)}</td>
                      <td style={{ padding:'7px 10px', textAlign:'right' }}>{Math.round(toCzk(paid)).toLocaleString('cs-CZ')}</td>
                      <td style={{ padding:'7px 10px', textAlign:'right' }} className={signClass(pnlNat)}>
                        {pnlNat >= 0 ? '+' : ''}{Math.round(toCzk(pnlNat)).toLocaleString('cs-CZ')}
                      </td>
                      <td style={{ padding:'7px 10px', textAlign:'right' }} className={signClass(pnlPct)}>
                        {pnlPct >= 0 ? '+' : ''}{(pnlPct*100).toFixed(1)}%
                      </td>
                      <td style={{ padding:'7px 10px', textAlign:'right' }}>
                        {free ? <span style={{ color:'var(--positive)' }}>✓ Volné</span> : <span style={{ color:'var(--warning)', fontSize:11 }}>🔒 {freeStr(lot.date)}</span>}
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
