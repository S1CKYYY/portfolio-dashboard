/**
 * Monte Carlo outcome distribution.
 */
import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { EChart } from '../charts/EChart'
import { axisLabelStyle, chartTheme, tooltipStyle } from '../charts/theme'
import {
  formatDate,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  formatPercentSigned,
  signClass,
} from '../lib/format'
import type { MonteCarloPayload } from '../lib/types'
import { Panel } from './Panel'

interface MonteCarloPanelProps {
  montecarlo: MonteCarloPayload
  currency: string
}

function delta(upper: number[], lower: number[]): number[] {
  return upper.map((value, index) => value - lower[index])
}

function fanOption(mc: MonteCarloPayload, currency: string): EChartsOption {
  const theme = chartTheme()
  const { p5, p25, p50, p75, p95 } = mc.percentile_bands
  const invisible = {
    type: 'line' as const,
    stack: 'fan',
    showSymbol: false,
    lineStyle: { opacity: 0 },
    silent: true,
  }
  const band = (color: string) => ({
    ...invisible,
    areaStyle: { color, opacity: 1 },
  })
  return {
    animation: true,
    animationDuration: 1100,
    animationEasing: 'cubicOut',
    animationDelay: 260,
    grid: { left: 62, right: 14, top: 16, bottom: 30 },
    tooltip: {
      ...tooltipStyle(),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: theme.crosshair, width: 1, type: 'dotted' } },
      formatter: (params: unknown) => {
        const points = params as { dataIndex: number }[]
        if (!points?.length) return ''
        const index = points[0].dataIndex
        const rows: [string, number][] = [
          ['p95', p95[index]],
          ['p75', p75[index]],
          ['p50', p50[index]],
          ['p25', p25[index]],
          ['p5', p5[index]],
        ]
        const header = `${formatDate(mc.dates[index])}  ·  den ${index}`
        const body = rows
          .map(([label, value]) => `${label.padEnd(4)} ${formatMoneyCompact(value)}`)
          .join('<br/>')
        return `${header}<br/>${body}`
      },
    },
    xAxis: {
      type: 'category',
      data: mc.dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: theme.axis } },
      axisTick: { show: false },
      axisLabel: {
        ...axisLabelStyle(),
        interval: Math.floor(mc.dates.length / 6),
        formatter: (value: string) => value.slice(0, 7),
      },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLine: { show: false },
      splitLine: { lineStyle: { color: theme.grid } },
      axisLabel: { ...axisLabelStyle(), formatter: (value: number) => formatMoneyCompact(value) },
    },
    series: [
      { ...invisible, name: 'p5-base', data: p5, areaStyle: { opacity: 0 } },
      { ...band(theme.band), name: 'p5-p25', data: delta(p25, p5) },
      { ...band(theme.bandInner), name: 'p25-p50', data: delta(p50, p25) },
      { ...band(theme.bandInner), name: 'p50-p75', data: delta(p75, p50) },
      { ...band(theme.band), name: 'p75-p95', data: delta(p95, p75) },
      {
        type: 'line',
        name: 'median',
        data: p50,
        showSymbol: false,
        lineStyle: { color: theme.accent, width: 2 },
        z: 3,
        markLine: {
          silent: true,
          symbol: 'none',
          label: {
            formatter: 'dnes',
            color: theme.textTertiary,
            fontFamily: theme.fontMono,
            fontSize: 9,
            position: 'insideEndTop',
          },
          lineStyle: { color: theme.lineStrong, width: 1, type: 'solid' },
          data: [{ yAxis: mc.start_value }],
        },
      },
    ],
    aria: { enabled: true, label: { description: `Simulovaná hodnota portfolia v ${currency}` } },
  }
}

