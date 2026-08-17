/**
 * React wrapper around TradingView Lightweight Charts.
 *
 * Deliberately restrained, following the library's own house style: thin
 * lines, hairline axes, muted gridlines, no area gradients (a gradient fill is
 * explicitly out of bounds for this design system, so only line series are
 * used), and a crosshair that reports values to the parent for an external
 * readout rather than drawing a floating bubble over the data.
 */

import {
  createChart,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts'
import { useEffect, useRef } from 'react'

import { fromTime } from './series'
import { chartTheme } from './theme'

export interface SeriesSpec {
  /** Stable identity; used as the key in crosshair readouts. */
  id: string
  label: string
  color: string
  data: LineData<Time>[]
  lineWidth?: 1 | 2
  /** Dashed rendering marks a reference series (e.g. the benchmark). */
  dashed?: boolean
}

/** Values under the crosshair, or `null` when the pointer leaves the chart. */
export interface CrosshairState {
  time: string
  values: Record<string, number>
}

interface TimeSeriesChartProps {
  series: SeriesSpec[]
  /** Fixed pixel height. Ignored when `fill` is set. */
  height?: number
  /**
   * Stretch to the remaining height of a `.panel--fill` body instead of taking
   * a fixed height, so charts sharing a row all reach the same baseline.
   */
  fill?: boolean
  /** Formats the right price axis and the crosshair line label. */
  valueFormatter: (value: number) => string
  onCrosshair?: (state: CrosshairState | null) => void
  ariaLabel: string
  /** Draws a horizontal reference line, e.g. zero on a returns view. */
  baselineValue?: number
}

export function TimeSeriesChart({
  series,
  height,
  fill,
  valueFormatter,
  onCrosshair,
  ariaLabel,
  baselineValue,
}: TimeSeriesChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef(new Map<string, ISeriesApi<'Line'>>())

  // Latest props read by the (stable) crosshair handler without re-subscribing.
  const formatterRef = useRef(valueFormatter)
  const crosshairRef = useRef(onCrosshair)
  formatterRef.current = valueFormatter
  crosshairRef.current = onCrosshair

  // Create the chart once. Series are added and removed by the effect below.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Captured here so the cleanup closes over the same Map instance rather
    // than reading `.current` after unmount.
    const seriesMap = seriesRef.current
    const theme = chartTheme()
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: theme.textTertiary,
        fontFamily: theme.fontMono,
        fontSize: 10,
        // Attribution is given in the application footer and the README
        // instead, keeping the plot area free of overlay marks.
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: theme.grid, style: LineStyle.Solid },
        horzLines: { color: theme.grid, style: LineStyle.Solid },
      },
      rightPriceScale: {
        borderColor: theme.axis,
        scaleMargins: { top: 0.12, bottom: 0.08 },
        entireTextOnly: true,
      },
      timeScale: {
        borderColor: theme.axis,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: theme.crosshair,
          width: 1,
          style: LineStyle.Dotted,
          labelBackgroundColor: theme.surfaceRaised,
        },
        horzLine: {
          color: theme.crosshair,
          width: 1,
          style: LineStyle.Dotted,
          labelBackgroundColor: theme.surfaceRaised,
        },
      },
      localization: {
        priceFormatter: (price: number) => formatterRef.current(price),
      },
      handleScale: { axisPressedMouseMove: false },
    })

    chart.subscribeCrosshairMove((params: MouseEventParams<Time>) => {
      const report = crosshairRef.current
      if (!report) return

      if (!params.time || !params.point) {
        report(null)
        return
      }

      const values: Record<string, number> = {}
      for (const [id, api] of seriesMap) {
        const point = params.seriesData.get(api) as LineData<Time> | undefined
        if (point && typeof point.value === 'number') values[id] = point.value
      }
      report({ time: fromTime(params.time), values })
    })

    chartRef.current = chart
    return () => {
      chart.remove()
      chartRef.current = null
      seriesMap.clear()
    }
  }, [])

  // Reconcile series: update in place where possible, add/remove on change.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const theme = chartTheme()
    const present = new Set(series.map((spec) => spec.id))

    for (const [id, api] of seriesRef.current) {
      if (!present.has(id)) {
        chart.removeSeries(api)
        seriesRef.current.delete(id)
      }
    }

    series.forEach((spec) => {
      let api = seriesRef.current.get(spec.id)
      if (!api) {
        api = chart.addSeries(LineSeries, { priceLineVisible: false, lastValueVisible: false })
        seriesRef.current.set(spec.id, api)
      }
      api.applyOptions({
        color: spec.color,
        lineWidth: spec.lineWidth ?? 2,
        lineStyle: spec.dashed ? LineStyle.Dashed : LineStyle.Solid,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
        crosshairMarkerBorderColor: theme.surface,
        crosshairMarkerBackgroundColor: spec.color,
      })
      api.setData(spec.data)
    })

    chart.timeScale().fitContent()
  }, [series])

  // Baseline drawn as a price line on the first series (zero on returns views).
  useEffect(() => {
    const first = series[0] && seriesRef.current.get(series[0].id)
    if (!first || baselineValue === undefined) return

    const theme = chartTheme()
    const line = first.createPriceLine({
      price: baselineValue,
      color: theme.lineStrong,
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: false,
      title: '',
    })
    return () => {
      first.removePriceLine(line)
    }
  }, [series, baselineValue])

  return (
    <div
      ref={hostRef}
      className={fill ? 'chart chart--fill' : 'chart'}
      style={fill ? undefined : { height }}
      role="img"
      aria-label={ariaLabel}
      onMouseLeave={() => crosshairRef.current?.(null)}
    />
  )
}
