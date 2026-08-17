/**
 * Minimal React wrapper around Apache ECharts.
 *
 * Only the chart types and components this dashboard uses are registered, so
 * tree shaking keeps the ECharts bundle to a fraction of the full library.
 *
 * The wrapper owns the imperative lifecycle - init, option updates, resize and
 * disposal - so panels only ever describe *what* to draw.
 */

import { BarChart, CustomChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts'
import {
  GraphicComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'
import type { EChartsOption } from 'echarts'

echarts.use([
  BarChart,
  CustomChart,
  HeatmapChart,
  LineChart,
  PieChart,
  GraphicComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
])

interface EChartProps {
  option: EChartsOption
  /** CSS height of the chart host; the width always fills the parent. */
  height: number | string
  /** Accessible description, since a canvas conveys nothing to a screen reader. */
  ariaLabel: string
  className?: string
}

export function EChart({ option, height, ariaLabel, className }: EChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  // Init once, and keep the instance alive across option changes.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const chart = echarts.init(host, undefined, { renderer: 'canvas' })
    chartRef.current = chart

    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(host)

    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  // `notMerge` avoids stale series lingering when a panel switches datasets.
  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true, lazyUpdate: true })
  }, [option])

  return (
    <div
      ref={hostRef}
      className={className ? `chart ${className}` : 'chart'}
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    />
  )
}