function histogramOption(mc: MonteCarloPayload): EChartsOption {
  const theme = chartTheme()
  const labels = mc.histogram.map((bin) => bin.start)
  const breakEven = mc.histogram.findIndex(
    (bin) => mc.start_value >= bin.start && mc.start_value < bin.end,
  )
  return {
    animation: true,
    animationDuration: 520,
    animationEasing: 'cubicOut',
    animationDelay: (index: number) => 300 + index * 9,
    grid: { left: 8, right: 12, top: 12, bottom: 26, containLabel: true },
    tooltip: {
      ...tooltipStyle(),
      trigger: 'axis',
      axisPointer: { type: 'none' },
      formatter: (params: unknown) => {
        const points = params as { dataIndex: number }[]
        if (!points?.length) return ''
        const bin = mc.histogram[points[0].dataIndex]
        return `${formatMoneyCompact(bin.start)} – ${formatMoneyCompact(bin.end)}<br/>${formatPercent(bin.probability, 2)} scénářů`
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: theme.axis } },
      axisTick: { show: false },
      axisLabel: {
        ...axisLabelStyle(),
        interval: Math.floor(labels.length / 3),
        formatter: (value: string) => formatMoneyCompact(Number(value)),
      },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: theme.grid } },
      axisLabel: { show: false },
    },
    series: [
      {
        type: 'bar',
        data: mc.histogram.map((bin) => bin.probability),
        barCategoryGap: '8%',
        itemStyle: { color: theme.accentDim },
        markLine:
          breakEven >= 0
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: { color: theme.textTertiary, width: 1, type: 'dashed' },
                label: { show: false },
                data: [{ xAxis: breakEven }],
              }
            : undefined,
      },
    ],
  }
}

export function MonteCarloPanel({ montecarlo, currency }: MonteCarloPanelProps) {
  const fan = useMemo(() => fanOption(montecarlo, currency), [montecarlo, currency])
  const subtitle = `${montecarlo.paths.toLocaleString('cs-CZ')} scénářů · ${montecarlo.horizon_days} obchodních dní`
  return (
    <Panel title="Monte Carlo" subtitle={subtitle} className="panel--fill">
      <div className="montecarlo">
        <div className="montecarlo__legend">
          <span className="montecarlo__legend-item">
            <span className="montecarlo__key montecarlo__key--outer" aria-hidden="true" />
            5. – 95. percentil
          </span>
          <span className="montecarlo__legend-item">
            <span className="montecarlo__key montecarlo__key--inner" aria-hidden="true" />
            25. – 75. percentil
          </span>
          <span className="montecarlo__legend-item">
            <span className="montecarlo__key montecarlo__key--median" aria-hidden="true" />
            medián
          </span>
        </div>
        <EChart
          option={fan}
          fill
          ariaLabel={`Simulovaná hodnota portfolia za příštích ${montecarlo.horizon_days} obchodních dní`}
        />
      </div>
    </Panel>
  )
}

export function OutcomeDistributionPanel({ montecarlo, currency }: MonteCarloPanelProps) {
  const histogram = useMemo(() => histogramOption(montecarlo), [montecarlo])
  const lossProbability = montecarlo.probability_below_start_pct
  return (
    <Panel title="Výsledky" subtitle={`konečná hodnota, ${currency}`}>
      <div className="montecarlo__aside">
        <EChart
          option={histogram}
          height={132}
          ariaLabel="Histogram simulovaných hodnot portfolia po jednom roce"
        />
        <table className="readout montecarlo__summary">
          <tbody>
            <tr>
              <td className="readout__label">Střední hodnota</td>
              <td className="readout__value num">{formatMoney(montecarlo.expected_value)}</td>
            </tr>
            <tr>
              <td className="readout__label">Medián (p50)</td>
              <td className="readout__value num">{formatMoney(montecarlo.median_value)}</td>
            </tr>
            <tr>
              <td className="readout__label">Očekávaný výnos</td>
              <td className={`readout__value num ${signClass(montecarlo.expected_return_pct)}`}>
                {formatPercentSigned(montecarlo.expected_return_pct)}
              </td>
            </tr>
            <tr>
              <td className="readout__label">P(ztráta)</td>
              <td className={`readout__value num ${lossProbability > 0.5 ? 'neg' : ''}`}>
                {formatPercent(lossProbability, 1)}
              </td>
            </tr>
            <tr>
              <td className="readout__label">Nejhorších 5%</td>
              <td className="readout__value num neg">{formatMoney(montecarlo.final_values.p5)}</td>
            </tr>
            <tr>
              <td className="readout__label">Nejlepších 5%</td>
              <td className="readout__value num pos">{formatMoney(montecarlo.final_values.p95)}</td>
            </tr>
          </tbody>
        </table>
        <p className="montecarlo__assumptions">
          {montecarlo.assumptions.distribution}, {montecarlo.assumptions.correlation}, kalibrováno na{' '}
          {montecarlo.assumptions.lookback_days} obchodních dnech. Rebalancování:{' '}
          {montecarlo.assumptions.rebalancing}. Minulé rozložení nezaručuje budoucí výsledky.
        </p>
      </div>
    </Panel>
  )
}
