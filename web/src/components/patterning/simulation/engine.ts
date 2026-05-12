import type { ModelPreset, ModelConfig, Stats, CriticalPoint, Step, Policy, PosteriorMode, DataMode } from './types'
import { W_MIN, W_MAX, W_N, A0, B0, COEFF_LIMIT, ATOMS, SIMPLEX_SCALE as _ } from './constants'

export function modelConfig(preset: ModelPreset): ModelConfig {
  if (preset === 'sharp') return { quartic: 1.6, quadraticScale: 1.0, bias: 0, label: 'sharper quartic' }
  if (preset === 'tilted') return { quartic: 1.0, quadraticScale: 1.0, bias: 0.18, label: 'biased cusp' }
  return { quartic: 1.0, quadraticScale: 1.0, bias: 0, label: 'canonical cusp' }
}

export function coeffFromQ(q: number[]): [number, number] {
  let a = 0, b = 0
  for (let i = 0; i < 4; i++) {
    a += q[i] * ATOMS[i].a
    b += q[i] * ATOMS[i].b
  }
  return [a, b]
}

export function normalizeQ(logWeights: number[]): number[] {
  const maxLog = Math.max(...logWeights)
  const weights = logWeights.map(x => Math.exp(x - maxLog))
  const z = weights.reduce((sum, x) => sum + x, 0)
  const floored = weights.map(x => Math.max(1e-6, x / z))
  const flooredZ = floored.reduce((sum, x) => sum + x, 0)
  return floored.map(x => x / flooredZ)
}

export function normalizeSimplexWeights(weights: number[]): number[] {
  const clipped = weights.map(x => Math.max(1e-4, x))
  const z = clipped.reduce((sum, x) => sum + x, 0)
  return clipped.map(x => x / z)
}

export function klDiv(pRaw: number[], qRaw: number[]): number {
  const p = normalizeSimplexWeights(pRaw)
  const q = normalizeSimplexWeights(qRaw)
  return p.reduce((sum, pi, i) => sum + pi * Math.log(pi / q[i]), 0)
}

export function loss(w: number, a: number, b: number, config: ModelConfig): number {
  return 0.25 * config.quartic * w ** 4 + 0.5 * config.quadraticScale * a * w ** 2 + (b + config.bias) * w
}

export function grad(w: number, a: number, b: number, config: ModelConfig): number {
  return config.quartic * w ** 3 + config.quadraticScale * a * w + b + config.bias
}

export function hessian(w: number, a: number, config: ModelConfig): number {
  return 3 * config.quartic * w * w + config.quadraticScale * a
}

function cbrt(x: number): number {
  return Math.sign(x) * Math.pow(Math.abs(x), 1 / 3)
}

function stationaryPoints(a: number, b: number, config: ModelConfig): number[] {
  const p = (config.quadraticScale * a) / config.quartic
  const q = (b + config.bias) / config.quartic
  const disc = (q / 2) ** 2 + (p / 3) ** 3
  if (disc > 1e-10) {
    const s = Math.sqrt(disc)
    return [cbrt(-q / 2 + s) + cbrt(-q / 2 - s)]
  }
  if (Math.abs(p) < 1e-10) return [cbrt(-q)]
  if (p > 0) return [cbrt(-q / 2 + Math.sqrt(Math.max(0, disc))) + cbrt(-q / 2 - Math.sqrt(Math.max(0, disc)))]
  const r = 2 * Math.sqrt(-p / 3)
  const arg = Math.max(-1, Math.min(1, (3 * q / (2 * p)) * Math.sqrt(-3 / p)))
  const theta = Math.acos(arg)
  return [0, 1, 2].map(k => r * Math.cos((theta - 2 * Math.PI * k) / 3)).sort((x, y) => x - y)
}

export function criticalPoints(a: number, b: number, config: ModelConfig): CriticalPoint[] {
  return stationaryPoints(a, b, config).map(w => {
    const h = hessian(w, a, config)
    return { w, stable: h > 1e-7, hessian: h }
  })
}

export function nearestStable(w: number, a: number, b: number, config: ModelConfig): CriticalPoint | undefined {
  return criticalPoints(a, b, config)
    .filter(p => p.stable)
    .sort((p, q) => Math.abs(p.w - w) - Math.abs(q.w - w))[0]
}

export function foldMargin(a: number, b: number, config: ModelConfig): number {
  const p = (config.quadraticScale * a) / config.quartic
  const q = (b + config.bias) / config.quartic
  return 4 * p ** 3 + 27 * q ** 2
}

