import { useState, useEffect } from 'react'
import type { Policy, PosteriorMode, ModelPreset, DataMode } from './types'
import type { CuspChannelState } from './channel'
import { A0, B0 } from './constants'
import { modelConfig, simulate, coeffFromQ, normalizeSimplexWeights } from './engine'
import { usePublish } from '@/lib/channel'
import { DataSpacePlot } from './DataSpacePlot'
import { BranchDiagram } from './BranchDiagram'
import { LossPlot } from './LossPlot'
import { SimplexNet } from './SimplexNet'
import { CompactControls } from './controls'
import { PotentialTrace, StabilityTrace, TrackingTrace, EffortTrace, LinearizationTrace, PlantResidualTrace, RootLocusTrace, fmt } from './traces'
import { Info, MathBlock } from './helpers'
import { CopyEmbed } from './CopyEmbed'
import { Stack, Grid, Card, CardHeader, CardBody } from '@/components/core/layouts'
import { Stat } from '@/components/core/layouts'
import { register } from '@/registry'

function Trail({ info, tag }: { info: string; tag: string }) {
  return <span className="inline-flex items-center gap-1.5"><CopyEmbed tag={tag} /><Info text={info} /></span>
}

export function CuspBranchTracking({ channel }: { channel?: string } = {}) {
  const [policy, setPolicy] = useState<Policy>('direct')
  const [posteriorMode, setPosteriorMode] = useState<PosteriorMode>('local')
  const [modelPreset, setModelPreset] = useState<ModelPreset>('canonical')
  const [dataMode, setDataMode] = useState<DataMode>('simplex')
  const [qReference, setQReference] = useState([0.02, 0.97, 0.01, 0.01])
  const [beta, setBeta] = useState(1)
  const [target, setTarget] = useState(1.4)
  const [ridge, setRidge] = useState(1e-5)
  const [spring, setSpring] = useState(36.5)
  const [useKlPenalty, setUseKlPenalty] = useState(false)
  const [klStrength, setKlStrength] = useState(0.05)
  const [instantEquilibrate, setInstantEquilibrate] = useState(false)
  const [controllerGain, setControllerGain] = useState(0.01)
  const [fastSteps, setFastSteps] = useState(43)
  const [gradStepSize, setGradStepSize] = useState(0.0022)
  const [initialW, setInitialW] = useState(-1.5)
  const [selected, setSelected] = useState(57)

  const config = modelConfig(modelPreset)
  const steps = simulate(
    policy, beta, target, ridge, fastSteps, gradStepSize, posteriorMode, spring,
    initialW, modelPreset, useKlPenalty, klStrength, instantEquilibrate, controllerGain,
    dataMode, normalizeSimplexWeights(qReference),
  )
  const index = Math.max(0, Math.min(selected, steps.length - 1))
  const current = steps[index]
  const [originalA, originalB] = dataMode === 'simplex' ? coeffFromQ(normalizeSimplexWeights(qReference)) : [A0, B0]

  const controlsElement = (
    <CompactControls
      modelPreset={modelPreset} setModelPreset={setModelPreset}
      dataMode={dataMode} setDataMode={setDataMode}
      qReference={normalizeSimplexWeights(qReference)} setQReference={setQReference}
      policy={policy} setPolicy={setPolicy}
      posteriorMode={posteriorMode} setPosteriorMode={setPosteriorMode}
      useKlPenalty={useKlPenalty} setUseKlPenalty={setUseKlPenalty}
      instantEquilibrate={instantEquilibrate} setInstantEquilibrate={setInstantEquilibrate}
      initialW={initialW} setInitialW={setInitialW}
      controllerGain={controllerGain} setControllerGain={setControllerGain}
      beta={beta} setBeta={setBeta}
      target={target} setTarget={setTarget}
      spring={spring} setSpring={setSpring}
      ridge={ridge} setRidge={setRidge}
      klStrength={klStrength} setKlStrength={setKlStrength}
      fastSteps={fastSteps} setFastSteps={setFastSteps}
      gradStepSize={gradStepSize} setGradStepSize={setGradStepSize}
    />
  )

  const publish = usePublish(channel)
  useEffect(() => {
    publish({ steps, selected: index, config, target, beta, spring, posteriorMode, dataMode, qReference: normalizeSimplexWeights(qReference), originalA, originalB, ridge, useKlPenalty, klStrength, controlsElement } satisfies CuspChannelState)
  })

  return (
    <Stack gap={18}>
      <Grid columns="300px minmax(0, 1fr)" gap={14} align="start">
        <Stack gap={10}>
          {controlsElement}
          <Card collapsible defaultOpen={false}>
            <CardHeader trailing={<Info text="Toy model class. The preset changes the quartic scale or adds a fixed bias." />}>
              model equations
            </CardHeader>
            <CardBody>
              <Stack gap={10}>
                <MathBlock>{`L(w;\\,a,b) = \\tfrac{c}{4}\\,w^4 + \\tfrac{s\\,a}{2}\\,w^2 + (b + b_0)\\,w`}</MathBlock>
                <MathBlock>{`p_{\\beta,a,b}(w) \\propto \\exp\\!\\bigl(-\\beta\\bigl[L(w;\\,a,b) + \\tfrac{k}{2}(w - w_{\\text{track}})^2\\bigr]\\bigr)`}</MathBlock>
                <MathBlock>{`\\chi_a = -\\beta\\,\\text{Cov}(w,\\,\\tfrac{s}{2}w^2), \\qquad \\chi_b = -\\beta\\,\\text{Var}(w)`}</MathBlock>
                <p className="text-xs text-zinc-500">
                  Preset: <code className="bg-zinc-100 px-1 rounded text-zinc-700">{config.label}</code>,
                  c = {fmt(config.quartic, 2)}, s = {fmt(config.quadraticScale, 2)}, b0 = {fmt(config.bias, 2)}.
                </p>
              </Stack>
            </CardBody>
          </Card>
        </Stack>

        <Stack gap={12}>
          {/* Row 1: main plots */}
          <Grid columns={3} gap={12}>
            <Card>
              <CardHeader trailing={<Trail info={dataMode === 'simplex' ? 'Simplex mode: true data space as unfolded tetrahedron.' : `Step ${index}. Coefficient mode: (a,b) control plane.`} tag="CuspDataSpace" />}>
                {dataMode === 'simplex' ? 'data simplex' : 'data space'}
              </CardHeader>
              <CardBody>
                {dataMode === 'simplex'
                  ? <SimplexNet steps={steps} selected={index} qReference={normalizeSimplexWeights(qReference)} config={config} />
                  : <DataSpacePlot steps={steps} selected={index} config={config} />}
              </CardBody>
            </Card>
            <Card>
              <CardHeader trailing={<Trail info="Equilibrium bundle. Blue = stable sheets; gray = saddles; black = tracked w." tag="CuspBranchDiagram" />}>
                branch bundle
              </CardHeader>
              <CardBody>
                <BranchDiagram steps={steps} selected={index} target={target} />
                <input type="range" min={0} max={steps.length - 1} value={index}
                  onChange={e => setSelected(Number(e.currentTarget.value))} className="w-full accent-blue-500 mt-2" />
              </CardBody>
            </Card>
            <Card>
              <CardHeader trailing={<Trail info="Selected loss landscape with target marker." tag="CuspLossPlot" />}>
                loss landscape
              </CardHeader>
              <CardBody>
                <LossPlot step={current} beta={beta} spring={spring} posteriorMode={posteriorMode} target={target} config={config} />
              </CardBody>
            </Card>
          </Grid>

          {/* Row 2: stability, potentials, diagnostics */}
          <Grid columns={3} gap={12}>
            <Card>
              <CardHeader trailing={<Trail info="Frozen-linear closed-loop eigenvalues and susceptibility norm." tag="CuspStability" />}>stability</CardHeader>
              <CardBody><StabilityTrace steps={steps} selected={index} /></CardBody>
            </Card>
            <Card>
              <CardHeader trailing={<Trail info="Original and patterned potentials evaluated along the tracked path." tag="CuspPotentials" />}>potentials</CardHeader>
              <CardBody><PotentialTrace steps={steps} config={config} originalA={originalA} originalB={originalB} selected={index} /></CardBody>
            </Card>
            <Card>
              <CardHeader trailing={<Info text="Current step diagnostics." />}>diagnostics</CardHeader>
              <CardBody>
                <Grid columns={2} gap={8}>
                  <Stat value={fmt(current.a)} label="a projection" />
                  <Stat value={fmt(current.b)} label="b projection" />
                  <Stat value={fmt(current.w)} label="tracked w" />
                  <Stat value={fmt(current.posteriorMean)} label="posterior E[w]" />
                  <Stat value={fmt(Math.sqrt(current.chiA ** 2 + current.chiB ** 2))} label="||chi||" />
                  <Stat value={fmt(current.eigMaxAbs)} label="max |eig|" />
                  {dataMode === 'simplex' && (current.q ?? normalizeSimplexWeights(qReference)).map((qi, i) => (
                    <Stat key={i} value={fmt(qi, 2)} label={`q${i}`} />
                  ))}
                </Grid>
              </CardBody>
            </Card>
          </Grid>

          {/* Row 3: tracking, effort, linearization */}
          <Grid columns={3} gap={12}>
            <Card>
              <CardHeader trailing={<Trail info="Tracking error e_t = target - μ(h_t)." tag="CuspTracking" />}>tracking error</CardHeader>
              <CardBody><TrackingTrace steps={steps} selected={index} /></CardBody>
            </Card>
            <Card>
              <CardHeader trailing={<Trail info="Control effort per step." tag="CuspEffort" />}>control effort</CardHeader>
              <CardBody><EffortTrace steps={steps} dataMode={dataMode} selected={index} /></CardBody>
            </Card>
            <Card>
              <CardHeader trailing={<Trail info="Linear response validity: predicted Δμ vs realized." tag="CuspLinearization" />}>linearization check</CardHeader>
              <CardBody><LinearizationTrace steps={steps} selected={index} /></CardBody>
            </Card>
          </Grid>

          {/* Row 4: root locus, plant residual, selected values */}
          <Grid columns={3} gap={12}>
            <Card>
              <CardHeader trailing={<Trail info="Root-locus: frozen eigenvalues as alpha varies." tag="CuspRootLocus" />}>eigs vs alpha</CardHeader>
              <CardBody><RootLocusTrace current={current} ridge={ridge} useKlPenalty={useKlPenalty} klStrength={klStrength} /></CardBody>
            </Card>
            <Card>
              <CardHeader trailing={<Trail info="Plant disequilibrium residual." tag="CuspPlantResidual" />}>plant residual</CardHeader>
              <CardBody><PlantResidualTrace steps={steps} selected={index} /></CardBody>
            </Card>
            <Card>
              <CardHeader trailing={<Info text="Selected step values." />}>selected values</CardHeader>
              <CardBody>
                <Grid columns={2} gap={8}>
                  <Stat value={fmt(current.a)} label="a projection" />
                  <Stat value={fmt(current.b)} label="b projection" />
                  <Stat value={fmt(current.w)} label="tracked w" />
                  <Stat value={fmt(current.posteriorMean)} label="posterior E[w]" />
                  <Stat value={fmt(Math.sqrt(current.chiA ** 2 + current.chiB ** 2))} label="||chi||" />
                  <Stat value={fmt(current.eigMaxAbs)} label="max |eig|" />
                </Grid>
              </CardBody>
            </Card>
          </Grid>
        </Stack>
      </Grid>

    </Stack>
  )
}

register({
  id: 'cusp-branch-tracking',
  name: 'Cusp Branch Tracking',
  category: 'simulation',
  description: 'Interactive cusp catastrophe simulation with covariance-based data controller, branch tracking, and control diagnostics',
  tags: ['patterning', 'catastrophe', 'cusp', 'control-theory', 'simulation'],
  schema: {
    description: 'Self-contained simulation with interactive controls. No external data required.',
    fields: [],
  },
  component: CuspBranchTracking,
  sampleData: {},
  display: 'full',
})
