/**
 * MacroPage — makroekonomický dashboard s pestřejším layoutem.
 */
import { useEffect, useRef, useState } from 'react'
import type { MacroData, MarketCard, FredCard } from '../lib/macro-types'
import * as echarts from 'echarts'

async function fetchMacro(): Promise<MacroData | null> {
  try {
    const base = import.meta.env.BASE_URL ?? '/'
    const r = await fetch(`${base}macro.json?t=${Date.now()}`)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

function fmt(v: number | null | undefined, d = 2) {
  if (v == null || isNaN(v as number)) return '—'
  return (v as number).toLocaleString('cs-CZ', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function signCls(v?: number | null) { return v == null ? '' : v >= 0 ? 'pos' : 'neg' }
function arrow(v?: number | null) { return v == null ? '' : v > 0.001 ? '▲' : v < -0.001 ? '▼' : '→' }
function chgStr(v?: number | null, d = 2) {
  if (v == null) return ''
  return `${v > 0 ? '+' : ''}${fmt(v, d)}`
}

// ── VIX Gauge (SVG speedometer) ────────────────────────────────────────────

function VixGauge({ card }: { card?: MarketCard }) {
  const val = card?.value ?? 20
  const MAX = 45
  // 0° = left (-180°), 180° = right (0°) in SVG terms
  const deg = Math.min((val / MAX) * 180, 180)
  const rad = ((deg - 180) * Math.PI) / 180
  const cx = 140, cy = 140, r = 110
  const nx = cx + r * 0.75 * Math.cos(rad)
  const ny = cy + r * 0.75 * Math.sin(rad)

  const zones = [
    { from: 0,  to: 15,  color: '#22c55e', label: 'Klid' },
    { from: 15, to: 20,  color: '#84cc16', label: 'Mírné' },
    { from: 20, to: 25,  color: '#f59e0b', label: 'Pozor' },
    { from: 25, to: 30,  color: '#f97316', label: 'Strach' },
    { from: 30, to: MAX, color: '#ef4444', label: 'Panika' },
  ]

  function arcPath(fromVal: number, toVal: number) {
    const a1 = ((Math.min(fromVal, MAX) / MAX) * 180 - 180) * Math.PI / 180
    const a2 = ((Math.min(toVal, MAX)   / MAX) * 180 - 180) * Math.PI / 180
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2)
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`
  }

  const currentZone = zones.find(z => val >= z.from && val < z.to) ?? zones[zones.length - 1]
  const color = currentZone.color

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={280} height={170} viewBox="0 0 280 170">
        {/* Background arc */}
        <path d={arcPath(0, MAX)} fill="none" stroke="#27272a" strokeWidth={18} strokeLinecap="round" />
        {/* Color zones */}
        {zones.map(z => (
          <path key={z.from} d={arcPath(z.from, z.to)} fill="none"
            stroke={z.color} strokeWidth={18} strokeLinecap="butt" opacity={0.85} />
        ))}
        {/* Tick marks */}
        {[0, 10, 15, 20, 25, 30, 40].map(v => {
          const a = ((v / MAX) * 180 - 180) * Math.PI / 180
          const x1 = cx + (r - 12) * Math.cos(a), y1 = cy + (r - 12) * Math.sin(a)
          const x2 = cx + (r + 2)  * Math.cos(a), y2 = cy + (r + 2)  * Math.sin(a)
          const lx = cx + (r - 26) * Math.cos(a), ly = cy + (r - 26) * Math.sin(a)
          return (
            <g key={v}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#52525b" strokeWidth={1.5} />
              <text x={lx} y={ly + 4} textAnchor="middle" fontSize={9} fill="#71717a" fontFamily="IBM Plex Mono">{v}</text>
            </g>
          )
        })}
        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={7} fill={color} />
        <circle cx={cx} cy={cy} r={3} fill="#09090b" />
        {/* Value */}
        <text x={cx} y={cy + 32} textAnchor="middle" fontSize={28} fontWeight={600}
          fill={color} fontFamily="IBM Plex Mono">{val.toFixed(1)}</text>
        <text x={cx} y={cy + 50} textAnchor="middle" fontSize={12} fill={color} fontFamily="IBM Plex Mono">{currentZone.label}</text>
        {/* Labels */}
        <text x={18}  y={155} textAnchor="middle" fontSize={9} fill="#71717a">Klid</text>
        <text x={262} y={155} textAnchor="middle" fontSize={9} fill="#ef4444">Panika</text>
      </svg>
      {card && (
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#71717a', marginTop: -8 }}>
          <span className={signCls(card.change_pct)} style={{ marginRight: 8 }}>
            {arrow(card.change_pct)} {chgStr(card.change_pct)}%
          </span>
          <span>Předchozí close</span>
        </div>
      )}
    </div>
  )
}

// ── Sparkline canvas ──────────────────────────────────────────────────────

function Spark({ data, color, w = 80, h = 28 }: { data: number[]; color: string; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || data.length < 2) return
    const cv = ref.current, ctx = cv.getContext('2d')!
    cv.width = w; cv.height = h
    ctx.clearRect(0, 0, w, h)
    const mn = Math.min(...data), mx = Math.max(...data), range = mx - mn || 1
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w
      const y = h - ((v - mn) / range) * h
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.stroke()
  }, [data, color, w, h])
  return <canvas ref={ref} style={{ display: 'block' }} />
}

// ── Big market card ───────────────────────────────────────────────────────

function BigCard({ label, card, unit = '', decimals = 2, suffix = '' }: {
  label: string; card?: MarketCard; unit?: string; decimals?: number; suffix?: string
}) {
  if (!card) return <div className="macro-card"><span className="macro-card__label">{label}</span><div className="macro-card__value">—</div></div>
  const col = card.change_pct != null ? (card.change_pct >= 0 ? '#22c55e' : '#ef4444') : '#a1a1aa'
  return (
    <div className="macro-card" style={{ borderColor: card.inverted ? '#f59e0b' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span className="macro-card__label">{label}{card.inverted ? ' ⚠' : ''}</span>
        {card.sparkline?.length > 2 && <Spark data={card.sparkline} color={col} />}
      </div>
      <div className="macro-card__value" style={{ fontSize: 26, marginTop: 4 }}>
        {unit}{fmt(card.value, decimals)}{suffix}
      </div>
      <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: col, marginTop: 2 }}>
        {arrow(card.change_pct)} {chgStr(card.change_pct)}%
        {card.change_abs != null && <span style={{ color: '#71717a', marginLeft: 6 }}>{chgStr(card.change_abs, 3)}</span>}
      </div>
    </div>
  )
}

// ── FRED card ─────────────────────────────────────────────────────────────

function FredTile({ label, card, unit = '%', decimals = 2, invert = false }: {
  label: string; card?: FredCard; unit?: string; decimals?: number; invert?: boolean
}) {
  if (!card) return <div className="macro-card"><span className="macro-card__label">{label}</span><div className="macro-card__value">—</div></div>
  const up = (card.change ?? 0) > 0
  // invert = true means up is bad (e.g. inflation, unemployment)
  const col = card.change == null ? '#a1a1aa' : invert
    ? (up ? '#ef4444' : '#22c55e')
    : (up ? '#22c55e' : '#ef4444')
  return (
    <div className="macro-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span className="macro-card__label">{label}</span>
        {card.sparkline?.length > 2 && <Spark data={card.sparkline} color={col} />}
      </div>
      <div className="macro-card__value" style={{ fontSize: 26, marginTop: 4 }}>
        {fmt(card.value, decimals)}{unit}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--font-mono)', marginTop: 3 }}>
        <span style={{ color: col }}>{arrow(card.change)} {chgStr(card.change, 3)}{unit}</span>
        <span style={{ color: '#52525b' }}>{card.date}</span>
      </div>
      {card.prev != null && (
        <div style={{ fontSize: 10, color: '#52525b', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
          předch. {fmt(card.prev, decimals)}{unit}
        </div>
      )}
    </div>
  )
}

// ── Yield curve visual ────────────────────────────────────────────────────

function YieldCurve({ us2y, us10y, spread }: { us2y?: MarketCard; us10y?: MarketCard; spread?: MarketCard }) {
  const inv = (spread?.value ?? 0) < 0
  const col = inv ? '#ef4444' : '#22c55e'
  return (
    <div className="macro-card" style={{ borderColor: inv ? '#ef4444' : undefined, gridColumn: 'span 1' }}>
      <span className="macro-card__label">VÝNOSOVÁ KŘIVKA 10Y–2Y</span>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, margin: '12px 0 8px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#71717a', marginBottom: 2 }}>2Y</div>
          <div style={{ background: '#3b82f6', width: 36, height: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#fff' }}>{fmt(us2y?.value, 2)}%</span>
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#71717a', marginBottom: 2 }}>10Y</div>
          <div style={{ background: '#6366f1', width: 36, height: Math.max(20, 60 * ((us10y?.value ?? 4) / (us2y?.value ?? 4))), display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#fff' }}>{fmt(us10y?.value, 2)}%</span>
          </div>
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 600, color: col }}>
            {spread?.value != null ? `${spread.value > 0 ? '+' : ''}${fmt(spread.value, 2)}%` : '—'}
          </div>
          <div style={{ fontSize: 11, color: col, marginTop: 2 }}>
            {inv ? '⚠ Inverze křivky' : '✓ Normální křivka'}
          </div>
          <div style={{ fontSize: 10, color: '#52525b', marginTop: 4 }}>
            {inv ? 'Historicky předchází recesi' : 'Trh očekává růst'}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── CPI vs wages chart ────────────────────────────────────────────────────

function CpiWagesChart({ data }: { data: MacroData['cpi_wages_history'] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || !data.dates.length) return
    const chart = echarts.init(ref.current, 'dark')
    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: 24, bottom: 36, left: 44, right: 12 },
      tooltip: { trigger: 'axis', backgroundColor: '#27272a', borderColor: '#3f3f46', textStyle: { color: '#fafafa', fontFamily: 'IBM Plex Mono', fontSize: 11 } },
      legend: { data: ['CPI', 'Mzdy'], top: 2, textStyle: { color: '#a1a1aa', fontSize: 10 } },
      xAxis: { type: 'category', data: data.dates, axisLabel: { color: '#52525b', fontSize: 9, rotate: 30 }, axisLine: { lineStyle: { color: '#27272a' } } },
      yAxis: { type: 'value', axisLabel: { color: '#71717a', fontSize: 9, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#18181b' } } },
      series: [
        { name: 'CPI', type: 'line', data: data.cpi_yoy, smooth: true, lineStyle: { color: '#f59e0b', width: 2 }, itemStyle: { color: '#f59e0b' }, symbol: 'none', areaStyle: { color: 'rgba(245,158,11,0.08)' } },
        { name: 'Mzdy', type: 'line', data: data.wages_yoy, smooth: true, lineStyle: { color: '#22c55e', width: 2 }, itemStyle: { color: '#22c55e' }, symbol: 'none', areaStyle: { color: 'rgba(34,197,94,0.08)' } },
      ],
    })
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.dispose() }
  }, [data])
  return <div ref={ref} style={{ width: '100%', height: 220 }} />
}

// ── Rate expectations ─────────────────────────────────────────────────────

function RateCard({ exp, fedFunds }: { exp: MacroData['rate_expectations']; fedFunds?: FredCard }) {
  const rate = fedFunds?.value ?? exp.current_rate
  const prev = fedFunds?.prev
  return (
    <div className="macro-card">
      <span className="macro-card__label">FED FUNDS RATE</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 600 }}>{rate?.toFixed(2) ?? '—'}%</span>
        {prev != null && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#71717a' }}>předch. {prev.toFixed(2)}%</span>}
      </div>
      {fedFunds?.date && <div style={{ fontSize: 10, color: '#52525b', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{fedFunds.date}</div>}
      {exp.available && exp.cut_probability != null && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.1em', color: '#71717a', marginBottom: 6 }}>NEXT MEETING — FUTURES ODHAD</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { label: 'Snížení', pct: Math.round((exp.cut_probability) * 100),  col: '#22c55e' },
              { label: 'Hold',    pct: Math.round((exp.hold_probability ?? 0) * 100), col: '#a1a1aa' },
              { label: 'Zvýšení', pct: Math.round((exp.hike_probability ?? 0) * 100),  col: '#ef4444' },
            ].map(item => (
              <div key={item.label} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ height: 3, background: item.col, borderRadius: 2, marginBottom: 4, opacity: item.pct > 5 ? 1 : 0.3 }} />
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: item.col }}>{item.pct}%</div>
                <div style={{ fontSize: 8, color: '#71717a', letterSpacing: '0.08em' }}>{item.label.toUpperCase()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────

function Sec({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '18px 0 8px', borderBottom: '1px solid var(--line-faint)', marginBottom: 10 }}>
      <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.18em', color: 'var(--text-secondary)' }}>{title}</span>
      {sub && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{sub}</span>}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────

export function MacroPage() {
  const [data, setData] = useState<MacroData | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetchMacro().then(d => { setData(d); setLoading(false) })
  }, [])

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>Načítám makro data…</div>
  if (!data) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--negative)', fontFamily: 'var(--font-mono)' }}>❌ macro.json nenalezen — spusť workflow</div>

  const m = data.market
  const f = data.fred
  const ts = new Date(data.generated_at).toLocaleString('cs-CZ')
  const realWagePos = (f.wages_yoy?.value ?? 0) > (f.cpi_yoy?.value ?? 0)

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 20px 48px' }}>
      <div style={{ padding: '6px 0 2px', fontSize: 10, color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
        Aktualizováno: {ts}
      </div>

      {/* ── HERO ROW: VIX + velké indexy ── */}
      <Sec title="SENTIMENT & INDEXY" />
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 12, marginBottom: 12 }}>
        {/* VIX gauge */}
        <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--line)', padding: '16px 12px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--text-tertiary)', marginBottom: 8 }}>VIX — INDEX STRACHU</div>
          <VixGauge card={m.vix} />
        </div>
        {/* S&P + NASDAQ + DXY */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <BigCard label="S&P 500"    card={m.sp500}  decimals={0} />
          <BigCard label="NASDAQ"     card={m.nasdaq} decimals={0} />
          <BigCard label="Dolar (DXY)" card={m.dxy}   decimals={3} />
          <BigCard label="EUR/USD"    card={m.eur_usd} decimals={4} />
          <BigCard label="USD/CZK"    card={m.usd_czk} decimals={3} />
          <BigCard label="EUR/CZK"    card={m.eur_czk} decimals={3} />
        </div>
      </div>

      {/* ── DLUHOPISY + YIELD CURVE ── */}
      <Sec title="DLUHOPISY & ÚROKOVÉ SAZBY" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.4fr', gap: 8, marginBottom: 12 }}>
        <BigCard label="US 10Y výnos" card={m.us10y} suffix="%" decimals={3} />
        <BigCard label="US 2Y výnos"  card={m.us2y}  suffix="%" decimals={3} />
        <RateCard exp={data.rate_expectations} fedFunds={f.fed_funds} />
        <YieldCurve us2y={m.us2y} us10y={m.us10y} spread={m.yield_spread} />
      </div>

      {/* ── KOMODITY ── */}
      <Sec title="KOMODITY" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
        <BigCard label="Ropa Brent" card={m.brent} unit="$" decimals={2} />
        <BigCard label="Ropa WTI"   card={m.wti}   unit="$" decimals={2} />
        <BigCard label="Zlato"      card={m.gold}  unit="$" decimals={0} />
      </div>

      {/* ── FRED MAKRO + CPI vs MZDY ── */}
      <Sec title="MAKROEKONOMIKA USA" sub="FRED · aktualizace měsíčně" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        <FredTile label="CPI inflace (YoY)"     card={f.cpi_yoy}      invert />
        <FredTile label="Core CPI (YoY)"        card={f.core_cpi_yoy} invert />
        <FredTile label="PCE inflace (YoY)"     card={f.pce_yoy}      invert />
        <FredTile label="Hodinové mzdy (YoY)"   card={f.wages_yoy} />
        <FredTile label="Nezaměstnanost"        card={f.unemployment} invert />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FredTile label="HDP QoQ (annualized)" card={f.gdp} unit="%" />
        {/* CPI vs mzdy */}
        <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--line)', padding: '12px 16px', gridColumn: 'span 1', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-tertiary)' }}>CPI vs. HODINOVÉ MZDY (YoY %)</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: realWagePos ? '#22c55e' : '#ef4444' }}>
              {realWagePos ? '▲ Reálný příjem roste' : '▼ Ztráta kupní síly'}
            </span>
          </div>
          <CpiWagesChart data={data.cpi_wages_history} />
        </div>
      </div>
    </div>
  )
}