export function posteriorStats(a: number, b: number, beta: number, center: number, spring: number, posteriorMode: PosteriorMode, config: ModelConfig): Stats {
  const dx = (W_MAX - W_MIN) / (W_N - 1)
  let minL = Infinity
  for (let i = 0; i < W_N; i++) {
    const w = W_MIN + i * dx
    const energy = loss(w, a, b, config) + (posteriorMode === 'local' ? 0.5 * spring * (w - center) ** 2 : 0)
    minL = Math.min(minL, energy)
  }
  let z = 0, ew = 0, ew2 = 0, ea = 0, ewa = 0
  for (let i = 0; i < W_N; i++) {
    const w = W_MIN + i * dx
    const energy = loss(w, a, b, config) + (posteriorMode === 'local' ? 0.5 * spring * (w - center) ** 2 : 0)
    const weight = Math.exp(-beta * (energy - minL))
    const dataA = 0.5 * config.quadraticScale * w * w
    z += weight
    ew += weight * w
    ew2 += weight * w * w
    ea += weight * dataA
    ewa += weight * w * dataA
  }
  const mean = ew / z
  const variance = Math.max(0, ew2 / z - mean * mean)
  const covWA = ewa / z - mean * (ea / z)
  return { mean, variance, chiA: -beta * covWA, chiB: -beta * variance }
}

function safeForCurrentBranch(w: number, a: number, b: number, config: ModelConfig): boolean {
  const branch = nearestStable(w, a, b, config)
  if (!branch) return false
  return Math.abs(branch.w - w) < 0.75 && branch.hessian > 0.08
}

function descendPath(w0: number, a: number, b: number, fastSteps: number, gradStepSize: number, config: ModelConfig): number[] {
  let w = w0
  const path = [w]
  for (let k = 0; k < fastSteps; k++) {
    w -= gradStepSize * grad(w, a, b, config)
    w = Math.max(W_MIN, Math.min(W_MAX, w))
    path.push(w)
  }
  return path
}

function proposedUpdate(
  a: number, b: number, stats: Stats, target: number, ridge: number,
  useKlPenalty: boolean, klStrength: number, controllerGain: number,
): [number, number] {
  const err = target - stats.mean
  const kl = useKlPenalty ? klStrength : 0
  const m00 = stats.chiA * stats.chiA + ridge + kl
  const m01 = stats.chiA * stats.chiB
  const m11 = stats.chiB * stats.chiB + ridge + kl
  const rhs0 = stats.chiA * err - kl * (a - A0)
  const rhs1 = stats.chiB * err - kl * (b - B0)
  const det = Math.max(1e-12, m00 * m11 - m01 * m01)
  return [
    controllerGain * (m11 * rhs0 - m01 * rhs1) / det,
    controllerGain * (-m01 * rhs0 + m00 * rhs1) / det,
  ]
}

function proposedSimplexUpdate(
  q: number[], qReference: number[], stats: Stats, target: number, ridge: number,
  useKlPenalty: boolean, klStrength: number, controllerGain: number,
): number[] {
  const err = target - stats.mean
  const chiQ = ATOMS.map(atom => stats.chiA * atom.a + stats.chiB * atom.b)
  const meanChi = chiQ.reduce((sum, x, i) => sum + q[i] * x, 0)
  const centered = chiQ.map(x => x - meanChi)
  const fisherNormSq = centered.reduce((sum, x, i) => sum + q[i] * x * x, 0)
  const responseScale = err / (fisherNormSq + ridge)
  const logUpdate = centered.map((x, i) => {
    const anchor = useKlPenalty ? klStrength * Math.log(q[i] / qReference[i]) : 0
    return controllerGain * (responseScale * x - anchor)
  })
  return normalizeQ(q.map((qi, i) => Math.log(qi) + logUpdate[i]))
}

export function closedLoopEigenvalues(chiA: number, chiB: number, ridge: number, useKlPenalty: boolean, klStrength: number, alpha: number) {
  const chiNormSq = chiA * chiA + chiB * chiB
  const kl = useKlPenalty ? klStrength : 0
  const controlled = 1 - alpha * chiNormSq / (chiNormSq + ridge + kl)
  const anchor = useKlPenalty ? 1 - alpha * kl / (ridge + kl) : 1
  return { controlled, anchor, maxAbs: Math.max(Math.abs(controlled), Math.abs(anchor)) }
}

export function correlation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return 0
  const mx = xs.slice(0, n).reduce((sum, x) => sum + x, 0) / n
  const my = ys.slice(0, n).reduce((sum, y) => sum + y, 0) / n
  let cov = 0, vx = 0, vy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    cov += dx * dy
    vx += dx * dx
    vy += dy * dy
  }
  return vx > 1e-12 && vy > 1e-12 ? cov / Math.sqrt(vx * vy) : 0
}

