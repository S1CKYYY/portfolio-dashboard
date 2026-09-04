import { useEffect, useRef, useState } from 'react'
import type { MacroData, MarketCard, FredCard, NewsItem as NewsItemType } from '../lib/macro-types'
import * as echarts from 'echarts'

async function fetchMacro(): Promise<MacroData | null> {
  try {
    const base = import.meta.env.BASE_URL ?? '/'
    const r = await fetch(`${base}macro.json?t=${Date.now()}`)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

const fmt = (v: number | null | undefined, d = 2) =>
  v == null || isNaN(v as number) ? '—' : (v as number).toLocaleString('cs-CZ', { minimumFractionDigits: d, maximumFractionDigits: d })
const signCls = (v?: number | null) => v == null ? '' : v >= 0 ? 'pos' : 'neg'
const arr = (v?: number | null) => v == null ? '' : v > 0.001 ? '▲' : v < -0.001 ? '▼' : '→'
const chgStr = (v?: number | null, d = 2) => v == null ? '' : `${v > 0 ? '+' : ''}${fmt(v, d)}`

// ── VIX Gauge ─────────────────────────────────────────────────────────────

function VixGauge({ card }: { card?: MarketCard }) {
  const val = card?.value ?? 20
  const MAX = 45
  const deg = Math.min((val / MAX) * 180, 180)
  const rad = ((deg - 180) * Math.PI) / 180
  const cx = 140, cy = 120, r = 100
  const nx = cx + r * 0.75 * Math.cos(rad)
  const ny = cy + r * 0.75 * Math.sin(rad)

  const zones = [
    { from: 0,  to: 15,  color: '#22c55e' },
    { from: 15, to: 20,  color: '#84cc16' },
    { from: 20, to: 25,  color: '#f59e0b' },
    { from: 25, to: 30,  color: '#f97316' },
    { from: 30, to: MAX, color: '#ef4444' },
  ]

  const arcPath = (from: number, to: number) => {
    const a1 = ((Math.min(from, MAX) / MAX) * 180 - 180) * Math.PI / 180
    const a2 = ((Math.min(to, MAX)   / MAX) * 180 - 180) * Math.PI / 180
    return `M ${cx + r*Math.cos(a1)} ${cy + r*Math.sin(a1)} A ${r} ${r} 0 0 1 ${cx + r*Math.cos(a2)} ${cy + r*Math.sin(a2)}`
  }

  const currentZone = zones.find(z => val >= z.from && val < z.to) ?? zones[zones.length - 1]
  const color = currentZone.color

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={280} height={200} viewBox="0 0 280 200" style={{ overflow: 'visible' }}>
        <path d={arcPath(0, MAX)} fill="none" stroke="#27272a" strokeWidth={16} strokeLinecap="round" />
        {zones.map(z => (
          <path key={z.from} d={arcPath(z.from, z.to)} fill="none" stroke={z.color} strokeWidth={16} strokeLinecap="butt" opacity={0.8} />
        ))}
        {[0, 15, 20, 25, 30, 40].map(v => {
          const a = ((v / MAX) * 180 - 180) * Math.PI / 180
          const x1 = cx + (r-10)*Math.cos(a), y1 = cy + (r-10)*Math.sin(a)
          const x2 = cx + (r+2) *Math.cos(a), y2 = cy + (r+2) *Math.sin(a)
          const lx = cx + (r-24)*Math.cos(a), ly = cy + (r-24)*Math.sin(a)
          return (
            <g key={v}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#52525b" strokeWidth={1.5} />
              <text x={lx} y={ly+3} textAnchor="middle" fontSize={8} fill="#71717a" fontFamily="monospace">{v}</text>
            </g>
          )
        })}
        {/* Zone labels */}
        <text x={22} y={cy+20} textAnchor="middle" fontSize={8} fill="#22c55e" fontFamily="monospace">Klid</text>
        <text x={258} y={cy+20} textAnchor="middle" fontSize={8} fill="#ef4444" fontFamily="monospace">Panika</text>
        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={6} fill={color} />
        <circle cx={cx} cy={cy} r={2.5} fill="#09090b" />
        {/* Value text — below center */}
        <text x={cx} y={cy+30} textAnchor="middle" fontSize={30} fontWeight="bold" fill={color} fontFamily="monospace">{val.toFixed(1)}</text>
        <text x={cx} y={cy+50} textAnchor="middle" fontSize={13} fill={color} fontFamily="monospace">{card?.state ?? ''}</text>
      </svg>
      {card && (
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#71717a', marginTop: 4 }}>
          <span className={signCls(card.change_pct)}>{arr(card.change_pct)} {chgStr(card.change_pct)}% dnes</span>
        </div>
      )}
    </div>
  )
}

// ── Spark canvas ──────────────────────────────────────────────────────────

function Spark({ data, color, w=80, h=28 }: { data: number[]; color: string; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || data.length < 2) return
    const cv = ref.current; cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')!; ctx.clearRect(0, 0, w, h)
    const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5
    data.forEach((v, i) => { const x = i/(data.length-1)*w, y = h-((v-mn)/rng)*h; i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y) })
    ctx.stroke()
  }, [data, color, w, h])
  return <canvas ref={ref} style={{ display: 'block' }} />
}

