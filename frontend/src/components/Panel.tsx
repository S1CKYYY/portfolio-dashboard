/**
 * Panel — shadcn-inspired Card with rounded corners and border.
 */
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface PanelProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  padded?: boolean
  className?: string
}

export function Panel({ title, subtitle, actions, children, padded, className }: PanelProps) {
  return (
    <section
      className={cn(
        'flex flex-col rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden',
        className,
      )}
      aria-label={title}
    >
      <header className="flex items-center justify-between px-5 border-b border-zinc-800"
        style={{ minHeight: 'var(--panel-header-height)' }}>
        <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          {title}
          {subtitle && (
            <span className="text-xs font-normal text-zinc-500">{subtitle}</span>
          )}
        </h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className={padded ? 'p-5 flex-1' : 'flex-1'}>{children}</div>
    </section>
  )
}

interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}

export function Segmented<T extends string>({ options, value, onChange, ariaLabel }: SegmentedProps<T>) {
  return (
    <div
      className="flex rounded-md border border-zinc-700 overflow-hidden"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
          className={cn(
            'px-3 py-1 text-xs font-medium transition-colors cursor-pointer',
            option.value === value
              ? 'bg-zinc-700 text-zinc-100'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
