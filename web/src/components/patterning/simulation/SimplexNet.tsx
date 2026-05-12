import type { Step, ModelConfig } from './types'
import { DEFAULT_Q0 } from './constants'
import { coeffFromQ, foldMargin, normalizeSimplexWeights } from './engine'
import { svgPath } from './helpers'
import { tokens } from '@/theme/tokens'

const t = tokens

function baryPoint(vertices: Array<[number, number]>, weights: number[]): [number, number] {
  return [
    vertices.reduce((sum, v, i) => sum + v[0] * weights[i], 0),
    vertices.reduce((sum, v, i) => sum + v[1] * weights[i], 0),
  ]
}

function reflectPointAcrossLine(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const vx = b[0] - a[0], vy = b[1] - a[1]
  const wx = p[0] - a[0], wy = p[1] - a[1]
  const scale = (wx * vx + wy * vy) / (vx * vx + vy * vy)
  const proj: [number, number] = [a[0] + scale * vx, a[1] + scale * vy]
  return [2 * proj[0] - p[0], 2 * proj[1] - p[1]]
}

function insetFace(verticesByQ: Record<number, [number, number]>, away: [number, number]): Record<number, [number, number]> {
  const gap = 7
  const norm = Math.sqrt(away[0] ** 2 + away[1] ** 2) || 1
  const dx = (gap * away[0]) / norm, dy = (gap * away[1]) / norm
  const shifted: Record<number, [number, number]> = {}
  for (const key of Object.keys(verticesByQ)) {
    const i = Number(key)
    shifted[i] = [verticesByQ[i][0] + dx, verticesByQ[i][1] + dy]
  }
  return shifted
}

export function SimplexNet({ steps, selected, qReference, config }: {
  steps: Step[]; selected: number; qReference: number[]; config: ModelConfig
}) {
  const width = 420, height = 340
  const side = 150, triH = (Math.sqrt(3) / 2) * side
  const q0: [number, number] = [210, 55]
  const q1: [number, number] = [210 - side / 2, 55 + triH]
  const q2: [number, number] = [210 + side / 2, 55 + triH]
  const q3FromEdge12 = reflectPointAcrossLine(q0, q1, q2)
  const q3FromEdge02 = reflectPointAcrossLine(q1, q0, q2)
  const q3FromEdge01 = reflectPointAcrossLine(q2, q0, q1)

  const faces = [
    { omit: 3, label: 'q3=0', verticesByQ: { 0: q0, 1: q1, 2: q2 } as Record<number, [number, number]> },
    { omit: 0, label: 'q0=0', verticesByQ: insetFace({ 1: q1, 2: q2, 3: q3FromEdge12 }, [0, 1]) },
    { omit: 1, label: 'q1=0', verticesByQ: insetFace({ 0: q0, 2: q2, 3: q3FromEdge02 }, [1, -0.6]) },
    { omit: 2, label: 'q2=0', verticesByQ: insetFace({ 0: q0, 1: q1, 3: q3FromEdge01 }, [-1, -0.6]) },
  ]

  const faceProjection = (qRaw: number[], omit: number, verticesByQ: Record<number, [number, number]>): [number, number] => {
    const q = normalizeSimplexWeights(qRaw)
    const rem = [0, 1, 2, 3].filter(i => i !== omit)
    const rawWeights = rem.map(i => Math.max(0, q[i]))
    const z = rawWeights.reduce((sum, x) => sum + x, 0)
    const weights = z > 1e-9 ? rawWeights.map(x => x / z) : [1 / 3, 1 / 3, 1 / 3]
    return baryPoint(rem.map(i => verticesByQ[i]), weights)
  }

  const projectedPath = (omit: number, verticesByQ: Record<number, [number, number]>) =>
    steps.filter(s => s.q).map(s => faceProjection(s.q ?? DEFAULT_Q0, omit, verticesByQ))

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 270 }}>
      <title>Unfolded tetrahedron net. Each face is q_i = 0.</title>
      <rect width={width} height={height} fill={t.bg.editor} />
      {faces.map(face => {
        const rem = [0, 1, 2, 3].filter(i => i !== face.omit)
        const vertices = rem.map(i => face.verticesByQ[i])
        const p = projectedPath(face.omit, face.verticesByQ)
        const currentQ = steps[selected]?.q ?? qReference
        const [cx, cy] = faceProjection(currentQ, face.omit, face.verticesByQ)
        const [startX, startY] = faceProjection(qReference, face.omit, face.verticesByQ)
        const labelPoint = baryPoint(vertices, [1 / 3, 1 / 3, 1 / 3])

        const shadeDots = []
        const n = 13
        for (let u = 0; u <= n; u++) {
          for (let v = 0; v <= n - u; v++) {
            const w = n - u - v
            const weights = [u / n, v / n, w / n]
            const qFace = [0, 0, 0, 0]
            rem.forEach((idx, j) => { qFace[idx] = weights[j] })
            const [aFace, bFace] = coeffFromQ(qFace)
            if (foldMargin(aFace, bFace, config) < 0) {
              const [dotX, dotY] = baryPoint(vertices, weights)
              shadeDots.push(<circle key={`${u}-${v}`} cx={dotX} cy={dotY} r={2.4} fill={t.fill.secondary} />)
            }
          }
        }

        return (
          <g key={face.omit}>
            <polygon points={vertices.map(v => v.join(',')).join(' ')} fill={t.fill.tertiary} stroke={t.stroke.primary} />
            {shadeDots}
            <path d={svgPath(p)} fill="none" stroke={t.text.primary} strokeWidth={1.8} />
            <circle cx={startX} cy={startY} r={5} fill="none" stroke={t.text.secondary} strokeWidth={1.8} />
            <circle cx={cx} cy={cy} r={4 + 5 * currentQ[face.omit]} fill={t.accent.primary} />
            <text x={labelPoint[0] - 14} y={labelPoint[1] + 4} fill={t.text.secondary} fontSize={11}>{face.label}</text>
          </g>
        )
      })}
      <text x={12} y={20} fill={t.text.secondary} fontSize={12}>tetrahedron net</text>
    </svg>
  )
}
