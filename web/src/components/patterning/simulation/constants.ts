export const W_MIN = -2.5
export const W_MAX = 2.5
export const PLOT_A_MIN = -1.7
export const PLOT_A_MAX = 1.2
export const PLOT_B_MIN = -1.15
export const PLOT_B_MAX = 1.15
export const COEFF_LIMIT = 8
export const A0 = -1.0
export const B0 = 0.0
export const SIMPLEX_SCALE = 2
export const W_N = 701

export const ATOMS = [
  { a: SIMPLEX_SCALE, b: 0, label: 'quad +' },
  { a: -SIMPLEX_SCALE, b: 0, label: 'quad -' },
  { a: 0, b: SIMPLEX_SCALE, label: 'tilt +' },
  { a: 0, b: -SIMPLEX_SCALE, label: 'tilt -' },
]

export const DEFAULT_Q0 = [0.2, 0.7, 0.05, 0.05]
