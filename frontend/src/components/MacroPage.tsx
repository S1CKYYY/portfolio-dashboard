/**
 * MacroPage — přehled makroekonomické situace.
 * Data z Yahoo Finance (tržní indikátory) + FRED API (inflace, sazby…)
 */
import { useEffect, useRef, useState } from 'react'
import type { MacroData, MarketCard, FredCard } from '../lib/macro-types'
import * as echarts from 'echarts'

// ── Fetch ──────────────────────────────────────────────────────────────────

async function fetchMacro(): Promise<MacroData | null> {
  try {
    const base = import.meta.env.BASE_URL ?? '/'
    const r = await fetch(`${base}macro.json?t=${Date.now()}`)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null || isNaN(v)) return '—'
  return v.toLocaleString('cs-CZ', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function sign(v: number | null | undefined): string {
  if (v == null) return ''
  return v >= 0 ? 'pos' : 'neg'
}

function arrow(v: number | null | undefined): string {
  if (v == null) return ''
  return v > 0 ? '▲' : v < 0 ? '▼' : '→'
}

// ── VIX gauge barva ────────────────────────────────────────────────────────

function vixColor(v: number): string {
  if (v < 15)  return '#22c55e'
  if (v < 20)  return '#84cc16'
  if (v < 25)  return '#f59e0b'
  if (v < 30)  return '#f97316'
  return '#ef4444'
}

// ── MiniSparkline ──────────────────────────────────────────────────────────

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || data.length < 2) return
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width, h = canvas.height
    ctx.clearRect(0, 0, w, h)
    const min = Math.min(...data), max = Math.max(...data)
    const range = max - min || 1
    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w
      const y = h - ((v - min) / range) * h
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.stroke()
  }, [data, color])
  return <canvas ref={ref} width={80} height={28} style={{ display:'block' }} />
}

// ── Market Card ────────────────────────────────────────────────────────────

function MktCard({ label, card, unit = '', decimals = 2, suffix = '' }: {
  label: string; card?: MarketCard; unit?: string; decimals?: number; suffix?: string
}) {
  if (!card) return (
    <div className="macro-card">
      <span className="macro-card__label">{label}</span>
      <span className="macro-card__value">—</span>
    </div>
  )
  const tone = card.change_pct != null ? sign(card.change_pct) : ''
  const col = tone === 'pos' ? '#22c55e' : tone === 'neg' ? '#ef4444' : '#a1a1aa'
  return (
    <div className="macro-card" style={card.inverted ? { borderColor: '#f59e0b' } : undefined}>
      <div className="macro-card__header">
        <span className="macro-card__label">{label}</span>
        {card.state && <span className="macro-card__badge" style={{ color: vixColor(card.value) }}>{card.state}</span>}
        {card.inverted && <span className="macro-card__badge" style={{ color: '#f59e0b' }}>Inverze</span>}
      </div>
      <div className="macro-card__value">
        {unit}{fmt(card.value, decimals)}{suffix}
      </div>
      <div className="macro-card__change" style={{ color: col }}>
        {arrow(card.change_pct)} {card.change_pct != null ? `${card.change_pct > 0 ? '+' : ''}${fmt(card.change_pct, 2)}%` : ''}
        {card.change_abs != null && ` (${card.change_abs > 0 ? '+' : ''}${fmt(card.change_abs, 3)})`}
      </div>
      {card.sparkline.length > 2 && (
        <div style={{ marginTop: 6 }}>
          <MiniSparkline data={card.sparkline} color={col} />
        </div>
      )}
    </div>
  )
}

// ── FRED Card ──────────────────────────────────────────────────────────────

function FredCardUI({ label, card, unit = '%', decimals = 2 }: {
  label: string; card?: FredCard; unit?: string; decimals?: number
}) {
  if (!card) return (
    <div className="macro-card">
      <span className="macro-card__label">{label}</span>
      <span className="macro-card__value">—</span>
    </div>
  )
  const chg = card.change
  const col = chg != null ? (chg > 0 ? '#ef4444' : '#22c55e') : '#a1a1aa'
  // Pro inflaci: vyšší = červená, pro zaměstnanost/growth: záleží
  return (
    <div className="macro-card">
      <div className="macro-card__header">
        <span className="macro-card__label">{label}</span>
        <span className="macro-card__date">{card.date}</span>
      </div>
      <div className="macro-card__value">{fmt(card.value, decimals)}{unit}</div>
      <div className="macro-card__change" style={{ color: col }}>
        {arrow(chg)} {chg != null ? `${chg > 0 ? '+' : ''}${fmt(chg, 3)}${unit}` : ''}
        {card.prev != null && <span style={{ color: '#71717a', marginLeft: 6 }}>předch. {fmt(card.prev, decimals)}{unit}</span>}
      </div>
      {card.sparkline.length > 2 && (
        <div style={{ marginTop: 6 }}>
          <MiniSparkline data={card.sparkline} color={col} />
        </div>
      )}
    </div>
  )
}