export function simulate(
  policy: Policy, beta: number, target: number, ridge: number,
  fastSteps: number, gradStepSize: number, posteriorMode: PosteriorMode, spring: number,
  initialW: number, modelPreset: ModelPreset, useKlPenalty: boolean, klStrength: number,
  instantEquilibrate: boolean, controllerGain: number, dataMode: DataMode, qReference: number[],
): Step[] {
  const config = modelConfig(modelPreset)
  let q = normalizeSimplexWeights(qReference)
  let [a, b] = dataMode === 'simplex' ? coeffFromQ(q) : [A0, B0]
  let w = initialW
  const steps: Step[] = []
  let previousStableCount = criticalPoints(a, b, config).filter(p => p.stable).length

  for (let i = 0; i < 58; i++) {
    const stats = posteriorStats(a, b, beta, w, spring, posteriorMode, config)
    const crit = criticalPoints(a, b, config)
    const branch = nearestStable(w, a, b, config)
    const stableCount = crit.filter(p => p.stable).length
    const foldType = stableCount > previousStableCount ? 'birth' as const : stableCount < previousStableCount ? 'death' as const : 'none' as const
    const eigs = closedLoopEigenvalues(stats.chiA, stats.chiB, ridge, useKlPenalty, klStrength, controllerGain)
    steps.push({
      i, a, b, w,
      posteriorMean: stats.mean,
      chiA: stats.chiA, chiB: stats.chiB,
      err: target - stats.mean,
      critical: crit,
      localHessian: branch ? branch.hessian : hessian(w, a, config),
      folded: stableCount !== previousStableCount,
      foldType,
      guarded: false, routed: false,
      eigMaxAbs: eigs.maxAbs, eigControlled: eigs.controlled, eigAnchor: eigs.anchor,
      effort: 0, klStep: 0,
      klFromReference: dataMode === 'simplex' ? klDiv(q, qReference) : 0,
      predictedDeltaMu: 0, realizedDeltaMu: 0, linearizationError: 0,
      plantResidual: Math.abs(grad(w, a, b, config)),
      relaxPath: [w],
      q: dataMode === 'simplex' ? [...q] : undefined,
    })
    previousStableCount = stableCount

    let [da, db] = proposedUpdate(a, b, stats, target, ridge, useKlPenalty, klStrength, controllerGain)
    let nextQ = q
    let guarded = false
    let routed = false

    if (dataMode === 'simplex') {
      nextQ = proposedSimplexUpdate(q, qReference, stats, target, ridge, useKlPenalty, klStrength, controllerGain)
      const [nextA, nextB] = coeffFromQ(nextQ)
      da = nextA - a
      db = nextB - b
    }

    if (policy === 'guard' || policy === 'route') {
      let nextA = a + da
      let nextB = b + db
      if (!safeForCurrentBranch(w, nextA, nextB, config)) {
        guarded = true
        if (policy === 'route' && dataMode === 'coeff') {
          routed = true
          da = Math.max(da, 0.16)
          db *= 0.25
        }
        let scale = 1
        for (let attempt = 0; attempt < 10; attempt++) {
          nextA = a + scale * da
          nextB = b + scale * db
          if (safeForCurrentBranch(w, nextA, nextB, config)) break
          scale *= 0.5
        }
        da *= scale
        db *= scale
        if (dataMode === 'simplex') {
          nextQ = normalizeQ(q.map((qi, idx) => Math.log(qi) + scale * (Math.log(nextQ[idx]) - Math.log(qi))))
          const [scaledA, scaledB] = coeffFromQ(nextQ)
          da = scaledA - a
          db = scaledB - b
        }
      }
    }

    if (dataMode === 'simplex') {
      q = nextQ;
      [a, b] = coeffFromQ(q)
    } else {
      a = Math.max(-COEFF_LIMIT, Math.min(COEFF_LIMIT, a + da))
      b = Math.max(-COEFF_LIMIT, Math.min(COEFF_LIMIT, b + db))
    }
    const last = steps[steps.length - 1]
    if (instantEquilibrate) {
      const br = nearestStable(w, a, b, config)
      if (br) {
        w = br.w
        last.relaxPath = [last.w, w]
      } else {
        const p = descendPath(w, a, b, 200, 0.04, config)
        w = p[p.length - 1]
        last.relaxPath = p
      }
    } else {
      const p = descendPath(w, a, b, fastSteps, gradStepSize, config)
      w = p[p.length - 1]
      last.relaxPath = p
    }
    last.guarded = guarded
    last.routed = routed
    last.effort = dataMode === 'simplex'
      ? Math.sqrt(q.reduce((sum, qi, idx) => sum + ((qi - (last.q ?? q)[idx]) ** 2) / Math.max(1e-9, (last.q ?? q)[idx]), 0))
      : Math.sqrt(da * da + db * db)
    last.klStep = dataMode === 'simplex' ? klDiv(q, last.q ?? q) : 0
    last.klFromReference = dataMode === 'simplex' ? klDiv(q, qReference) : Math.sqrt((a - A0) ** 2 + (b - B0) ** 2)
    last.predictedDeltaMu = stats.chiA * da + stats.chiB * db
    const nextStats = posteriorStats(a, b, beta, w, spring, posteriorMode, config)
    last.realizedDeltaMu = nextStats.mean - stats.mean
    last.linearizationError = Math.abs(last.realizedDeltaMu - last.predictedDeltaMu) / (Math.abs(last.predictedDeltaMu) + 1e-6)
    last.plantResidual = Math.abs(grad(w, a, b, config))
  }
  return steps
}
