import { useSubscribe } from '@/lib/channel'
import type { CuspChannelState } from './channel'
import { DataSpacePlot } from './DataSpacePlot'
import { BranchDiagram } from './BranchDiagram'
import { LossPlot } from './LossPlot'
import { SimplexNet } from './SimplexNet'
import { StabilityTrace, TrackingTrace, EffortTrace, LinearizationTrace, PlantResidualTrace, RootLocusTrace, PotentialTrace } from './traces'
import { normalizeSimplexWeights } from './engine'
import { register } from '@/registry'

function useCusp(channel?: string): CuspChannelState | undefined {
  return useSubscribe<CuspChannelState>(channel)
}

function Placeholder({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-center h-48 text-sm text-zinc-400 border border-dashed border-zinc-300 rounded-lg">
      Waiting for <code className="mx-1 bg-zinc-100 px-1.5 rounded text-zinc-600">{name}</code> channel...
    </div>
  )
}

const CHANNEL_FIELD = { name: 'channel', type: 'string' as const, required: true, description: 'Channel name to subscribe to' }

// ── Branch Diagram ───────────────────────────────────────────

export function CuspBranchDiagram({ channel }: { channel?: string }) {
  const state = useCusp(channel)
  if (!state) return <Placeholder name="CuspBranchTracking" />
  return <BranchDiagram steps={state.steps} selected={state.selected} target={state.target} />
}

register({
  id: 'cusp-branch-diagram', name: 'Cusp Branch Diagram', embedTag: 'CuspBranchDiagram',
  category: 'simulation', description: 'Equilibrium bundle diagram. Subscribes to a CuspBranchTracking channel.',
  tags: ['patterning', 'cusp', 'channel'], display: 'inline',
  schema: { fields: [CHANNEL_FIELD] }, component: CuspBranchDiagram, sampleData: { channel: 'cusp' },
})

// ── Data Space Plot ──────────────────────────────────────────

export function CuspDataSpace({ channel }: { channel?: string }) {
  const state = useCusp(channel)
  if (!state) return <Placeholder name="CuspBranchTracking" />
  if (state.dataMode === 'simplex') {
    return <SimplexNet steps={state.steps} selected={state.selected} qReference={normalizeSimplexWeights(state.qReference)} config={state.config} />
  }
  return <DataSpacePlot steps={state.steps} selected={state.selected} config={state.config} />
}

register({
  id: 'cusp-data-space', name: 'Cusp Data Space', embedTag: 'CuspDataSpace',
  category: 'simulation', description: 'Data-space or simplex plot. Subscribes to a CuspBranchTracking channel.',
  tags: ['patterning', 'cusp', 'channel'], display: 'inline',
  schema: { fields: [CHANNEL_FIELD] }, component: CuspDataSpace, sampleData: { channel: 'cusp' },
})

// ── Loss Plot ────────────────────────────────────────────────

export function CuspLossPlot({ channel }: { channel?: string }) {
  const state = useCusp(channel)
  if (!state) return <Placeholder name="CuspBranchTracking" />
  return <LossPlot step={state.steps[state.selected]} beta={state.beta} spring={state.spring} posteriorMode={state.posteriorMode} target={state.target} config={state.config} />
}

register({
  id: 'cusp-loss-plot', name: 'Cusp Loss Plot', embedTag: 'CuspLossPlot',
  category: 'simulation', description: 'Loss landscape for the selected step. Subscribes to a CuspBranchTracking channel.',
  tags: ['patterning', 'cusp', 'channel'], display: 'inline',
  schema: { fields: [CHANNEL_FIELD] }, component: CuspLossPlot, sampleData: { channel: 'cusp' },
})

// ── Stability Trace ──────────────────────────────────────────

export function CuspStability({ channel }: { channel?: string }) {
  const state = useCusp(channel)
  if (!state) return <Placeholder name="CuspBranchTracking" />
  return <StabilityTrace steps={state.steps} selected={state.selected} />
}

register({
  id: 'cusp-stability', name: 'Cusp Stability', embedTag: 'CuspStability',
  category: 'simulation', description: 'Closed-loop eigenvalue and susceptibility trace. Subscribes to a CuspBranchTracking channel.',
  tags: ['patterning', 'cusp', 'channel'], display: 'inline',
  schema: { fields: [CHANNEL_FIELD] }, component: CuspStability, sampleData: { channel: 'cusp' },
})

// ── Tracking Error ───────────────────────────────────────────

