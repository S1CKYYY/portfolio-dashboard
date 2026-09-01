import { useEffect, useRef, useState } from 'react'
import type { MacroData, MarketCard, FredCard, NewsItem } from '../lib/macro-types'
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

function HistoryChart({ series, height = 180 }: {
  series: { name: string; dates: string[]; values: number[]; color: string }[]
  height?: number
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
      yAxis: { type: 'value', axisLabel: { color: '#71717a', fontSize: 9 }, splitLine: { lineStyle: { color: '#18181b' } } },
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
  const rate = fedFunds?.value ?? exp.current_rate
  return (
    <div className="macro-card">
      <span className="macro-card__label">FED FUNDS RATE</span>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 30, fontWeight: 600, marginTop: 6 }}>{rate?.toFixed(2) ?? '—'}%</div>
      {fedFunds?.prev != null && <div style={{ fontSize: 11, color: '#71717a', fontFamily: 'var(--font-mono)' }}>předch. {fedFunds.prev.toFixed(2)}%</div>}
      {fedFunds?.date && <div style={{ fontSize: 9, color: '#52525b', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{fedFunds.date}</div>}
      {exp.available && exp.cut_probability != null && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.1em', color: '#71717a', marginBottom: 6 }}>FUTURES — NEXT MEETING</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { l: 'Snížení', p: Math.round((exp.cut_probability)*100),  c: '#22c55e' },
              { l: 'Hold',    p: Math.round((exp.hold_probability??0)*100), c: '#a1a1aa' },
              { l: 'Zvýšení', p: Math.round((exp.hike_probability??0)*100), c: '#ef4444' },
            ].map(item => (
              <div key={item.l} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ height: 3, background: item.c, borderRadius: 2, marginBottom: 4, opacity: item.p > 5 ? 1 : 0.2 }} />
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: item.c }}>{item.p}%</div>
                <div style={{ fontSize: 8, color: '#71717a' }}>{item.l.toUpperCase()}</div>
              </div>
            ))}
          </div>
          {exp.implied_rate != null && <div style={{ fontSize: 9, color: '#52525b', fontFamily: 'var(--font-mono)', marginTop: 6 }}>Implikovaná sazba: {exp.implied_rate.toFixed(2)}%</div>}
        </div>
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

function NewsItem({ item }: { item: NewsItem }) {
  const ts = item.ts ? new Date(item.ts * 1000).toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
  const col = TICKER_COLOR[item.ticker] ?? '#a1a1aa'
  const label = TICKER_LABELS[item.ticker] ?? item.ticker
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textDecoration: 'none', padding: '10px 12px', borderBottom: '1px solid var(--line-faint)', transition: 'background 0.1s' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-raised)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 9, fontWeight: 600, fontFamily: 'var(--font-mono)', color: col, background: col+'22', padding: '1px 5px', borderRadius: 2 }}>{label}</span>
        <span style={{ fontSize: 9, color: '#52525b', fontFamily: 'var(--font-mono)' }}>{ts}</span>
      </div>
      <div style={{ fontSize: 12, color: '#d4d4d8', lineHeight: 1.4 }}>{item.title}</div>
      {item.publisher && <div style={{ fontSize: 10, color: '#52525b', marginTop: 3 }}>{item.publisher}</div>}
    </a>
  )
}

// ── CPI vs wages ──────────────────────────────────────────────────────────

