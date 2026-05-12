import type { ReactNode } from 'react'
import type { Step, ModelConfig, DataMode, PosteriorMode } from './types'

export interface CuspChannelState {
  steps: Step[]
  selected: number
  config: ModelConfig
  target: number
  beta: number
  spring: number
  posteriorMode: PosteriorMode
  dataMode: DataMode
  qReference: number[]
  originalA: number
  originalB: number
  ridge: number
  useKlPenalty: boolean
  klStrength: number
  controlsElement?: ReactNode
}