// ── ECharts line chart (history) ──────────────────────────────────────────

function HistoryChart({ series, height = 180, tight = false }: {
  series: { name: string; dates: string[]; values: number[]; color: string }[]
  height?: number
  tight?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, 'dark')
    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: 24, bottom: 30, left: 48, right: 12 },
      tooltip: { trigger: 'axis', backgroundColor: '#27272a', borderColor: '#3f3f46', textStyle: { color: '#fafafa', fontFamily: 'IBM Plex Mono', fontSize: 11 } },
      legend: series.length > 1 ? { data: series.map(s=>s.name), top: 2, textStyle: { color: '#a1a1aa', fontSize: 10 } } : undefined,
      xAxis: { type: 'category', data: series[0]?.dates ?? [], axisLabel: { color: '#52525b', fontSize: 9 }, axisLine: { lineStyle: { color: '#27272a' } } },
      yAxis: (() => {
        const allVals = series.flatMap(s => s.values).filter(v => isFinite(v))
        const lo = Math.min(...allVals), hi = Math.max(...allVals), pad = (hi - lo) * 0.08 || 0.1
        return {
          type: 'value' as const,
          min: tight ? Math.max(0, lo - pad) : undefined,
          max: tight ? hi + pad : undefined,
          axisLabel: { color: '#71717a', fontSize: 9, formatter: (v: number) => Number(v.toFixed(3)).toString() },
          splitLine: { lineStyle: { color: '#18181b' } },
        }
      })(),
      series: series.map(s => ({
        name: s.name, type: 'line', data: s.values, smooth: false,
        lineStyle: { color: s.color, width: 1.5 }, itemStyle: { color: s.color }, symbol: 'none',
      })),
    })
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.dispose() }
  }, [series])
  return <div ref={ref} style={{ width: '100%', height }} />
}

// ── Small card ────────────────────────────────────────────────────────────

function Card({ label, card, unit='', suffix='', decimals=2, invertColor=false }: {
  label: string; card?: MarketCard | FredCard; unit?: string; suffix?: string; decimals?: number; invertColor?: boolean
}) {
  if (!card) return (
    <div className="macro-card"><span className="macro-card__label">{label}</span><div className="macro-card__value">—</div></div>
  )
  const chg = 'change_pct' in card ? card.change_pct : (card as FredCard).change
  const col = chg == null ? '#a1a1aa' : invertColor
    ? (chg > 0 ? '#ef4444' : '#22c55e')
    : (chg >= 0 ? '#22c55e' : '#ef4444')
  return (
    <div className="macro-card">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="macro-card__label">{label}</span>
        {card.sparkline?.length > 2 && <Spark data={card.sparkline} color={col} />}
      </div>
      <div className="macro-card__value">{unit}{fmt(card.value, decimals)}{suffix}</div>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: col, marginTop: 2 }}>
        {arr(chg)} {chgStr(chg)}{'change_pct' in card ? '%' : ''}
        {'prev' in card && card.prev != null && (
          <span style={{ color: '#52525b', marginLeft: 6 }}>předch. {fmt(card.prev, decimals)}</span>
        )}
      </div>
      {'date' in card && <div style={{ fontSize: 9, color: '#52525b', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{card.date}</div>}
    </div>
  )
}

// ── Yield curve ───────────────────────────────────────────────────────────

