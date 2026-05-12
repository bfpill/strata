import { useState, useEffect, useCallback } from 'react'
import { LineChartComponent } from '@/components/core/charts/LineChart'
import { register } from '@/registry'

export interface RandomWalkProps {
  steps: number
  series: number
  drift?: number
  volatility?: number
  title?: string
}

function generateWalk(steps: number, drift: number, volatility: number): number[] {
  const values = [100]
  for (let i = 1; i < steps; i++) {
    const prev = values[i - 1]
    values.push(prev * (1 + drift + volatility * (Math.random() - 0.5) * 2))
  }
  return values
}

export function RandomWalkComponent({ steps, series, drift = 0.0002, volatility = 0.015, title }: RandomWalkProps) {
  const [data, setData] = useState<Array<Record<string, unknown>>>([])
  const [seriesKeys, setSeriesKeys] = useState<string[]>([])

  const simulate = useCallback(() => {
    const keys = Array.from({ length: series }, (_, i) => `series_${i + 1}`)
    const walks = keys.map(() => generateWalk(steps, drift, volatility))
    const rows = Array.from({ length: steps }, (_, step) => {
      const row: Record<string, unknown> = { step: step + 1 }
      keys.forEach((key, si) => { row[key] = Math.round(walks[si][step] * 100) / 100 })
      return row
    })
    setSeriesKeys(keys)
    setData(rows)
  }, [steps, series, drift, volatility])

  useEffect(() => { simulate() }, [simulate])

  return (
    <div className="w-full h-full">
      <div className="flex items-center justify-between mb-2">
        {title && <h3 className="text-sm font-medium text-zinc-600">{title}</h3>}
        <button
          onClick={simulate}
          className="text-xs px-3 py-1 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-700 transition-colors"
        >
          Re-simulate
        </button>
      </div>
      <LineChartComponent data={data} xKey="step" yKeys={seriesKeys} />
    </div>
  )
}

register<RandomWalkProps>({
  id: 'random-walk',
  name: 'Random Walk',
  category: 'simulation',
  description: 'Simulates geometric Brownian motion paths — a composable example that renders a LineChart',
  tags: ['simulation', 'stochastic', 'finance'],
  schema: {
    fields: [
      { name: 'steps', type: 'number', required: true, description: 'Number of time steps' },
      { name: 'series', type: 'number', required: true, description: 'Number of independent walks' },
      { name: 'drift', type: 'number', description: 'Drift per step (default 0.0002)' },
      { name: 'volatility', type: 'number', description: 'Volatility (default 0.015)' },
      { name: 'title', type: 'string', description: 'Chart title' },
    ],
  },
  component: RandomWalkComponent,
  sampleData: {
    steps: 200,
    series: 5,
    title: 'Geometric Brownian Motion',
  },
  display: 'wide',
})
