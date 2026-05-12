import type { Step, ModelConfig, DataMode } from './types'
import { loss, closedLoopEigenvalues, correlation } from './engine'
import { MiniTimeSeries } from './MiniTimeSeries'
import { MathBlock, fmt } from './helpers'
import { Stack } from '@/components/core/layouts'

export function PotentialTrace({ steps, config, originalA, originalB, selected }: {
  steps: Step[]; config: ModelConfig; originalA: number; originalB: number; selected: number
}) {
  const initialW = steps[0]?.w ?? 0
  return (
    <Stack gap={8}>
      <MiniTimeSeries steps={steps} selected={selected} height={170} series={[
        { name: 'L_orig(w_t)', data: steps.map(s => loss(s.w, originalA, originalB, config)) },
        { name: 'L_pat(w_t)', data: steps.map(s => loss(s.w, s.a, s.b, config)) },
        { name: 'L_orig(w_0)', data: steps.map(() => loss(initialW, originalA, originalB, config)) },
        { name: 'L_pat(w_0)', data: steps.map(s => loss(initialW, s.a, s.b, config)) },
      ]} />
      <p className="text-xs text-zinc-500">
        Evaluates tracked <code className="bg-zinc-100 px-1 rounded text-zinc-700">w_t</code> under original and patterned coefficients.
        Baselines evaluate <code className="bg-zinc-100 px-1 rounded text-zinc-700">w_0</code> under each.
      </p>
    </Stack>
  )
}

export function StabilityTrace({ steps, selected }: { steps: Step[]; selected: number }) {
  return (
    <Stack gap={8}>
      <MiniTimeSeries steps={steps} selected={selected} height={170} series={[
        { name: 'chi_a', data: steps.map(s => s.chiA) },
        { name: 'chi_b', data: steps.map(s => s.chiB) },
        { name: '||chi||', data: steps.map(s => Math.sqrt(s.chiA ** 2 + s.chiB ** 2)) },
        { name: 'max |eig|', data: steps.map(s => s.eigMaxAbs) },
      ]} />
      <p className="text-xs text-zinc-500">
        Frozen-linear diagnostic. Values below <code className="bg-zinc-100 px-1 rounded text-zinc-700">1</code> indicate
        locally damped modes; near or above indicates slow/unstable directions.
      </p>
      <MathBlock>{`J_{\\text{cl}} \\approx I - \\alpha\\,(\\chi^\\top\\!\\chi + \\rho I + \\lambda_{\\text{KL}}\\,I)^{-1}\\chi^\\top\\!\\chi \\;-\\; \\alpha\\,(\\chi^\\top\\!\\chi + \\rho I + \\lambda_{\\text{KL}}\\,I)^{-1}\\lambda_{\\text{KL}}\\,I`}</MathBlock>
      <MathBlock>{`\\lambda_{\\text{ctrl}} = 1 - \\frac{\\alpha\\,\\|\\chi\\|^2}{\\|\\chi\\|^2 + \\rho + \\lambda_{\\text{KL}}}, \\qquad \\lambda_{\\text{null}} = 1 - \\frac{\\alpha\\,\\lambda_{\\text{KL}}}{\\rho + \\lambda_{\\text{KL}}}`}</MathBlock>
    </Stack>
  )
}

export function TrackingTrace({ steps, selected }: { steps: Step[]; selected: number }) {
  return (
    <MiniTimeSeries steps={steps} selected={selected} height={150} series={[
      { name: 'signed error', data: steps.map(s => s.err) },
      { name: '|error|', data: steps.map(s => Math.abs(s.err)) },
    ]} />
  )
}

export function EffortTrace({ steps, dataMode, selected }: { steps: Step[]; dataMode: DataMode; selected: number }) {
  return (
    <MiniTimeSeries steps={steps} selected={selected} height={150} series={[
      { name: dataMode === 'simplex' ? 'Fisher step' : '||Δh||', data: steps.map(s => s.effort) },
      { name: dataMode === 'simplex' ? 'KL step' : 'dist h0', data: steps.map(s => dataMode === 'simplex' ? s.klStep : s.klFromReference) },
      { name: dataMode === 'simplex' ? 'KL ref' : 'dist h0', data: steps.map(s => s.klFromReference) },
    ]} />
  )
}

export function LinearizationTrace({ steps, selected }: { steps: Step[]; selected: number }) {
  const predicted = steps.map(s => s.predictedDeltaMu)
  const realized = steps.map(s => s.realizedDeltaMu)
  const rollingCorr = steps.map((_, i) => {
    const start = Math.max(0, i - 9)
    return correlation(predicted.slice(start, i + 1), realized.slice(start, i + 1))
  })
  const totalCorr = correlation(predicted.slice(1), realized.slice(1))
  return (
    <Stack gap={6}>
      <MiniTimeSeries steps={steps} selected={selected} height={150} series={[
        { name: 'predicted Δμ', data: predicted },
        { name: 'realized Δμ', data: realized },
        { name: 'rolling corr', data: rollingCorr },
        { name: 'rel error', data: steps.map(s => Math.min(10, s.linearizationError)) },
      ]} />
      <p className="text-xs text-zinc-500">
        corr(predicted, realized) = <code className="bg-zinc-100 px-1 rounded text-zinc-700">{totalCorr.toFixed(3)}</code>
      </p>
    </Stack>
  )
}

export function PlantResidualTrace({ steps, selected }: { steps: Step[]; selected: number }) {
  return (
    <MiniTimeSeries steps={steps} selected={selected} height={150} series={[
      { name: '|∂w L(w,h)|', data: steps.map(s => s.plantResidual) },
    ]} />
  )
}

export function RootLocusTrace({ current, ridge, useKlPenalty, klStrength }: {
  current: Step; ridge: number; useKlPenalty: boolean; klStrength: number
}) {
  const alphas = Array.from({ length: 30 }, (_, i) => 0.01 + (8 - 0.01) * (i / 29))
  const eigs = alphas.map(alpha => closedLoopEigenvalues(current.chiA, current.chiB, ridge, useKlPenalty, klStrength, alpha))
  const mockSteps = alphas.map((_, i) => ({ i } as Step))
  return (
    <MiniTimeSeries steps={mockSteps} selected={0} height={160} series={[
      { name: 'controlled', data: eigs.map(e => e.controlled) },
      { name: 'anchor', data: eigs.map(e => e.anchor) },
      { name: '|eig| max', data: eigs.map(e => e.maxAbs) },
    ]} />
  )
}

export { fmt }