function YieldCurve({ us2y, us10y, spread }: { us2y?: MarketCard; us10y?: MarketCard; spread?: MarketCard }) {
  const inv = (spread?.value ?? 0) < 0
  const col = inv ? '#ef4444' : '#22c55e'
  return (
    <div className="macro-card" style={{ borderColor: inv ? '#ef4444' : undefined }}>
      <span className="macro-card__label">SPREAD 10Y–2Y</span>
      <div style={{ fontSize: 30, fontWeight: 600, fontFamily: 'var(--font-mono)', color: col, marginTop: 6 }}>
        {spread?.value != null ? `${spread.value > 0 ? '+' : ''}${fmt(spread.value, 2)}%` : '—'}
      </div>
      <div style={{ fontSize: 12, color: col, marginTop: 2 }}>
        {inv ? '⚠ Inverze — varování' : '✓ Normální křivka'}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
        <span style={{ color: '#6366f1' }}>10Y: {fmt(us10y?.value, 3)}%</span>
        <span style={{ color: '#3b82f6' }}>2Y: {fmt(us2y?.value, 3)}%</span>
      </div>
    </div>
  )
}

// ── Rate card ─────────────────────────────────────────────────────────────

function RateCard({ exp, fedFunds }: { exp: MacroData['rate_expectations']; fedFunds?: FredCard }) {
  const chartRef = useRef<HTMLDivElement>(null)
  const rate = fedFunds?.value ?? exp.current_rate ?? 3.75

  const step = 0.25
  const lowerBound = Math.floor(rate / step) * step
  const upperBound = lowerBound + step
  const toBps = (r: number) => `${Math.round(r * 100)}-${Math.round((r + step) * 100)}`
  const cutLabel  = toBps(lowerBound - step)
  const holdLabel = toBps(lowerBound)
  const hikeLabel = toBps(upperBound)

  const cutP  = Math.round((exp.cut_probability  ?? 0) * 1000) / 10
  const holdP = Math.round((exp.hold_probability ?? 0) * 1000) / 10
  const hikeP = Math.round((exp.hike_probability ?? 0) * 1000) / 10

  const scenarios = [
    { label: cutLabel,  prob: cutP,  col: '#22c55e', move: '▼ Snížení' },
    { label: holdLabel, prob: holdP, col: '#3b82f6', move: 'Beze změny' },
    { label: hikeLabel, prob: hikeP, col: '#f59e0b', move: '▲ Zvýšení' },
  ].filter(s => s.prob > 0)

  useEffect(() => {
    if (!chartRef.current || !exp.available || scenarios.length === 0) return
    const chart = echarts.init(chartRef.current, 'dark')
    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: 30, bottom: 40, left: 16, right: 16 },
      tooltip: {
        trigger: 'axis',
        formatter: (p: any) => `${p[0].name}<br/><b>${p[0].value}%</b>`,
        backgroundColor: '#27272a', borderColor: '#3f3f46',
        textStyle: { color: '#fafafa', fontFamily: 'IBM Plex Mono', fontSize: 12 },
      },
      xAxis: {
        type: 'category',
        data: scenarios.map(s => s.label),
        axisLabel: { color: '#a1a1aa', fontSize: 11, fontFamily: 'IBM Plex Mono' },
        axisLine: { lineStyle: { color: '#3f3f46' } },
        axisTick: { show: false },
        name: 'Target Rate (bps)',
        nameLocation: 'middle',
        nameGap: 28,
        nameTextStyle: { color: '#71717a', fontSize: 10 },
      },
      yAxis: {
        type: 'value', min: 0, max: 100,
        axisLabel: { color: '#71717a', fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: '#1f1f23', type: 'dashed' } },
      },
      series: [{
        type: 'bar',
        data: scenarios.map(s => ({
          value: s.prob,
          itemStyle: { color: s.col, borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: 'top', color: s.col, fontSize: 14, fontFamily: 'IBM Plex Mono', fontWeight: 700, formatter: '{c}%' },
        })),
        barMaxWidth: 80,
      }],
    })
    return () => chart.dispose()
  }, [exp])

  return (
    <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--line)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--text-tertiary)', marginBottom: 3 }}>FED FUNDS RATE</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 600 }}>{rate.toFixed(2)}%</div>
          {fedFunds?.prev != null && (
            <div style={{ fontSize: 11, color: '#71717a', fontFamily: 'var(--font-mono)' }}>
              {rate < fedFunds.prev ? '▼ sníženo' : rate > fedFunds.prev ? '▲ zvýšeno' : '→'} z {fedFunds.prev.toFixed(2)}%
            </div>
          )}
          {fedFunds?.date && <div style={{ fontSize: 9, color: '#52525b', fontFamily: 'var(--font-mono)' }}>{fedFunds.date}</div>}
        </div>
        {exp.next_meeting && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', letterSpacing: '0.1em' }}>PŘÍŠTÍ FOMC</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: '#a1a1aa', marginTop: 2 }}>{exp.next_meeting}</div>
          </div>
        )}
      </div>

      {exp.available && scenarios.length > 0 ? (
        <>
          <div style={{ fontSize: 10, color: '#a1a1aa', marginTop: 2 }}>
            Target Rate Probabilities · {exp.next_meeting ?? ''} Fed Meeting
          </div>
          <div style={{ fontSize: 9, color: '#52525b' }}>
            Current target rate: {Math.round(lowerBound * 100)}-{Math.round(upperBound * 100)} bps
          </div>
          <div ref={chartRef} style={{ width: '100%', height: 200 }} />
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'IBM Plex Mono', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #3f3f46' }}>
                <th style={{ textAlign: 'left',  padding: '5px 6px', color: '#71717a', fontWeight: 400, fontSize: 9, letterSpacing: '0.1em' }}>TARGET RATE (BPS)</th>
                <th style={{ textAlign: 'right', padding: '5px 6px', color: '#71717a', fontWeight: 400, fontSize: 9 }}>PRAVDĚPODOBNOST</th>
                <th style={{ textAlign: 'right', padding: '5px 6px', color: '#71717a', fontWeight: 400, fontSize: 9 }}>POHYB</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map(s => (
                <tr key={s.label} style={{ borderBottom: '1px solid #1f1f23' }}>
                  <td style={{ padding: '6px 6px', color: s.col, fontWeight: 500 }}>{s.label}</td>
                  <td style={{ padding: '6px 6px', textAlign: 'right', fontWeight: 700, color: s.col }}>{s.prob}%</td>
                  <td style={{ padding: '6px 6px', textAlign: 'right', color: '#71717a', fontSize: 10 }}>{s.move}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, fontSize: 9 }}>
            {exp.futures_price && <span style={{ color: '#3f3f46', fontFamily: 'IBM Plex Mono' }}>ZQ: {exp.futures_price?.toFixed(4)} · implied {exp.implied_rate?.toFixed(3)}%</span>}
            <span style={{ color: '#3f3f46' }}>Zdroj: {exp.source}</span>
            <a href="https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html"
              target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>
              → CME FedWatch (živá data) ↗
            </a>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 10, color: '#71717a', lineHeight: 1.5, padding: '6px 8px', background: '#0d0d0f', borderLeft: '2px solid #3f3f46' }}>
            Základní sazba Fed. Spusť <code>python tools/update_fedwatch.py</code> lokálně pro predikce.
          </div>
          <a href="https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html"
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: '#60a5fa', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
            → CME FedWatch ↗
          </a>
        </>
      )}
    </div>
  )
}


