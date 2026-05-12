import type { ReactNode, CSSProperties } from 'react'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

// ── Stack ────────────────────────────────────────────────────────────

export function Stack({ gap = 8, children, className = '', style }: {
  gap?: number
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={`flex flex-col ${className}`} style={{ gap, ...style }}>
      {children}
    </div>
  )
}

// ── Row ──────────────────────────────────────────────────────────────

export function Row({ gap = 8, children, justify, align, wrap, className = '' }: {
  gap?: number
  children: ReactNode
  justify?: 'start' | 'end' | 'center' | 'space-between'
  align?: 'start' | 'end' | 'center' | 'baseline' | 'stretch'
  wrap?: boolean
  className?: string
}) {
  const justifyMap = { start: 'justify-start', end: 'justify-end', center: 'justify-center', 'space-between': 'justify-between' }
  const alignMap = { start: 'items-start', end: 'items-end', center: 'items-center', baseline: 'items-baseline', stretch: 'items-stretch' }
  return (
    <div
      className={`flex ${wrap ? 'flex-wrap' : ''} ${justify ? justifyMap[justify] : ''} ${align ? alignMap[align] : ''} ${className}`}
      style={{ gap }}
    >
      {children}
    </div>
  )
}

// ── Grid ─────────────────────────────────────────────────────────────

export function Grid({ columns = 1, gap = 8, align, children, className = '' }: {
  columns?: number | string
  gap?: number
  align?: 'start' | 'end' | 'center' | 'stretch'
  children: ReactNode
  className?: string
}) {
  const alignMap = { start: 'items-start', end: 'items-end', center: 'items-center', stretch: 'items-stretch' }
  const gridCols = typeof columns === 'number' ? `repeat(${columns}, minmax(0, 1fr))` : columns
  return (
    <div
      className={`grid ${align ? alignMap[align] : ''} ${className}`}
      style={{ gridTemplateColumns: gridCols, gap }}
    >
      {children}
    </div>
  )
}

// ── Card ─────────────────────────────────────────────────────────────

export function Card({ children, collapsible, defaultOpen = true }: {
  children: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      {collapsible
        ? <CollapsibleWrapper open={open} onToggle={() => setOpen(o => !o)}>{children}</CollapsibleWrapper>
        : children}
    </div>
  )
}

function CollapsibleWrapper({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  const childArray = Array.isArray(children) ? children : [children]
  const header = childArray[0]
  const body = childArray.slice(1)
  return (
    <>
      <div onClick={onToggle} className="cursor-pointer">
        {header}
        <div className="px-4 pb-1">
          <ChevronDown size={14} className={`text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </div>
      {open && body}
    </>
  )
}

export function CardHeader({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pt-3 pb-2">
      <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{children}</h3>
      {trailing}
    </div>
  )
}

export function CardBody({ children }: { children: ReactNode }) {
  return <div className="px-4 pb-4">{children}</div>
}

// ── Pill ─────────────────────────────────────────────────────────────

export function Pill({ children, active, onClick, size = 'md' }: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  size?: 'sm' | 'md'
}) {
  const sizeClasses = size === 'sm' ? 'text-[11px] px-2.5 py-0.5' : 'text-xs px-3 py-1'
  return (
    <button
      onClick={onClick}
      className={`rounded-full font-medium transition-colors ${sizeClasses} ${
        active
          ? 'bg-zinc-900 text-white'
          : 'bg-zinc-100 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

// ── Toggle ───────────────────────────────────────────────────────────

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-[18px] rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-zinc-300'}`}
    >
      <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${checked ? 'left-[16px]' : 'left-[2px]'}`} />
    </button>
  )
}

// ── Stat ─────────────────────────────────────────────────────────────

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-sm font-mono font-semibold text-zinc-900">{value}</p>
      <p className="text-[10px] text-zinc-500 mt-0.5">{label}</p>
    </div>
  )
}
