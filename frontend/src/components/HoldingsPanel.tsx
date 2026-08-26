/**
 * Dense, sortable holdings grid built on TanStack Table.
 */
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { useMemo } from 'react'
import {
  formatMoney,
  formatMoneySigned,
  formatPercent,
  formatPercentSigned,
  formatPrice,
  formatQuantity,
  signClass,
} from '../lib/format'
import type { Holding } from '../lib/types'
import { Panel } from './Panel'
import { Sparkline } from './Sparkline'

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    text: sortFn_text,
  },
})

const column = createColumnHelper<typeof features, Holding>()

function Num({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return <span className={tone ? `num ${tone}` : 'num'}>{children}</span>
}

function SortCaret({ direction }: { direction: false | 'asc' | 'desc' }) {
  if (!direction) return null
  return (
    <svg className="grid__caret" width="7" height="4" viewBox="0 0 7 4" aria-hidden="true">
      <path d={direction === 'asc' ? 'M0 4 L3.5 0 L7 4 Z' : 'M0 0 L3.5 4 L7 0 Z'} fill="currentColor" />
    </svg>
  )
}

const columns = column.columns([
  column.accessor('ticker', {
    header: 'Ticker',
    sortFn: 'text',
    cell: (info) => <span className="num grid__ticker">{info.getValue()}</span>,
  }),
  column.accessor('name', {
    header: 'Název',
    sortFn: 'text',
    cell: (info) => <span className="grid__name">{info.getValue()}</span>,
  }),
  column.accessor('asset_class', {
    header: 'Třída',
    sortFn: 'text',
    cell: (info) => <span className="grid__tag">{info.getValue()}</span>,
  }),
  column.accessor('region', {
    header: 'Region',
    sortFn: 'text',
    cell: (info) => <span className="grid__tag">{info.getValue()}</span>,
  }),
  column.accessor('quantity', {
    header: 'Počet',
    sortFn: 'basic',
    meta: { align: 'right' },
    cell: (info) => <Num>{formatQuantity(info.getValue())}</Num>,
  }),
  column.accessor('price_base', {
    header: 'Cena',
    sortFn: 'basic',
    meta: { align: 'right' },
    cell: (info) => {
      const holding = info.row.original
      const title =
        holding.currency === 'EUR'
          ? undefined
          : `${formatPrice(holding.price_native, holding.currency)} v původní měně`
      return (
        <span className="num" title={title}>
          {formatMoney(info.getValue())}
        </span>
      )
    },
  }),
  column.accessor('value_base', {
    header: 'Hodnota',
    sortFn: 'basic',
    meta: { align: 'right' },
    cell: (info) => <Num tone="grid__strong">{formatMoney(info.getValue())}</Num>,
  }),
  column.accessor('allocation_pct', {
    header: 'Váha',
    sortFn: 'basic',
    meta: { align: 'right' },
    cell: (info) => {
      const weight = info.getValue()
      const heaviest = info.table.options.data.reduce(
        (max, holding) => Math.max(max, holding.allocation_pct),
        0,
      )
      const share = heaviest > 0 ? (weight / heaviest) * 100 : 0
      return (
        <span className="grid__weight">
          <span className="num">{formatPercent(weight, 1)}</span>
          <span className="grid__weight-bar" style={{ width: `${share}%` }} />
        </span>
      )
    },
  }),
  column.accessor('unrealized_pnl', {
    header: 'Nerealizovaný P&L',
    sortFn: 'basic',
    meta: { align: 'right' },
    cell: (info) => <Num tone={signClass(info.getValue())}>{formatMoneySigned(info.getValue())}</Num>,
  }),
  column.accessor('unrealized_pnl_pct', {
    header: 'P&L %',
    sortFn: 'basic',
    meta: { align: 'right' },
    cell: (info) => <Num tone={signClass(info.getValue())}>{formatPercentSigned(info.getValue())}</Num>,
  }),
  column.accessor('day_change_pct', {
    header: 'Den',
    sortFn: 'basic',
    meta: { align: 'right' },
    cell: (info) => <Num tone={signClass(info.getValue())}>{formatPercentSigned(info.getValue())}</Num>,
  }),
  column.display({
    id: 'sparkline',
    header: '90D',
    cell: (info) => (
      <Sparkline
        values={info.row.original.sparkline}
        width={84}
        height={18}
        ariaLabel={`${info.row.original.ticker} cena za posledních 90 obchodních dní`}
      />
    ),
  }),
])

interface HoldingsPanelProps {
  holdings: Holding[]
  totalValue: number
  currency: string
}

export function HoldingsPanel({ holdings, totalValue, currency }: HoldingsPanelProps) {
  const table = useTable({
    features,
    columns,
    data: holdings,
    initialState: { sorting: [{ id: 'value_base', desc: true }] },
  })

  const totalPnl = useMemo(
    () => holdings.reduce((sum, holding) => sum + holding.unrealized_pnl, 0),
    [holdings],
  )

  return (
    <Panel title="Pozice" subtitle={`${holdings.length} pozic · hodnoty v ${currency}`}>
      <div className="grid__scroll">
        <table className="grid">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const align = (header.column.columnDef.meta as { align?: string } | undefined)?.align
                  const sorted = header.column.getIsSorted()
                  const sortable = header.column.getCanSort()
                  return (
                    <th
                      key={header.id}
                      data-column={header.column.id}
                      className={align === 'right' ? 'grid__th grid__th--right' : 'grid__th'}
                      aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          className="grid__sort"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          <SortCaret direction={sorted} />
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="grid__row">
                {row.getAllCells().map((cell) => {
                  const align = (cell.column.columnDef.meta as { align?: string } | undefined)?.align
                  return (
                    <td
                      key={cell.id}
                      data-column={cell.column.id}
                      className={align === 'right' ? 'grid__td grid__td--right' : 'grid__td'}
                    >
                      <table.FlexRender cell={cell} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="grid__total">
              <td className="grid__td" colSpan={6}>
                Celkem
              </td>
              <td className="grid__td grid__td--right">
                <Num tone="grid__strong">{formatMoney(totalValue)}</Num>
              </td>
              <td className="grid__td grid__td--right">
                <Num>{formatPercent(1, 1)}</Num>
              </td>
              <td className="grid__td grid__td--right">
                <Num tone={signClass(totalPnl)}>{formatMoneySigned(totalPnl)}</Num>
              </td>
              <td className="grid__td" colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  )
}