// ── CPI vs mzdy graf ───────────────────────────────────────────────────────

function CpiWagesChart({ data }: { data: MacroData['cpi_wages_history'] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || !data.dates.length) return
    const chart = echarts.init(ref.current, 'dark')
    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: 32, bottom: 40, left: 48, right: 16 },
      tooltip: { trigger: 'axis', backgroundColor: '#27272a', borderColor: '#3f3f46', textStyle: { color: '#fafafa', fontFamily: 'IBM Plex Mono' } },
      legend: { data: ['CPI (YoY %)', 'Mzdy (YoY %)'], top: 4, textStyle: { color: '#a1a1aa', fontSize: 11 } },
      xAxis: { type: 'category', data: data.dates, axisLabel: { color: '#71717a', fontSize: 10, rotate: 45 }, axisLine: { lineStyle: { color: '#27272a' } } },
      yAxis: { type: 'value', axisLabel: { color: '#71717a', fontSize: 10, formatter: '{value}%' }, axisLine: { lineStyle: { color: '#27272a' } }, splitLine: { lineStyle: { color: '#18181b' } } },
      series: [
        { name: 'CPI (YoY %)', type: 'line', data: data.cpi_yoy, smooth: true, lineStyle: { color: '#f59e0b', width: 2 }, itemStyle: { color: '#f59e0b' }, symbol: 'none' },
        { name: 'Mzdy (YoY %)', type: 'line', data: data.wages_yoy, smooth: true, lineStyle: { color: '#22c55e', width: 2 }, itemStyle: { color: '#22c55e' }, symbol: 'none' },
      ],
    })
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.dispose() }
  }, [data])
  return <div ref={ref} style={{ width: '100%', height: 260 }} />
}

// ── Rate expectations ──────────────────────────────────────────────────────

function RateWidget({ exp }: { exp: MacroData['rate_expectations'] }) {
  if (!exp.available || exp.cut_probability == null) {
    return (
      <div className="macro-card" style={{ gridColumn: 'span 1' }}>
        <span className="macro-card__label">SAZBY FED</span>
        <div style={{ color: '#71717a', fontSize: 12, marginTop: 8 }}>
          Futures data nedostupná
        </div>
        {exp.current_rate != null && (
          <div className="macro-card__value">{exp.current_rate?.toFixed(2)}%</div>
        )}
      </div>
    )
  }
  const cutPct  = Math.round((exp.cut_probability  ?? 0) * 100)
  const holdPct = Math.round((exp.hold_probability ?? 0) * 100)
  const hikePct = Math.round((exp.hike_probability ?? 0) * 100)
  return (
    <div className="macro-card">
      <span className="macro-card__label">SAZBY FED — NEXT MEETING</span>
      <div className="macro-card__value">{exp.current_rate?.toFixed(2)}%</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
        {[
          { label: 'Snížení', pct: cutPct,  color: '#22c55e' },
          { label: 'Beze změny', pct: holdPct, color: '#a1a1aa' },
          { label: 'Zvýšení',  pct: hikePct, color: '#ef4444' },
        ].map(item => (
          <div key={item.label} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ background: item.color, height: Math.max(4, item.pct * 0.6), borderRadius: 2, marginBottom: 4 }} />
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: item.color }}>{item.pct}%</div>
            <div style={{ fontSize: 9, color: '#71717a', letterSpacing: '0.1em' }}>{item.label.toUpperCase()}</div>
          </div>
        ))}
      </div>
      {exp.implied_rate != null && (
        <div style={{ fontSize: 10, color: '#71717a', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
          Trh implikuje: {exp.implied_rate.toFixed(2)}%
        </div>
      )}
    </div>
  )
}

