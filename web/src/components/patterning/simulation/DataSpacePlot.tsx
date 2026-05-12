import type { Step, ModelConfig } from './types'
import { PLOT_A_MIN, PLOT_A_MAX, PLOT_B_MIN, PLOT_B_MAX } from './constants'
import { foldMargin } from './engine'
import { svgPath, CatastropheGlyph } from './helpers'
import { tokens } from '@/theme/tokens'

const t = tokens

export function DataSpacePlot({ steps, selected, config }: {
  steps: Step[]; selected: number; config: ModelConfig
}) {
  const width = 560, height = 260, pad = 32
  const pathAMin = Math.min(...steps.map(s => s.a))
  const pathAMax = Math.max(...steps.map(s => s.a))
  const pathBMin = Math.min(...steps.map(s => s.b))
  const pathBMax = Math.max(...steps.map(s => s.b))
  const rawAMin = Math.min(PLOT_A_MIN, pathAMin)
  const rawAMax = Math.max(PLOT_A_MAX, pathAMax)
  const rawBMin = Math.min(PLOT_B_MIN, pathBMin)
  const rawBMax = Math.max(PLOT_B_MAX, pathBMax)
  const aPad = Math.max(0.18, 0.12 * (rawAMax - rawAMin))
  const bPad = Math.max(0.18, 0.12 * (rawBMax - rawBMin))
  const viewAMin = rawAMin - aPad, viewAMax = rawAMax + aPad
  const viewBMin = rawBMin - bPad, viewBMax = rawBMax + bPad
  const sx = (a: number) => pad + ((a - viewAMin) / (viewAMax - viewAMin)) * (width - 2 * pad)
  const sy = (b: number) => height - pad - ((b - viewBMin) / (viewBMax - viewBMin)) * (height - 2 * pad)

  const cuspTop: Array<[number, number]> = [], cuspBot: Array<[number, number]> = []
  for (let i = 0; i <= 140; i++) {
    const cuspAMin = Math.min(viewAMin, 0), cuspAMax = Math.min(0, viewAMax)
    const a = cuspAMin + ((cuspAMax - cuspAMin) * i) / 140
    const p = (config.quadraticScale * a) / config.quartic
    const q = Math.sqrt(Math.max(0, (-4 * p ** 3) / 27))
    cuspTop.push([sx(a), sy(config.quartic * q - config.bias)])
    cuspBot.push([sx(a), sy(-config.quartic * q - config.bias)])
  }

  const cells = []
  for (let ix = 0; ix < 36; ix++) {
    for (let iy = 0; iy < 28; iy++) {
      const a = viewAMin + ((ix + 0.5) / 36) * (viewAMax - viewAMin)
      const b = viewBMin + ((iy + 0.5) / 28) * (viewBMax - viewBMin)
      if (a < 0 && foldMargin(a, b, config) < 0) {
        cells.push(
          <rect key={`${ix}-${iy}`}
            x={sx(viewAMin + (ix / 36) * (viewAMax - viewAMin))}
            y={sy(viewBMin + ((iy + 1) / 28) * (viewBMax - viewBMin))}
            width={(width - 2 * pad) / 36 + 0.5} height={(height - 2 * pad) / 28 + 0.5}
            fill={t.fill.tertiary} />
        )
      }
    }
  }

  const trajectory = steps.map(s => [sx(s.a), sy(s.b)] as [number, number])
  const current = steps[selected]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }}>
      <title>Data-space plot. The shaded region has two stable local minima.</title>
      <rect width={width} height={height} fill={t.bg.editor} />
      {cells}
      <line x1={pad} x2={width - pad} y1={sy(0)} y2={sy(0)} stroke={t.stroke.tertiary} />
      <line x1={sx(0)} x2={sx(0)} y1={pad} y2={height - pad} stroke={t.stroke.tertiary} />
      <path d={svgPath(cuspTop)} fill="none" stroke={t.accent.primary} strokeWidth={2} />
      <path d={svgPath(cuspBot)} fill="none" stroke={t.accent.primary} strokeWidth={2} />
      <path d={svgPath(trajectory)} fill="none" stroke={t.text.primary} strokeWidth={2} />
      {steps.map(s => s.guarded ? <circle key={s.i} cx={sx(s.a)} cy={sy(s.b)} r={3} fill={t.text.secondary} /> : null)}
      {steps.map(s => s.foldType !== 'none' ? (
        <CatastropheGlyph key={`fold-${s.i}`} x={sx(s.a)} y={sy(s.b)} type={s.foldType} color={t.accent.primary} bg={t.bg.editor} />
      ) : null)}
      <circle cx={trajectory[0][0]} cy={trajectory[0][1]} r={4} fill={t.text.secondary} />
      <circle cx={sx(current.a)} cy={sy(current.b)} r={6} fill={t.accent.primary} />
      <text x={pad} y={22} fill={t.text.secondary} fontSize={12}>data path over the cusp discriminant</text>
    </svg>
  )
}
