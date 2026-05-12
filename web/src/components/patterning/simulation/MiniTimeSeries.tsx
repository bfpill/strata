import type { Step } from './types'
import { svgPath } from './helpers'
import { tokens } from '@/theme/tokens'

const t = tokens
const SERIES_COLORS = [t.accent.primary, t.text.primary, t.text.secondary, t.text.tertiary, t.stroke.primary, t.stroke.secondary]

export function MiniTimeSeries({ steps, selected, series, height = 170 }: {
  steps: Step[]
  selected: number
  series: Array<{ name: string; data: number[]; color?: string }>
  height?: number
}) {
  const width = 520, pad = 28
  const allValues = series.flatMap(s => s.data).filter(x => Number.isFinite(x))
  const minYRaw = Math.min(...allValues, 0)
  const maxYRaw = Math.max(...allValues, 1)
  const yPad = Math.max(1e-6, 0.08 * (maxYRaw - minYRaw || 1))
  const minY = minYRaw - yPad, maxY = maxYRaw + yPad
  const sx = (i: number) => pad + (i / Math.max(1, steps.length - 1)) * (width - 2 * pad)
  const sy = (v: number) => height - pad - ((v - minY) / (maxY - minY)) * (height - 2 * pad)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }}>
      <rect width={width} height={height} fill={t.bg.editor} />
      <line x1={pad} x2={width - pad} y1={sy(0)} y2={sy(0)} stroke={t.stroke.tertiary} />
      {series.map((s, idx) => {
        const pts = s.data.map((v, i) => [sx(i), sy(v)] as [number, number])
        return <path key={s.name} d={svgPath(pts)} fill="none" stroke={s.color ?? SERIES_COLORS[idx % SERIES_COLORS.length]} strokeWidth={1.8} />
      })}
      <line x1={sx(selected)} x2={sx(selected)} y1={pad} y2={height - pad} stroke={t.accent.primary} strokeDasharray="4 4" />
      <circle cx={sx(selected)} cy={pad} r={4} fill={t.accent.primary} />
      <text x={pad} y={height - 8} fill={t.text.tertiary} fontSize={10}>step</text>
      {series.slice(0, 4).map((s, idx) => (
        <g key={`legend-${s.name}`}>
          <line x1={pad + idx * 110} x2={pad + idx * 110 + 16} y1={14} y2={14} stroke={s.color ?? SERIES_COLORS[idx % SERIES_COLORS.length]} strokeWidth={2} />
          <text x={pad + idx * 110 + 20} y={18} fill={t.text.secondary} fontSize={10}>{s.name}</text>
        </g>
      ))}
    </svg>
  )
}
