import type { Step, ModelConfig, PosteriorMode } from './types'
import { W_MIN, W_MAX } from './constants'
import { loss } from './engine'
import { svgPath } from './helpers'
import { tokens, palette } from '@/theme/tokens'

const t = tokens

export function LossPlot({ step, beta, spring, posteriorMode, target, config }: {
  step: Step; beta: number; spring: number; posteriorMode: PosteriorMode; target: number; config: ModelConfig
}) {
  const width = 560, height = 240, pad = 32
  const xs: number[] = [], ys: number[] = []
  let minY = Infinity, maxY = -Infinity
  for (let i = 0; i < 260; i++) {
    const w = W_MIN + (i / 259) * (W_MAX - W_MIN)
    const y = loss(w, step.a, step.b, config)
    xs.push(w); ys.push(y)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const sortedOffsets = ys.map(y => y - minY).sort((a, b) => a - b)
  const robustHigh = sortedOffsets[Math.floor(0.96 * (sortedOffsets.length - 1))] ?? maxY - minY
  const span = Math.max(0.4, Math.min(maxY - minY, robustHigh * 1.25 || maxY - minY))
  const sx = (w: number) => pad + ((w - W_MIN) / (W_MAX - W_MIN)) * (width - 2 * pad)
  const sy = (y: number) => height - pad - ((Math.min(span, y - minY)) / span) * (height - 2 * pad)
  const curve = xs.map((w, i) => [sx(w), sy(ys[i])] as [number, number])
  const localRadius = posteriorMode === 'local' && spring > 0 ? 1 / Math.sqrt(beta * spring) : 0
  const radiusLeft = Math.max(W_MIN, step.w - localRadius)
  const radiusRight = Math.min(W_MAX, step.w + localRadius)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }}>
      <title>Loss landscape with spring radius and target marker.</title>
      <rect width={width} height={height} fill={t.bg.editor} />
      {posteriorMode === 'local' && (
        <rect x={sx(radiusLeft)} y={pad}
          width={Math.max(1, sx(radiusRight) - sx(radiusLeft))} height={height - 2 * pad}
          fill={t.fill.tertiary} />
      )}
      <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke={t.stroke.tertiary} />
      <line x1={sx(0)} x2={sx(0)} y1={pad} y2={height - pad} stroke={t.stroke.tertiary} />
      <path d={svgPath(curve)} fill="none" stroke={t.text.primary} strokeWidth={2} />
      {step.critical.map((p, j) => (
        <circle key={j} cx={sx(p.w)} cy={sy(loss(p.w, step.a, step.b, config))}
          r={p.stable ? 4 : 3} fill={p.stable ? t.accent.primary : t.text.tertiary} />
      ))}
      <circle cx={sx(step.w)} cy={sy(loss(step.w, step.a, step.b, config))} r={6} fill={t.text.primary} />
      {posteriorMode === 'local' && (
        <line x1={sx(radiusLeft)} x2={sx(radiusRight)}
          y1={sy(loss(step.w, step.a, step.b, config)) + 18}
          y2={sy(loss(step.w, step.a, step.b, config)) + 18}
          stroke={t.accent.primary} strokeWidth={2} />
      )}
      <line x1={sx(target)} x2={sx(target)}
        y1={height - pad} y2={sy(loss(target, step.a, step.b, config))}
        stroke={palette.target} strokeDasharray="4 4" />
      <circle cx={sx(target)} cy={sy(loss(target, step.a, step.b, config))} r={5} fill={palette.target} />
      <text x={pad} y={20} fill={t.text.secondary} fontSize={12}>current loss surface under L(w,h)</text>
      <text x={sx(target) + 7} y={sy(loss(target, step.a, step.b, config)) - 7} fill={palette.target} fontSize={11}>target</text>
      {posteriorMode === 'local' && (
        <text x={width - pad - 170} y={20} fill={t.text.tertiary} fontSize={11}>
          spring radius ~ {localRadius.toFixed(3)}
        </text>
      )}
    </svg>
  )
}
