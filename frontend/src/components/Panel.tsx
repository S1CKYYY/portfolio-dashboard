/**
 * The dashboard's only container primitive.
 *
 * A panel is a flat region with a hairline-separated header. It has no border,
 * no shadow and no radius - separation comes from the 1px grid gaps in
 * layout.css. See tokens.css for the reasoning.
 */

import type { ReactNode } from 'react'

interface PanelProps {
  title: string
  /** Secondary context shown beside the title, e.g. a units note. */
  subtitle?: string
  /** Controls aligned to the right of the header, e.g. a range toggle. */
  actions?: ReactNode
  children: ReactNode
  /** Adds standard padding to the body; omit for edge-to-edge tables/charts. */
  padded?: boolean
  className?: string
}

export function Panel({ title, subtitle, actions, children, padded, className }: PanelProps) {
  return (
    <section className={className ? `panel ${className}` : 'panel'} aria-label={title}>
      <header className="panel__header">
        <h2 className="panel__title">
          {title}
          {subtitle ? <span className="panel__subtitle">{subtitle}</span> : null}
        </h2>
        {actions ? <div className="panel__actions">{actions}</div> : null}
      </header>
      <div className={padded ? 'panel__body panel__body--pad' : 'panel__body'}>{children}</div>
    </section>
  )
}

interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}

/** Flat, square segmented control used for range and view toggles. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__option"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
