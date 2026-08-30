/**
 * Allocation breakdowns — třída, region, sektory, měna.
 * Bez grafů, jen tabulky s procentuálními hodnotami.
 */
import { formatMoneyCompact, formatPercent } from '../lib/format'
import { useCurrency } from '../lib/currency'
import type { AllocationBucket } from '../lib/types'
import { Panel } from './Panel'
import { chartTheme } from '../charts/theme'

interface AllocationPanelProps {
  byClass: AllocationBucket[]
  byRegion: AllocationBucket[]
  bySector?: AllocationBucket[]
  byCurrency?: AllocationBucket[]
  currency: string
}

interface BreakdownProps {
  title: string
  buckets: AllocationBucket[]
}

function Breakdown({ title, buckets }: BreakdownProps) {
  const { multiplier } = useCurrency()
  const theme = chartTheme()
  const displayBuckets = buckets.map(b => ({ ...b, value: b.value * multiplier }))
  return (
    <div className="allocation__group">
      <div className="allocation__caption label">{title}</div>
      <table className="allocation__legend">
        <tbody>
          {displayBuckets.map((bucket, index) => (
            <tr key={bucket.key}>
              <td className="allocation__swatch-cell">
                <span
                  className="allocation__swatch"
                  style={{ background: theme.categorical[index % theme.categorical.length] }}
                />
              </td>
              <td className="allocation__key">{bucket.key}</td>
              <td className="allocation__value num">{formatMoneyCompact(bucket.value)}</td>
              <td className="allocation__pct num muted">{formatPercent(bucket.allocation_pct, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AllocationPanel({ byClass, byRegion, bySector, byCurrency }: AllocationPanelProps) {
  const { displayCurrency } = useCurrency()
  return (
    <Panel title="Alokace" subtitle={displayCurrency}>
      <div className="allocation">
        <Breakdown title="Třída aktiv" buckets={byClass} />
        <Breakdown title="Region" buckets={byRegion} />
        {bySector && bySector.length > 0 && (
          <Breakdown title="Sektory" buckets={bySector} />
        )}
        {byCurrency && byCurrency.length > 0 && (
          <Breakdown title="Měna" buckets={byCurrency} />
        )}
      </div>
    </Panel>
  )
}