// ── Section header ─────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '20px 0 10px', borderBottom: '1px solid var(--line-faint)', marginBottom: 12 }}>
      <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.15em', color: 'var(--text-secondary)' }}>{title}</span>
      {subtitle && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{subtitle}</span>}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function MacroPage() {
  const [data, setData] = useState<MacroData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(false)

  useEffect(() => {
    fetchMacro().then(d => {
      if (d) setData(d)
      else setError(true)
      setLoading(false)
    })
  }, [])

  if (loading) return (
    <div style={{ padding: 40, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
      Načítám makro data…
    </div>
  )

  if (error || !data) return (
    <div style={{ padding: 40, color: 'var(--negative)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
      ❌ macro.json nenalezen — spusť workflow pro generování dat.
    </div>
  )

  const m  = data.market
  const f  = data.fred
  const ts = new Date(data.generated_at).toLocaleString('cs-CZ')
  const realWageGrowing =
    (f.wages_yoy?.value ?? 0) > (f.cpi_yoy?.value ?? 0)

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 20px 40px' }}>

      {/* Timestamp */}
      <div style={{ padding: '8px 0', fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
        Aktualizováno: {ts}
      </div>

      {/* ── TRŽNÍ INDIKÁTORY ── */}
      <SectionHeader title="TRŽNÍ INDIKÁTORY" subtitle="Yahoo Finance · denní data" />
      <div className="macro-grid">
        <MktCard label="VIX — Index strachu" card={m.vix} decimals={2} />
        <MktCard label="S&P 500"   card={m.sp500}  decimals={0} />
        <MktCard label="NASDAQ"    card={m.nasdaq} decimals={0} />
        <MktCard label="Dolar (DXY)" card={m.dxy} decimals={3} />
        <MktCard label="EUR/USD"   card={m.eur_usd} decimals={4} />
        <MktCard label="USD/CZK"   card={m.usd_czk} decimals={3} />
        <MktCard label="EUR/CZK"   card={m.eur_czk} decimals={3} />
        <MktCard label="Ropa Brent" card={m.brent} unit="$" decimals={2} />
        <MktCard label="Ropa WTI"  card={m.wti}   unit="$" decimals={2} />
        <MktCard label="Zlato"     card={m.gold}  unit="$" decimals={0} />
        <MktCard label="US 10Y výnos" card={m.us10y} suffix="%" decimals={3} />
        <MktCard label="US 2Y výnos"  card={m.us2y}  suffix="%" decimals={3} />
        <MktCard label="Spread 10Y–2Y" card={m.yield_spread} suffix="%" decimals={3} />
      </div>

      {/* ── FRED MAKRO DATA ── */}
      <SectionHeader title="MAKROEKONOMIKA USA" subtitle="FRED · aktualizace měsíčně" />
      <div className="macro-grid">
        <FredCardUI label="CPI inflace (YoY)"        card={f.cpi_yoy}      />
        <FredCardUI label="Core CPI (YoY)"           card={f.core_cpi_yoy} />
        <FredCardUI label="PCE inflace (YoY)"        card={f.pce_yoy}      />
        <FredCardUI label="Hodinové mzdy (YoY)"      card={f.wages_yoy}    />
        <FredCardUI label="Nezaměstnanost"           card={f.unemployment} />
        <FredCardUI label="Fed Funds Rate"           card={f.fed_funds}    />
        <FredCardUI label="HDP růst (QoQ annualized)" card={f.gdp} unit="%" />
        <RateWidget exp={data.rate_expectations} />
      </div>

      {/* ── CPI vs MZDY ── */}
      <SectionHeader
        title="CPI vs. HODINOVÉ MZDY (YoY %)"
        subtitle={realWageGrowing
          ? '✓ Mzdy rostou rychleji než inflace — reálný příjem roste'
          : '⚠ Inflace > mzdy — ztráta kupní síly'}
      />
      <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--line)', padding: '12px 16px' }}>
        <CpiWagesChart data={data.cpi_wages_history} />
        <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          <span style={{ color: '#f59e0b' }}>
            ● CPI: {f.cpi_yoy?.value != null ? `${f.cpi_yoy.value.toFixed(1)}%` : '—'}
          </span>
          <span style={{ color: '#22c55e' }}>
            ● Mzdy: {f.wages_yoy?.value != null ? `${f.wages_yoy.value.toFixed(1)}%` : '—'}
          </span>
          <span style={{ color: realWageGrowing ? '#22c55e' : '#ef4444', fontWeight: 500 }}>
            Reálný příjem: {f.wages_yoy?.value != null && f.cpi_yoy?.value != null
              ? `${(f.wages_yoy.value - f.cpi_yoy.value) > 0 ? '+' : ''}${(f.wages_yoy.value - f.cpi_yoy.value).toFixed(2)}%`
              : '—'}
          </span>
        </div>
      </div>

    </div>
  )
}