// ── News sidebar ──────────────────────────────────────────────────────────

const TICKER_LABELS: Record<string, string> = {
  'BRK-B': 'BRK-B', 'DUOL': 'DUOL', 'PYPL': 'PYPL', 'META': 'META',
  'MSFT': 'MSFT', 'NFLX': 'NFLX', '^VIX': 'VIX', '^TNX': '10Y', 'GC=F': 'GOLD',
}
const TICKER_COLOR: Record<string, string> = {
  'BRK-B': '#6366f1', 'DUOL': '#22c55e', 'PYPL': '#3b82f6', 'META': '#1d4ed8',
  'MSFT': '#0ea5e9', 'NFLX': '#ef4444', '^VIX': '#f59e0b', '^TNX': '#8b5cf6', 'GC=F': '#f59e0b',
}


// ── CPI vs wages ──────────────────────────────────────────────────────────

function CpiWages({ data }: { data: MacroData['cpi_wages_history'] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || !data.dates.length) return
    const chart = echarts.init(ref.current, 'dark')
    const series: any[] = [
      { name: 'CPI YoY', type: 'line', data: data.cpi_yoy, smooth: true, lineStyle: { color: '#f59e0b', width: 2 }, itemStyle: { color: '#f59e0b' }, symbol: 'none', areaStyle: { color: 'rgba(245,158,11,0.06)' } },
      { name: 'Mzdy YoY', type: 'line', data: data.wages_yoy, smooth: true, lineStyle: { color: '#22c55e', width: 2 }, itemStyle: { color: '#22c55e' }, symbol: 'none', areaStyle: { color: 'rgba(34,197,94,0.06)' } },
    ]
    if (data.fed_funds?.some(Boolean)) series.push({ name: 'Fed Rate', type: 'line', data: data.fed_funds, smooth: false, lineStyle: { color: '#818cf8', width: 2, type: 'dashed' }, itemStyle: { color: '#818cf8' }, symbol: 'none' })
    if (data.unemployment?.some(Boolean)) series.push({ name: 'Nezaměstnanost', type: 'line', data: data.unemployment, smooth: true, lineStyle: { color: '#fb923c', width: 2.5 }, itemStyle: { color: '#fb923c' }, symbol: 'circle', symbolSize: 3, showSymbol: false })

    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: 48, bottom: 32, left: 46, right: 60 },
      tooltip: {
        trigger: 'axis', backgroundColor: '#27272a', borderColor: '#3f3f46',
        textStyle: { color: '#fafafa', fontFamily: 'IBM Plex Mono', fontSize: 11 },
        formatter: (params: any[]) => {
          const hdr = params[0]?.axisValue || ''
          const rows = params.map((p: any) => {
            const isPrice = p.seriesName === 'S&P 500'
            const val = p.value != null ? (isPrice ? p.value.toLocaleString('cs-CZ', {maximumFractionDigits:0}) : p.value.toFixed(2)+'%') : '—'
            return `<span style="color:${p.color}">${p.seriesName}</span>: <b>${val}</b>`
          }).join('<br/>')
          return `${hdr}<br/>${rows}`
        }
      },
      legend: {
        data: series.map(s => s.name), top: 4,
        textStyle: { color: '#a1a1aa', fontSize: 10 },
        inactiveColor: '#3f3f46',
      },
      xAxis: { type: 'category', data: data.dates, axisLabel: { color: '#52525b', fontSize: 9 }, axisLine: { lineStyle: { color: '#27272a' } } },
      yAxis: { type: 'value', axisLabel: { color: '#71717a', fontSize: 9, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#18181b' } }, scale: true },
      series,
    })
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.dispose() }
  }, [data])
  return <div ref={ref} style={{ width: '100%', height: 360 }} />
}

