import type { Step } from './types'
import { W_MIN, W_MAX } from './constants'
import { svgPath, CatastropheGlyph } from './helpers'
import { tokens, palette } from '@/theme/tokens'

const t = tokens

export function BranchDiagram({ steps, selected, target }: {
  steps: Step[]; selected: number; target: number
}) {
  const width = 760, height = 260, pad = 32
  const sx = (i: number) => pad + (i / (steps.length - 1)) * (width - 2 * pad)
  const sy = (w: number) => height - pad - ((w - W_MIN) / (W_MAX - W_MIN)) * (height - 2 * pad)

  const actual: Array<[number, number]> = []
  steps.forEach(s => {
    const pathForStep = s.relaxPath.length > 0 ? s.relaxPath : [s.w]
    pathForStep.forEach((w, j) => {
      const denom = Math.max(1, pathForStep.length - 1)
      actual.push([sx(Math.min(steps.length - 1, s.i + j / denom)), sy(w)])
    })
  })

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }}>
      <title>Branch diagram. Blue dots are stable minima, gray dots are saddles, dark path is tracked w.</title>
      <rect width={width} height={height} fill={t.bg.editor} />
      <line x1={pad} x2={width - pad} y1={sy(0)} y2={sy(0)} stroke={t.stroke.tertiary} />
      <line x1={pad} x2={width - pad} y1={sy(target)} y2={sy(target)} stroke={palette.target} strokeDasharray="5 5" />
      <circle cx={width - pad} cy={sy(target)} r={5} fill={palette.target} />
      {steps.map(s => s.critical.map((p, j) => (
        <circle key={`${s.i}-${j}`} cx={sx(s.i)} cy={sy(p.w)}
          r={p.stable ? 2.5 : 2}
          fill={p.stable ? t.accent.primary : t.text.tertiary}
          opacity={p.stable ? 0.55 : 0.35} />
      )))}
      <path d={svgPath(actual)} fill="none" stroke={t.text.primary} strokeWidth={2.4} />
      {steps.map(s => <circle key={`dot-${s.i}`} cx={sx(s.i)} cy={sy(s.w)} r={3.5} fill={t.text.primary} />)}
      {steps.map(s => s.folded ? <line key={s.i} x1={sx(s.i)} x2={sx(s.i)} y1={pad} y2={height - pad} stroke={t.accent.primary} strokeWidth={1.5} /> : null)}
      {steps.map(s => s.foldType !== 'none' ? (
        <CatastropheGlyph key={`fg-${s.i}`} x={sx(s.i)} y={pad + 12} type={s.foldType} color={t.accent.primary} bg={t.bg.editor} />
      ) : null)}
      <line x1={sx(selected)} x2={sx(selected)} y1={pad} y2={height - pad} stroke={t.text.secondary} strokeDasharray="4 4" />
      <text x={pad} y={height - 8} fill={t.text.tertiary} fontSize={11}>controller step</text>
      <text x={sx(0) + 6} y={pad + 12} fill={t.text.tertiary} fontSize={11}>w</text>
      <text x={pad} y={22} fill={t.text.secondary} fontSize={12}>bundle over trajectory</text>
      {/* legend */}
      <circle cx={width - pad - 180} cy={18} r={3} fill={t.accent.primary} opacity={0.7} />
      <text x={width - pad - 172} y={22} fill={t.text.secondary} fontSize={11}>stable minima</text>
      <circle cx={width - pad - 92} cy={18} r={3} fill={t.text.tertiary} opacity={0.7} />
      <text x={width - pad - 84} y={22} fill={t.text.secondary} fontSize={11}>saddles</text>
      <line x1={width - pad - 180} x2={width - pad - 158} y1={height - 18} y2={height - 18} stroke={t.text.primary} strokeWidth={2.4} />
      <text x={width - pad - 152} y={height - 14} fill={t.text.secondary} fontSize={11}>tracked w</text>
      <CatastropheGlyph x={width - pad - 84} y={height - 18} type="birth" color={t.accent.primary} bg={t.bg.editor} />
      <text x={width - pad - 72} y={height - 14} fill={t.text.secondary} fontSize={11}>birth</text>
      <CatastropheGlyph x={width - pad - 32} y={height - 18} type="death" color={t.accent.primary} bg={t.bg.editor} />
      <text x={width - pad - 20} y={height - 14} fill={t.text.secondary} fontSize={11}>death</text>
    </svg>
  )
}
