import { ResponsiveContainer, BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { register } from '@/registry'

export interface BarChartProps {
  data: Array<Record<string, unknown>>
  xKey: string
  yKeys: string[]
  title?: string
  colors?: string[]
  stacked?: boolean
}

const DEFAULT_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444', '#10b981']

export function BarChartComponent({ data, xKey, yKeys, title, colors = DEFAULT_COLORS, stacked = false }: BarChartProps) {
  return (
    <div className="w-full h-full min-h-64">
      {title && <h3 className="text-sm font-medium text-zinc-600 mb-2">{title}</h3>}
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
          <XAxis dataKey={xKey} stroke="#a1a1aa" fontSize={12} />
          <YAxis stroke="#a1a1aa" fontSize={12} />
          <Tooltip
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #e4e4e7', borderRadius: '8px' }}
            labelStyle={{ color: '#71717a' }}
          />
          <Legend />
          {yKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              fill={colors[i % colors.length]}
              stackId={stacked ? 'stack' : undefined}
              radius={stacked ? undefined : [4, 4, 0, 0]}
            />
          ))}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  )
}

register<BarChartProps>({
  id: 'bar-chart',
  name: 'Bar Chart',
  category: 'chart',
  description: 'Grouped or stacked bar chart for categorical comparisons',
  tags: ['chart', 'comparison', 'categorical'],
  schema: {
    fields: [
      { name: 'data', type: 'record', required: true, description: 'Array of data objects' },
      { name: 'xKey', type: 'string', required: true, description: 'Key for category axis' },
      { name: 'yKeys', type: 'string[]', required: true, description: 'Keys for value bars' },
      { name: 'title', type: 'string', description: 'Chart title' },
      { name: 'colors', type: 'string[]', description: 'Custom color palette' },
      { name: 'stacked', type: 'boolean', description: 'Stack bars instead of grouping' },
    ],
  },
  component: BarChartComponent,
  sampleData: {
    title: 'Benchmark Scores by Model',
    xKey: 'model',
    yKeys: ['accuracy', 'f1_score'],
    data: [
      { model: 'GPT-4', accuracy: 92, f1_score: 89 },
      { model: 'Claude 3', accuracy: 94, f1_score: 91 },
      { model: 'Gemini', accuracy: 88, f1_score: 85 },
      { model: 'Llama 3', accuracy: 82, f1_score: 79 },
    ],
  },
  display: 'wide',
})
