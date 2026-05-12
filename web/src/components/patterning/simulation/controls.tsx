import type { Policy, PosteriorMode, ModelPreset, DataMode } from './types'
import { normalizeSimplexWeights } from './engine'
import { fmt, Info } from './helpers'
import { tokens } from '@/theme/tokens'
import { Card, CardHeader, CardBody, Stack, Row, Grid, Pill, Toggle } from '@/components/core/layouts'

const t = tokens

function MiniSlider({ label, value, min, max, step, disabled, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number
  disabled?: boolean; display?: string; onChange: (v: number) => void
}) {
  return (
    <Stack gap={4}>
      <Row justify="space-between" align="center">
        <span className="text-xs text-zinc-500">{label}</span>
        <code className="text-xs bg-zinc-100 px-1.5 py-0.5 rounded text-zinc-700">{display ?? fmt(value, 2)}</code>
      </Row>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={e => onChange(Number(e.currentTarget.value))} className="w-full accent-blue-500" />
    </Stack>
  )
}

function RelaxationPad({ fastSteps, setFastSteps, gradStepSize, setGradStepSize, disabled }: {
  fastSteps: number; setFastSteps: (v: number) => void
  gradStepSize: number; setGradStepSize: (v: number) => void; disabled: boolean
}) {
  const width = 260, height = 145, pad = 24
  const minLogStep = Math.log10(0.0005), maxLogStep = Math.log10(0.18)
  const xNorm = (Math.log10(gradStepSize) - minLogStep) / (maxLogStep - minLogStep)
  const yNorm = (fastSteps - 1) / (80 - 1)
  const cx = pad + Math.max(0, Math.min(1, xNorm)) * (width - 2 * pad)
  const cy = height - pad - Math.max(0, Math.min(1, yNorm)) * (height - 2 * pad)

  const updateFromPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return
    const rect = event.currentTarget.getBoundingClientRect()
    const px = Math.max(pad, Math.min(width - pad, event.clientX - rect.left))
    const py = Math.max(pad, Math.min(height - pad, event.clientY - rect.top))
    const nextX = (px - pad) / (width - 2 * pad)
    const nextY = 1 - (py - pad) / (height - 2 * pad)
    setGradStepSize(10 ** (minLogStep + nextX * (maxLogStep - minLogStep)))
    setFastSteps(Math.round(1 + nextY * (80 - 1)))
  }

  return (
    <Stack gap={6}>
      <svg viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 145, cursor: disabled ? 'not-allowed' : 'crosshair', opacity: disabled ? 0.55 : 1 }}
        onPointerDown={updateFromPointer}
        onPointerMove={e => { if (e.buttons === 1) updateFromPointer(e) }}>
        <title>2D relaxation control. Horizontal: step size. Vertical: gradient steps.</title>
        <rect width={width} height={height} fill={t.bg.editor} />
        <rect x={pad} y={pad} width={width - 2 * pad} height={height - 2 * pad} fill={t.fill.tertiary} stroke={t.stroke.primary} />
        <circle cx={cx} cy={cy} r={7} fill={t.accent.primary} />
        <circle cx={cx} cy={cy} r={12} fill="none" stroke={t.accent.primary} opacity={0.45} />
        {disabled && <text x={pad + 12} y={height / 2} fill={t.text.primary} fontSize={12}>disabled: instant equilibration</text>}
        <text x={pad} y={height - 6} fill={t.text.tertiary} fontSize={11}>log small η</text>
        <text x={width - pad - 58} y={height - 6} fill={t.text.tertiary} fontSize={11}>log large η</text>
        <text x={pad + 4} y={18} fill={t.text.tertiary} fontSize={11}>more relaxation</text>
      </svg>
      <p className="text-xs text-zinc-500">
        {disabled
          ? <>Instant equilibration snaps <code className="bg-zinc-100 px-1 rounded text-zinc-700">w</code> to the nearest stable minimum.</>
          : <>Step size = <code className="bg-zinc-100 px-1 rounded text-zinc-700">{gradStepSize.toFixed(4)}</code>; steps/update = <code className="bg-zinc-100 px-1 rounded text-zinc-700">{fastSteps}</code>.</>}
      </p>
    </Stack>
  )
}

