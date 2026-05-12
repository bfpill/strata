export type Policy = 'direct' | 'guard' | 'route'
export type PosteriorMode = 'global' | 'local'
export type ModelPreset = 'canonical' | 'sharp' | 'tilted'
export type DataMode = 'coeff' | 'simplex'

export type ModelConfig = {
  quartic: number
  quadraticScale: number
  bias: number
  label: string
}

export type Stats = {
  mean: number
  variance: number
  chiA: number
  chiB: number
}

export type CriticalPoint = {
  w: number
  stable: boolean
  hessian: number
}

export type Step = {
  i: number
  a: number
  b: number
  w: number
  posteriorMean: number
  chiA: number
  chiB: number
  err: number
  critical: CriticalPoint[]
  localHessian: number
  folded: boolean
  foldType: 'none' | 'birth' | 'death'
  guarded: boolean
  routed: boolean
  eigMaxAbs: number
  eigControlled: number
  eigAnchor: number
  effort: number
  klStep: number
  klFromReference: number
  predictedDeltaMu: number
  realizedDeltaMu: number
  linearizationError: number
  plantResidual: number
  relaxPath: number[]
  q?: number[]
}