export function CuspTracking({ channel }: { channel?: string }) {
  const state = useCusp(channel)
  if (!state) return <Placeholder name="CuspBranchTracking" />
  return <TrackingTrace steps={state.steps} selected={state.selected} />
}

register({
  id: 'cusp-tracking', name: 'Cusp Tracking Error', embedTag: 'CuspTracking',
  category: 'simulation', description: 'Tracking error trace. Subscribes to a CuspBranchTracking channel.',
  tags: ['patterning', 'cusp', 'channel'], display: 'inline',
  schema: { fields: [CHANNEL_FIELD] }, component: CuspTracking, sampleData: { channel: 'cusp' },
})

// ── Effort ───────────────────────────────────────────────────

export function CuspEffort({ channel }: { channel?: string }) {
  const state = useCusp(channel)
  if (!state) return <Placeholder name="CuspBranchTracking" />
  return <EffortTrace steps={state.steps} dataMode={state.dataMode} selected={state.selected} />
}

register({
  id: 'cusp-effort', name: 'Cusp Control Effort', embedTag: 'CuspEffort',
  category: 'simulation', description: 'Control effort trace. Subscribes to a CuspBranchTracking channel.',
  tags: ['patterning', 'cusp', 'channel'], display: 'inline',
  schema: { fields: [CHANNEL_FIELD] }, component: CuspEffort, sampleData: { channel: 'cusp' },
})

// ── Linearization ────────────────────────────────────────────

export function CuspLinearization({ channel }: { channel?: string }) {
  const state = useCusp(channel)
  if (!state) return <Placeholder name="CuspBranchTracking" />
  return <LinearizationTrace steps={state.steps} selected={state.selected} />
}

register({
  id: 'cusp-linearization', name: 'Cusp Linearization Check', embedTag: 'CuspLinearization',
  category: 'simulation', description: 'Linearization validity check. Subscribes to a CuspBranchTracking channel.',
  tags: ['patterning', 'cusp', 'channel'], display: 'inline',
  schema: { fields: [CHANNEL_FIELD] }, component: CuspLinearization, sampleData: { channel: 'cusp' },
})

// ── Plant Residual ───────────────────────────────────────────

export function CuspPlantResidual({ channel }: { channel?: string }) {
  const state = useCusp(channel)
  if (!state) return <Placeholder name="CuspBranchTracking" />
  return <PlantResidualTrace steps={state.steps} selected={state.selected} />
}

register({
  id: 'cusp-plant-residual', name: 'Cusp Plant Residual', embedTag: 'CuspPlantResidual',
  category: 'simulation', description: 'Plant disequilibrium residual. Subscribes to a CuspBranchTracking channel.',
  tags: ['patterning', 'cusp', 'channel'], display: 'inline',
  schema: { fields: [CHANNEL_FIELD] }, component: CuspPlantResidual, sampleData: { channel: 'cusp' },
})

// ── Root Locus ───────────────────────────────────────────────

export function CuspRootLocus({ channel }: { channel?: string }) {
  const state = useCusp(channel)
  if (!state) return <Placeholder name="CuspBranchTracking" />
  return <RootLocusTrace current={state.steps[state.selected]} ridge={state.ridge} useKlPenalty={state.useKlPenalty} klStrength={state.klStrength} />
}

register({
  id: 'cusp-root-locus', name: 'Cusp Root Locus', embedTag: 'CuspRootLocus',
  category: 'simulation', description: 'Root-locus eigenvalue sweep. Subscribes to a CuspBranchTracking channel.',
  tags: ['patterning', 'cusp', 'channel'], display: 'inline',
  schema: { fields: [CHANNEL_FIELD] }, component: CuspRootLocus, sampleData: { channel: 'cusp' },
})

// ── Potentials ───────────────────────────────────────────────

export function CuspPotentials({ channel }: { channel?: string }) {
  const state = useCusp(channel)
  if (!state) return <Placeholder name="CuspBranchTracking" />
  return <PotentialTrace steps={state.steps} config={state.config} originalA={state.originalA} originalB={state.originalB} selected={state.selected} />
}

register({
  id: 'cusp-potentials', name: 'Cusp Potentials', embedTag: 'CuspPotentials',
  category: 'simulation', description: 'Original vs patterned potential traces. Subscribes to a CuspBranchTracking channel.',
  tags: ['patterning', 'cusp', 'channel'], display: 'inline',
  schema: { fields: [CHANNEL_FIELD] }, component: CuspPotentials, sampleData: { channel: 'cusp' },
})