// ── Sec header ────────────────────────────────────────────────────────────

function Sec({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '16px 0 8px', borderBottom: '1px solid var(--line-faint)', marginBottom: 10 }}>
      <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.18em', color: 'var(--text-secondary)' }}>{title}</span>
      {sub && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{sub}</span>}
    </div>
  )
}

// ── 52W range indicator ──────────────────────────────────────────────────

function RangeBar({ current, values, favorableHigh, label }: {
  current: number; values: number[]; favorableHigh: boolean; label: string
}) {
  if (!values.length) return null
  const lo = Math.min(...values), hi = Math.max(...values)
  const pct = Math.max(0, Math.min(100, (current - lo) / (hi - lo) * 100))
  const goodPct = favorableHigh ? pct : 100 - pct
  const col = goodPct > 65 ? '#22c55e' : goodPct > 35 ? '#f59e0b' : '#ef4444'
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#52525b', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
        <span>{lo.toFixed(3)}</span>
        <span style={{ color: '#71717a' }}>{label} · 52W</span>
        <span>{hi.toFixed(3)}</span>
      </div>
      <div style={{ position: 'relative', height: 6, background: '#27272a', borderRadius: 3 }}>
        <div style={{ position: 'absolute', left: favorableHigh ? '50%' : 0, width: '50%', height: '100%', background: 'rgba(34,197,94,0.18)', borderRadius: 3 }} />
        <div style={{ position: 'absolute', left: `${pct}%`, top: '50%', width: 12, height: 12, borderRadius: '50%', background: col, border: '2px solid #09090b', transform: 'translate(-50%,-50%)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9 }}>
        <span style={{ color: favorableHigh ? '#ef4444' : '#22c55e' }}>{favorableHigh ? '← špatné' : '← dobré'}</span>
        <span style={{ color: col, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{pct.toFixed(0)}. percentil</span>
        <span style={{ color: favorableHigh ? '#22c55e' : '#ef4444' }}>{favorableHigh ? 'dobré →' : 'špatné →'}</span>
      </div>
    </div>
  )
}

// ── Currency zone chart ───────────────────────────────────────────────────

function CurrencyZoneChart({ dates, values, label, favorableHigh = true, height = 160 }: {
  dates: string[]; values: number[]; label: string; favorableHigh?: boolean; height?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || !values.length) return
    const chart = echarts.init(ref.current, 'dark')
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    const mn = Math.min(...values), mx = Math.max(...values), rng = mx - mn
    const mid = (mn + mx) / 2
    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: 12, bottom: 28, left: 50, right: 8 },
      tooltip: { trigger: 'axis', backgroundColor: '#27272a', borderColor: '#3f3f46', textStyle: { color: '#fafafa', fontFamily: 'IBM Plex Mono', fontSize: 11 } },
      xAxis: { type: 'category', data: dates, axisLabel: { color: '#52525b', fontSize: 9 }, axisLine: { lineStyle: { color: '#27272a' } } },
      yAxis: { type: 'value', min: mn - rng*0.05, max: mx + rng*0.05, axisLabel: { color: '#71717a', fontSize: 9 }, splitLine: { lineStyle: { color: '#18181b' } } },
      series: [{
        name: label, type: 'line', data: values, smooth: false,
        lineStyle: { color: '#60a5fa', width: 1.5 }, itemStyle: { color: '#60a5fa' }, symbol: 'none',
        markArea: { silent: true, data: [
          [{ yAxis: favorableHigh ? mid : mn-rng*0.1, itemStyle: { color: 'rgba(34,197,94,0.09)' } }, { yAxis: favorableHigh ? mx+rng*0.1 : mid }],
          [{ yAxis: favorableHigh ? mn-rng*0.1 : mid, itemStyle: { color: 'rgba(239,68,68,0.09)' } }, { yAxis: favorableHigh ? mid : mx+rng*0.1 }],
        ]},
        markLine: { silent: true, symbol: 'none', data: [{ yAxis: avg, lineStyle: { color: '#3f3f46', type: 'dashed', width: 1 }, label: { formatter: `Prům: ${avg.toFixed(3)}`, color: '#52525b', fontSize: 8 } }] },
      }],
    })
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.dispose() }
  }, [dates, values])
  return <div ref={ref} style={{ width: '100%', height }} />
}

