/**
 * Underwater chart: how far below its running peak the portfolio has been.
 */
import { useMemo, useState } from 'react'
import { toLineData } from '../charts/series'
import { chartTheme } from '../charts/theme'
import { TimeSeriesChart, type CrosshairState } from '../charts/TimeSeriesChart'
import { formatDate, formatPercent } from '../lib/format'
import { MOTION } from '../lib/motion'
import type { HistoryPayload, RiskPayload } from '../lib/types'
import { Panel } from './Panel'

interface DrawdownPanelProps {
  history: HistoryPayload
  risk: RiskPayload
}

export function DrawdownPanel({ history, risk }: DrawdownPanelProps) {
  const theme = chartTheme()
  const [crosshair, setCrosshair] = useState<CrosshairState | null>(null)
  const series = useMemo(
    () => [
      {
        id: 'drawdown',
        label: 'Drawdown',
        color: theme.negative,
        lineWidth: 1 as const,
        data: toLineData(history.dates, history.drawdown_pct),
      },
    ],
    [history, theme],
  )
  const current = history.drawdown_pct[history.drawdown_pct.length - 1]
  const hovered = crosshair?.values.drawdown
  const shown = hovered ?? current
  const drawdown = risk.max_drawdown
  const recovery = drawdown.recovery_date
    ? `zotavení ${formatDate(drawdown.recovery_date)}`
    : 'zatím nezotaveno'

  return (
    <Panel title="Drawdown" subtitle="pod průběžným maximem" className="panel--fill">
      <div className="drawdown">
        <div className="drawdown__legend">
          <span className="drawdown__current">
            <span className="drawdown__caption">
              {crosshair ? formatDate(crosshair.time) : 'Aktuální'}
            </span>
            <span className={`num drawdown__value ${shown && shown < -0.0001 ? 'neg' : ''}`}>
              {formatPercent(shown)}
            </span>
          </span>
          <span className="drawdown__worst">
            <span className="drawdown__caption">Nejhorší</span>
            <span className="num neg">{formatPercent(drawdown.pct)}</span>
            <span className="drawdown__caption">
              {formatDate(drawdown.trough_date)} · {recovery}
            </span>
          </span>
        </div>
        <TimeSeriesChart
          series={series}
          fill
          revealOnMount
          revealDelay={MOTION.stagger * 4}
          valueFormatter={(value) => formatPercent(value, 1)}
          onCrosshair={setCrosshair}
          baselineValue={0}
          ariaLabel="Drawdown portfolia od průběžného maxima za celou historii"
        />
      </div>
    </Panel>
  )
}
