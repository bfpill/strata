import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ZAxis } from 'recharts'
import { register } from '@/registry'

export interface ScatterPlotProps {
  data: Array<Record<string, number>>
  xKey: string
  yKey: string
  sizeKey?: string
  title?: string
  color?: string
}

export function ScatterPlotComponent({ data, xKey, yKey, sizeKey, title, color = '#8b5cf6' }: ScatterPlotProps) {
  return (
    <div className="w-full h-full min-h-64">
      {title && <h3 className="text-sm font-medium text-zinc-600 mb-2">{title}</h3>}
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
          <XAxis dataKey={xKey} stroke="#a1a1aa" fontSize={12} name={xKey} />
          <YAxis dataKey={yKey} stroke="#a1a1aa" fontSize={12} name={yKey} />
          {sizeKey && <ZAxis dataKey={sizeKey} range={[20, 400]} name={sizeKey} />}
          <Tooltip
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #e4e4e7', borderRadius: '8px' }}
            labelStyle={{ color: '#71717a' }}
          />
          <Scatter data={data} fill={color} fillOpacity={0.6} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

register<ScatterPlotProps>({
  id: 'scatter-plot',
  name: 'Scatter Plot',
  category: 'chart',
  description: 'Scatter plot with optional bubble sizing for exploring relationships between variables',
  tags: ['chart', 'correlation', 'distribution'],
  schema: {
    fields: [
      { name: 'data', type: 'record', required: true, description: 'Array of numeric data objects' },
      { name: 'xKey', type: 'string', required: true, description: 'Key for x-axis values' },
      { name: 'yKey', type: 'string', required: true, description: 'Key for y-axis values' },
      { name: 'sizeKey', type: 'string', description: 'Key for bubble size' },
      { name: 'title', type: 'string', description: 'Chart title' },
      { name: 'color', type: 'string', description: 'Dot color' },
    ],
  },
  component: ScatterPlotComponent,
  sampleData: {
    title: 'Parameter Count vs Performance',
    xKey: 'params_b',
    yKey: 'score',
    sizeKey: 'training_tokens_t',
    data: Array.from({ length: 40 }, () => {
      const params = Math.random() * 70 + 1
      return {
        params_b: Math.round(params * 10) / 10,
        score: Math.min(98, 60 + Math.log(params) * 8 + (Math.random() - 0.5) * 10),
        training_tokens_t: Math.round(params * (0.5 + Math.random()) * 10) / 10,
      }
    }),
  },
  display: 'wide',
})