// ── Currency impact card ──────────────────────────────────────────────────

function CurrencyImpact({ title, card, portfolioShare, favorableHigh, explanation, impactNote }: {
  title: string; card?: MarketCard; portfolioShare: number; favorableHigh: boolean; explanation: string; impactNote: string
}) {
  if (!card) return null
  const values = card.history?.values ?? []
  const dates  = card.history?.dates  ?? []
  const moveGood = favorableHigh ? (card.change_pct ?? 0) > 0 : (card.change_pct ?? 0) < 0
  const moveCol  = moveGood ? '#22c55e' : '#ef4444'
  return (
    <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--line)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--text-tertiary)', marginBottom: 3 }}>{title}</div>
          <div style={{ fontSize: 26, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{card.value.toFixed(title.includes('CZK') ? 2 : 4)}</div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: moveCol, marginTop: 2 }}>
            {arr(card.change_pct)} {chgStr(card.change_pct)}% · {moveGood ? '✓ výhodný pohyb' : '⚠ nevýhodný pohyb'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 9, color: '#71717a', marginBottom: 2 }}>Ovlivňuje</div>
          <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-mono)', color: '#a1a1aa' }}>{portfolioShare}%</div>
          <div style={{ fontSize: 9, color: '#52525b' }}>portfolia</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#71717a', lineHeight: 1.5, margin: '8px 0', padding: '6px 8px', background: '#0d0d0f', borderLeft: '2px solid #3f3f46' }}>
        {explanation}
      </div>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#a1a1aa', marginBottom: 6 }}>📐 {impactNote}</div>
      {values.length > 10 && <RangeBar current={card.value} values={values} favorableHigh={favorableHigh} label={title} />}
      {dates.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 8, color: '#52525b', marginBottom: 3 }}>
            <span style={{ color: '#22c55e' }}>■</span> výhodná zóna &nbsp;
            <span style={{ color: '#ef4444' }}>■</span> nevýhodná zóna &nbsp;
            <span style={{ color: '#3f3f46' }}>– –</span> roční průměr
          </div>
          <CurrencyZoneChart dates={dates} values={values} label={title} favorableHigh={favorableHigh} />
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────