export function CompactControls(props: {
  modelPreset: ModelPreset; setModelPreset: (v: ModelPreset) => void
  dataMode: DataMode; setDataMode: (v: DataMode) => void
  qReference: number[]; setQReference: (v: number[]) => void
  policy: Policy; setPolicy: (v: Policy) => void
  posteriorMode: PosteriorMode; setPosteriorMode: (v: PosteriorMode) => void
  useKlPenalty: boolean; setUseKlPenalty: (v: boolean) => void
  instantEquilibrate: boolean; setInstantEquilibrate: (v: boolean) => void
  initialW: number; setInitialW: (v: number) => void
  controllerGain: number; setControllerGain: (v: number) => void
  beta: number; setBeta: (v: number) => void
  target: number; setTarget: (v: number) => void
  spring: number; setSpring: (v: number) => void
  ridge: number; setRidge: (v: number) => void
  klStrength: number; setKlStrength: (v: number) => void
  fastSteps: number; setFastSteps: (v: number) => void
  gradStepSize: number; setGradStepSize: (v: number) => void
}) {
  const {
    modelPreset, setModelPreset, dataMode, setDataMode, qReference, setQReference,
    policy, setPolicy, posteriorMode, setPosteriorMode,
    useKlPenalty, setUseKlPenalty, instantEquilibrate, setInstantEquilibrate,
    initialW, setInitialW, controllerGain, setControllerGain,
    beta, setBeta, target, setTarget, spring, setSpring,
    ridge, setRidge, klStrength, setKlStrength,
    fastSteps, setFastSteps, gradStepSize, setGradStepSize,
  } = props

  const updateQReference = (index: number, value: number) => {
    const next = [...qReference]
    const clipped = Math.max(0.01, Math.min(0.97, value))
    const otherSum = qReference.reduce((sum, x, i) => i === index ? sum : sum + x, 0)
    next[index] = clipped
    for (let i = 0; i < 4; i++) {
      if (i !== index) next[i] = otherSum > 0 ? (qReference[i] / otherSum) * (1 - clipped) : (1 - clipped) / 3
    }
    setQReference(normalizeSimplexWeights(next))
  }

  return (
    <Card>
      <CardHeader trailing={<Info text="Controls for model, controller, posterior, and relaxation." />}>
        controls
      </CardHeader>
      <CardBody>
        <Stack gap={10}>
          <Row gap={6} align="center" wrap>
            <span className="text-xs text-zinc-500">model</span>
            <Pill size="sm" active={modelPreset === 'canonical'} onClick={() => setModelPreset('canonical')}>canon</Pill>
            <Pill size="sm" active={modelPreset === 'sharp'} onClick={() => setModelPreset('sharp')}>sharp</Pill>
            <Pill size="sm" active={modelPreset === 'tilted'} onClick={() => setModelPreset('tilted')}>bias</Pill>
          </Row>
          <Row gap={6} align="center" wrap>
            <span className="text-xs text-zinc-500">data</span>
            <Pill size="sm" active={dataMode === 'coeff'} onClick={() => setDataMode('coeff')}>coeff</Pill>
            <Pill size="sm" active={dataMode === 'simplex'} onClick={() => setDataMode('simplex')}>simplex</Pill>
          </Row>
          <Row gap={6} align="center" wrap>
            <span className="text-xs text-zinc-500">policy</span>
            <Pill size="sm" active={policy === 'direct'} onClick={() => setPolicy('direct')}>direct</Pill>
            <Pill size="sm" active={policy === 'guard'} onClick={() => setPolicy('guard')}>guard</Pill>
            <Pill size="sm" active={policy === 'route'} onClick={() => setPolicy('route')}>route</Pill>
          </Row>
          <Row gap={6} align="center" wrap>
            <span className="text-xs text-zinc-500">posterior</span>
            <Pill size="sm" active={posteriorMode === 'global'} onClick={() => setPosteriorMode('global')}>global</Pill>
            <Pill size="sm" active={posteriorMode === 'local'} onClick={() => setPosteriorMode('local')}>local</Pill>
          </Row>
          <Grid columns={2} gap={8}>
            <Row gap={6} align="center"><Toggle checked={useKlPenalty} onChange={setUseKlPenalty} /><span className="text-xs text-zinc-500">KL</span></Row>
            <Row gap={6} align="center"><Toggle checked={instantEquilibrate} onChange={setInstantEquilibrate} /><span className="text-xs text-zinc-500">snap</span></Row>
          </Grid>
          <MiniSlider label="init w" value={initialW} min={-1.5} max={1.5} step={0.01} display={initialW.toFixed(2)} onChange={setInitialW} />
          <MiniSlider label="alpha" value={controllerGain} min={0.01} max={8} step={0.05} display={controllerGain.toFixed(2)} onChange={setControllerGain} />
          <MiniSlider label="target E[w]" value={target} min={-1.4} max={1.4} step={0.01} display={target.toFixed(2)} onChange={setTarget} />
          <MiniSlider label="beta" value={beta} min={1} max={80} step={1} display={beta.toFixed(0)} onChange={setBeta} />
          <MiniSlider label="spring" value={spring} min={0} max={40} step={0.5} disabled={posteriorMode === 'global'} display={spring.toFixed(1)} onChange={setSpring} />
          <MiniSlider label="ridge" value={Math.log10(ridge)} min={-5} max={0} step={0.05} display={ridge.toExponential(1)} onChange={v => setRidge(10 ** v)} />
          <MiniSlider label="KL strength" value={Math.log10(klStrength)} min={-4} max={1} step={0.05} disabled={!useKlPenalty} display={klStrength.toExponential(1)} onChange={v => setKlStrength(10 ** v)} />
          {dataMode === 'simplex' && (
            <Stack gap={6}>
              <span className="text-xs text-zinc-500">start weights q0</span>
              {qReference.map((qi, i) => (
                <MiniSlider key={i} label={`q${i}`} value={qi} min={0.01} max={0.97} step={0.01} display={qi.toFixed(2)} onChange={v => updateQReference(i, v)} />
              ))}
            </Stack>
          )}
          <RelaxationPad fastSteps={fastSteps} setFastSteps={setFastSteps} gradStepSize={gradStepSize} setGradStepSize={setGradStepSize} disabled={instantEquilibrate} />
        </Stack>
      </CardBody>
    </Card>
  )
}
