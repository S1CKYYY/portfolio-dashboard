/**
 * Risk metrics as a terminal readout.
 */
import {
  formatDate,
  formatMoney,
  formatPercent,
  formatRatio,
  signClass,
  EM_DASH,
} from '../lib/format'
import type { RiskPayload } from '../lib/types'
import { Panel } from './Panel'

interface RiskPanelProps {
  risk: RiskPayload
  currency: string
}

interface Row {
  label: string
  value: string
  meaning: string
  tone?: string
}

function buildRows(risk: RiskPayload, currency: string): Row[] {
  const var95 = risk.value_at_risk['95']
  const var99 = risk.value_at_risk['99']
  const drawdown = risk.max_drawdown
  const beta = risk.beta.value
  const money = (value: number | null) => `${formatMoney(value)} ${currency}`

  const drawdownMeaning = drawdown.peak_date
    ? `Největší pokles od vrcholu ke dnu, ${formatDate(drawdown.peak_date)} – ${formatDate(drawdown.trough_date)}. ` +
      (drawdown.recovery_date
        ? `Zotavení ${formatDate(drawdown.recovery_date)}.`
        : 'Zatím nezotaveno.')
    : 'Ve sledovaném období nebyl zaznamenán žádný pokles.'

  const betaMeaning =
    beta === null
      ? 'Není k dispozici.'
      : `Historicky se portfolio při pohybu indexu ${risk.beta.benchmark_name} o 1 % pohybovalo o ${formatRatio(beta)} %. ` +
        (beta < 1 ? 'Méně reaktivní než index.' : 'Více reaktivní než index.')

  return [
    {
      label: 'Volatility (ann.)',
      value: formatPercent(risk.volatility_annualized_pct),
      meaning: `Směrodatná odchylka denních výnosů, anualizovaná přes ${risk.trading_days_per_year} obchodních dní. Vyšší hodnota znamená širší rozptyl výsledků.`,
    },
    {
      label: 'Downside deviation',
      value: formatPercent(risk.downside_deviation_pct),
      meaning: 'Volatilita počítaná pouze z výnosů pod bezrizikovou sazbou — pozitivní výkyvy nejsou penalizovány.',
    },
    {
      label: 'Sharpe ratio',
      value: formatRatio(risk.sharpe_ratio),
      tone: signClass(risk.sharpe_ratio),
      meaning: `Přebytkový výnos na jednotku celkového rizika, při bezrizikové sazbě ${formatPercent(risk.risk_free_rate, 1)}. Hodnota nad 1,0 je obvykle považována za silnou.`,
    },
    {
      label: 'Sortino ratio',
      value: formatRatio(risk.sortino_ratio),
      tone: signClass(risk.sortino_ratio),
      meaning: 'Přebytkový výnos na jednotku rizika poklesu. Překračuje Sharpe, když jsou ztráty vzácnější než zisky.',
    },
    {
      label: 'Max drawdown',
      value: formatPercent(drawdown.pct),
      tone: signClass(drawdown.pct),
      meaning: drawdownMeaning,
    },
    {
      label: 'VaR 95% (hist.)',
      value: money(var95?.historical_value ?? null),
      tone: 'neg',
      meaning: `V nejhorších 5 % dní portfolio ztratilo nejméně tolik — čteno přímo z pozorovaného rozdělení výnosů (${formatPercent(var95?.historical_pct)} hodnoty).`,
    },
    {
      label: 'VaR 95% (param.)',
      value: money(var95?.parametric_value ?? null),
      tone: 'neg',
      meaning: 'Stejný práh při předpokladu normálního rozdělení výnosů.',
    },
    {
      label: 'VaR 99% (hist.)',
      value: money(var99?.historical_value ?? null),
      tone: 'neg',
      meaning: `Nejhorší 1 % dní (${formatPercent(var99?.historical_pct)} hodnoty). Pokud přesahuje parametrický odhad, skutečné ztráty mají těžší chvosty než normální rozdělení předpokládá.`,
    },
    {
      label: 'VaR 99% (param.)',
      value: money(var99?.parametric_value ?? null),
      tone: 'neg',
      meaning: 'Práh 1 % při normálním rozdělení, uveden pro srovnání.',
    },
    {
      label: `Beta vs ${risk.beta.benchmark_name}`,
      value: formatRatio(beta),
      meaning: betaMeaning,
    },
  ]
}

export function RiskPanel({ risk, currency }: RiskPanelProps) {
  const rows = buildRows(risk, currency)
  return (
    <Panel
      title="Riziko"
      subtitle={`${risk.lookback_days} obchodních dní · rf ${formatPercent(risk.risk_free_rate, 1)}`}
    >
      <table className="readout">
        <caption className="sr-only">
          Metriky rizika s výkladem v přirozeném jazyce, vypočítané za{' '}
          {risk.lookback_days} obchodních dní.
        </caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="readout__label">{row.label}</td>
              <td className={`readout__value num ${row.tone ?? ''}`}>{row.value || EM_DASH}</td>
              <td className="readout__meaning">{row.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}