export function MacroPage() {
  const [data, setData] = useState<MacroData | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { fetchMacro().then(d => { setData(d); setLoading(false) }) }, [])

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>Načítám makro data…</div>
  if (!data) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--negative)', fontFamily: 'var(--font-mono)' }}>❌ macro.json nenalezen — spusť workflow</div>

  const m  = data.market
  const f  = data.fred
  const ts = new Date(data.generated_at).toLocaleString('cs-CZ')
  const news: NewsItemType[] = data.news ?? []
  const realWagePos = (f.wages_yoy?.value ?? 0) > (f.cpi_yoy?.value ?? 0)

  // Historická data pro grafy
  const vixHistory = m.vix?.history
  const cpiWagesSeries = data.cpi_wages_history

  const bondSeries = [
    ...(m.us2y?.history   ? [{ name: 'US 2Y',  dates: m.us2y.history.dates,   values: m.us2y.history.values,   color: '#3b82f6' }] : []),
    ...(m.us10y?.history  ? [{ name: 'US 10Y', dates: m.us10y.history.dates,  values: m.us10y.history.values,  color: '#6366f1' }] : []),
    ...(m.us30y?.history  ? [{ name: 'US 30Y', dates: m.us30y.history.dates,  values: m.us30y.history.values,  color: '#a78bfa' }] : []),
  ]

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 60px)' }}>

      {/* ── NEWS SIDEBAR ── */}
      <div style={{ width: 280, minWidth: 280, borderRight: '1px solid var(--line)', overflowY: 'auto', maxHeight: 'calc(100vh - 60px)', position: 'sticky', top: 0, flexShrink: 0 }}>
        <div style={{ padding: '10px 12px 6px', borderBottom: '1px solid var(--line)', fontSize: 9, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
          ZPRÁVY — PORTFOLIO & TRH
        </div>
        {news.length === 0
          ? <div style={{ padding: 16, color: '#52525b', fontSize: 11 }}>Žádné zprávy (spusť workflow)</div>
          : news.map((item, i) => {
            const col = TICKER_COLOR[item.ticker] ?? '#a1a1aa'
            const label = TICKER_LABELS[item.ticker] ?? item.ticker
            const ts = item.ts ? new Date(item.ts * 1000).toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
            return (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'block', textDecoration: 'none', padding: '9px 12px', borderBottom: '1px solid var(--line-faint)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-raised)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 8, fontWeight: 600, fontFamily: 'var(--font-mono)', color: col, background: col+'22', padding: '1px 4px', borderRadius: 2 }}>{label}</span>
                  <span style={{ fontSize: 8, color: '#52525b', fontFamily: 'var(--font-mono)' }}>{ts}</span>
                </div>
                <div style={{ fontSize: 11, color: '#d4d4d8', lineHeight: 1.4 }}>{item.title}</div>
                {item.publisher && <div style={{ fontSize: 9, color: '#52525b', marginTop: 2 }}>{item.publisher}</div>}
              </a>
            )
          })
        }
      </div>

      {/* ── MAKRO OBSAH ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px 40px', minWidth: 0 }}>
        <div>
          <div style={{ padding: '6px 0 2px', fontSize: 10, color: '#52525b', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
            Aktualizováno: {ts}
          </div>

          {/* ── SENTIMENT & DLUHOPISY ── */}
          <Sec title="SENTIMENT & DLUHOPISY" />
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 10, marginBottom: 12 }}>

            {/* VIX gauge + history */}
            <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--line)', padding: '12px 8px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden', minWidth: 0 }}>
              <div style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--text-tertiary)', marginBottom: 2 }}>VIX — INDEX STRACHU</div>
              <VixGauge card={m.vix} />
              {vixHistory && (
                <div style={{ width: '100%', marginTop: 4 }}>
                  <HistoryChart series={[{ name: 'VIX', dates: vixHistory.dates, values: vixHistory.values, color: '#f59e0b' }]} height={130} />
                </div>
              )}
            </div>

            {/* Výnosy karty + Fed Rate + graf přes celou šířku */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* 5 karet v řadě: 2Y, 10Y, 30Y, Spread, Fed Rate */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                <Card label="US 2Y výnos"  card={m.us2y}  suffix="%" decimals={3} />
                <Card label="US 10Y výnos" card={m.us10y} suffix="%" decimals={3} />
                <Card label="US 30Y výnos" card={m.us30y} suffix="%" decimals={3} />
                <YieldCurve us2y={m.us2y} us10y={m.us10y} spread={m.yield_spread} />
                <RateCard exp={data.rate_expectations} fedFunds={f.fed_funds} />
              </div>
              {/* Graf přes celou šířku, vyšší */}
              {bondSeries.length > 0 && (
                <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--line)', padding: '8px 12px', flex: 1 }}>
                  <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginBottom: 4 }}>VÝNOSY 2Y · 10Y · 30Y — 1 ROK</div>
                  <HistoryChart series={bondSeries} height={280} tight={true} />
                </div>
              )}
            </div>
          </div>

          {/* ── KURZOVÉ VLIVY NA PORTFOLIO ── */}
          <Sec title="KURZOVÉ VLIVY NA PORTFOLIO" sub="jak pohyby měn ovlivňují tvůj výnos" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
            <CurrencyImpact
              title="EUR/CZK"
              card={m.eur_czk}
              portfolioShare={84}
              favorableHigh={true}
              explanation="84 % portfolia je v EUR (ETF na Xetra). Čím VYŠŠÍ EUR/CZK, tím VÍCE CZK dostaneš při přepočtu — CZK je slabá, pro tebe výhodné. Pokud CZK posiluje (EUR/CZK klesá), portfolio v CZK ztrácí i bez pohybu trhů."
              impactNote="Pohyb EUR/CZK o 1 % = změna hodnoty portfolia o ~0.84 %"
            />
            <CurrencyImpact
              title="EUR/USD"
              card={m.eur_usd}
              portfolioShare={16}
              favorableHigh={false}
              explanation="16 % portfolia jsou US akcie (BRK-B, DUOL, PYPL…). EUR/USD ROSTE = EUR posiluje = USD oslabuje = US akcie jsou v EUR méně cenné. Výhodný pro tebe je NÍZKÝ EUR/USD (silný dolar)."
              impactNote="Pohyb EUR/USD o 1 % = změna US části o ~1 % (= ~0.16 % portfolia)"
            />
            <CurrencyImpact
              title="DXY (Dolar index)"
              card={m.dxy}
              portfolioShare={16}
              favorableHigh={true}
              explanation="DXY měří sílu USD vůči koši měn (EUR, JPY, GBP…). Silný dolar (DXY roste) = tvoje US akcie jsou v EUR hodnotnější. DXY a EUR/USD se pohybují opačně — když DXY roste, EUR/USD klesá."
              impactNote="DXY je vedoucí indikátor — pohyby předcházejí změnám EUR/USD"
            />
          </div>

          {/* ── KOMODITY ── */}
          <Sec title="KOMODITY" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
            <Card label="Ropa Brent" card={m.brent} unit="$" decimals={2} />
            <Card label="Zlato"      card={m.gold}  unit="$" decimals={0} />
          </div>

          {/* ── FRED makro ── */}
          <Sec title="MAKROEKONOMIKA USA" sub="FRED · CPI / PCE / Mzdy / Nezaměstnanost" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
            <Card label="CPI YoY"        card={f.cpi_yoy}      suffix="%" invertColor />
            <Card label="PCE YoY"        card={f.pce_yoy}      suffix="%" invertColor />
            <Card label="Mzdy YoY"       card={f.wages_yoy}    suffix="%" />
            <Card label="Nezaměstnanost" card={f.unemployment} suffix="%" invertColor />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr', gap: 10 }}>
            <div style={{ display: 'none' }} />
            <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--line)', padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-tertiary)' }}>CPI vs. MZDY (YoY)</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: realWagePos ? '#22c55e' : '#ef4444' }}>
                  {realWagePos ? '▲ Reálný příjem roste' : '▼ Ztráta kupní síly'}
                </span>
              </div>
              <CpiWages data={cpiWagesSeries} />
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
