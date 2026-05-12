import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { register } from '@/registry'

export interface MetricCardProps {
  label: string
  value: number | string
  delta?: number
  unit?: string
  description?: string
}

export function MetricCardComponent({ label, value, delta, unit, description }: MetricCardProps) {
  const formatted = typeof value === 'number'
    ? value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K`
    : Number.isInteger(value) ? String(value) : value.toFixed(2)
    : value

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5">
      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-zinc-900 font-mono">{formatted}</span>
        {unit && <span className="text-sm text-zinc-500">{unit}</span>}
      </div>
      {delta != null && (
        <div className={`mt-2 flex items-center gap-1 text-sm ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-zinc-500'}`}>
          {delta > 0 ? <TrendingUp size={14} /> : delta < 0 ? <TrendingDown size={14} /> : <Minus size={14} />}
          <span>{delta > 0 ? '+' : ''}{delta.toFixed(1)}%</span>
        </div>
      )}
      {description && <p className="mt-2 text-xs text-zinc-500">{description}</p>}
    </div>
  )
}

register<MetricCardProps>({
  id: 'metric-card',
  name: 'Metric Card',
  category: 'data-display',
  description: 'Single KPI card with value, optional trend delta, and unit',
  tags: ['metric', 'kpi', 'stat'],
  schema: {
    fields: [
      { name: 'label', type: 'string', required: true, description: 'Metric label' },
      { name: 'value', type: 'number', required: true, description: 'Metric value' },
      { name: 'delta', type: 'number', description: 'Percentage change' },
      { name: 'unit', type: 'string', description: 'Unit label' },
      { name: 'description', type: 'string', description: 'Additional context' },
    ],
  },
  component: MetricCardComponent,
  sampleData: {
    label: 'Training Loss',
    value: 0.0342,
    delta: -12.4,
    description: 'Cross-entropy loss on validation set',
  },
})