function CpiWages({ data }: { data: MacroData['cpi_wages_history'] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || !data.dates.length) return
    const chart = echarts.init(ref.current, 'dark')
    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: 24, bottom: 30, left: 44, right: 12 },
      tooltip: { trigger: 'axis', backgroundColor: '#27272a', borderColor: '#3f3f46', textStyle: { color: '#fafafa', fontFamily: 'IBM Plex Mono', fontSize: 11 } },
      legend: { data: ['CPI', 'Mzdy'], top: 2, textStyle: { color: '#a1a1aa', fontSize: 10 } },
      xAxis: { type: 'category', data: data.dates, axisLabel: { color: '#52525b', fontSize: 9, rotate: 30 }, axisLine: { lineStyle: { color: '#27272a' } } },
      yAxis: { type: 'value', axisLabel: { color: '#71717a', fontSize: 9, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#18181b' } } },
      series: [
        { name: 'CPI', type: 'line', data: data.cpi_yoy, smooth: true, lineStyle: { color: '#f59e0b', width: 2 }, itemStyle: { color: '#f59e0b' }, symbol: 'none', areaStyle: { color: 'rgba(245,158,11,0.07)' } },
        { name: 'Mzdy', type: 'line', data: data.wages_yoy, smooth: true, lineStyle: { color: '#22c55e', width: 2 }, itemStyle: { color: '#22c55e' }, symbol: 'none', areaStyle: { color: 'rgba(34,197,94,0.07)' } },
      ],
    })
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.dispose() }
  }, [data])
  return <div ref={ref} style={{ width: '100%', height: 200 }} />
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
  const news = data.news ?? []
  const realWagePos = (f.wages_yoy?.value ?? 0) > (f.cpi_yoy?.value ?? 0)

  // Historická data pro grafy
  const vixHistory = m.vix?.history
  const cpiWagesSeries = data.cpi_wages_history

  const bondSeries = [
    ...(m.us10y?.history ? [{ name: 'US 10Y', dates: m.us10y.history.dates, values: m.us10y.history.values, color: '#6366f1' }] : []),
    ...(m.us2y?.history  ? [{ name: 'US 2Y',  dates: m.us2y.history.dates,  values: m.us2y.history.values,  color: '#3b82f6' }] : []),
  ]
  const currencySeries = [
    ...(m.eur_usd?.history ? [{ name: 'EUR/USD', dates: m.eur_usd.history.dates, values: m.eur_usd.history.values, color: '#22c55e' }] : []),
    ...(m.eur_czk?.history ? [{ name: 'EUR/CZK', dates: m.eur_czk.history.dates, values: m.eur_czk.history.values, color: '#f59e0b' }] : []),
  ]

  return (
    <div style={{ display: 'flex', gap: 0, minHeight: 'calc(100vh - 60px)' }}>

      {/* ── NEWS SIDEBAR (levá strana) ── */}
      <div style={{ width: 320, minWidth: 320, borderRight: '1px solid var(--line)', overflowY: 'auto', maxHeight: 'calc(100vh - 60px)', position: 'sticky', top: 0 }}>
        <div style={{ padding: '12px 12px 6px', borderBottom: '1px solid var(--line)', fontSize: 9, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
          ZPRÁVY — PORTFOLIO & TRH
        </div>
        {news.length === 0
          ? <div style={{ padding: 20, color: '#52525b', fontSize: 12 }}>Žádné zprávy (spusť workflow)</div>
          : news.map((item, i) => <NewsItem key={i} item={item} />)
        }
      </div>

      {/* ── MAKRO OBSAH (pravá strana) ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 40px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ padding: '6px 0 2px', fontSize: 10, color: '#52525b', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
            Aktualizováno: {ts}
          </div>

          {/* ── VIX + kurzy + DXY ── */}
          <Sec title="SENTIMENT & MĚNY" />
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 10, marginBottom: 12 }}>
            <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--line)', padding: '14px 8px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--text-tertiary)', marginBottom: 4 }}>VIX — INDEX STRACHU</div>
              <VixGauge card={m.vix} />
              {vixHistory && (
                <div style={{ width: '100%', marginTop: 6 }}>
                  <HistoryChart series={[{ name: 'VIX', dates: vixHistory.dates, values: vixHistory.values, color: '#f59e0b' }]} height={120} />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <Card label="DXY (Dolar)" card={m.dxy} decimals={3} />
                <Card label="EUR/USD"  card={m.eur_usd} decimals={4} />
                <Card label="EUR/CZK"  card={m.eur_czk} decimals={3} />
              </div>
              {currencySeries.length > 0 && (
                <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--line)', padding: '10px 12px', flex: 1 }}>
                  <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginBottom: 6 }}>KURZY — 1 ROK</div>
                  <HistoryChart series={currencySeries} height={150} />
                </div>
              )}
            </div>
          </div>

          {/* ── DLUHOPISY ── */}
          <Sec title="DLUHOPISY & SAZBY" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <Card label="US 10Y výnos" card={m.us10y} suffix="%" decimals={3} />
            <Card label="US 2Y výnos"  card={m.us2y}  suffix="%" decimals={3} />
            <YieldCurve us2y={m.us2y} us10y={m.us10y} spread={m.yield_spread} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 12 }}>
            {bondSeries.length > 0 && (
              <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--line)', padding: '10px 12px' }}>
                <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginBottom: 6 }}>VÝNOSY 10Y & 2Y — 1 ROK</div>
                <HistoryChart series={bondSeries} height={180} />
              </div>
            )}
            <RateCard exp={data.rate_expectations} fedFunds={f.fed_funds} />
          </div>

          {/* ── KOMODITY ── */}
          <Sec title="KOMODITY" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
            <Card label="Ropa Brent" card={m.brent} unit="$" decimals={2} />
            <Card label="Zlato"      card={m.gold}  unit="$" decimals={0} />
          </div>

          {/* ── FRED makro ── */}
          <Sec title="MAKROEKONOMIKA USA" sub="FRED" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
            <Card label="CPI YoY"     card={f.cpi_yoy}      suffix="%" invertColor />
            <Card label="Core CPI YoY" card={f.core_cpi_yoy} suffix="%" invertColor />
            <Card label="PCE YoY"     card={f.pce_yoy}      suffix="%" invertColor />
            <Card label="Mzdy YoY"    card={f.wages_yoy}    suffix="%" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 10 }}>
            <Card label="Nezaměstnanost" card={f.unemployment} suffix="%" invertColor />
            <Card label="HDP QoQ"        card={f.gdp}          suffix="%" />
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
