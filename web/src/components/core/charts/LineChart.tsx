import { ResponsiveContainer, LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { register } from '@/registry'

export interface LineChartProps {
  data: Array<Record<string, unknown>>
  xKey: string
  yKeys: string[]
  title?: string
  colors?: string[]
}

const DEFAULT_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444', '#10b981']

export function LineChartComponent({ data, xKey, yKeys, title, colors = DEFAULT_COLORS }: LineChartProps) {
  return (
    <div className="w-full h-full min-h-64">
      {title && <h3 className="text-sm font-medium text-zinc-600 mb-2">{title}</h3>}
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
          <XAxis dataKey={xKey} stroke="#a1a1aa" fontSize={12} />
          <YAxis stroke="#a1a1aa" fontSize={12} />
          <Tooltip
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #e4e4e7', borderRadius: '8px' }}
            labelStyle={{ color: '#71717a' }}
          />
          <Legend />
          {yKeys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  )
}

register<LineChartProps>({
  id: 'line-chart',
  name: 'Line Chart',
  category: 'chart',
  description: 'Multi-series line chart for time series or continuous data',
  tags: ['chart', 'time-series', 'trend'],
  schema: {
    fields: [
      { name: 'data', type: 'record', required: true, description: 'Array of data objects' },
      { name: 'xKey', type: 'string', required: true, description: 'Key for x-axis values' },
      { name: 'yKeys', type: 'string[]', required: true, description: 'Keys for y-axis series' },
      { name: 'title', type: 'string', description: 'Chart title' },
      { name: 'colors', type: 'string[]', description: 'Custom color palette' },
    ],
  },
  component: LineChartComponent,
  sampleData: {
    title: 'Model Loss Over Epochs',
    xKey: 'epoch',
    yKeys: ['train_loss', 'val_loss'],
    data: Array.from({ length: 50 }, (_, i) => ({
      epoch: i + 1,
      train_loss: 2.5 * Math.exp(-0.06 * i) + 0.1 + Math.random() * 0.05,
      val_loss: 2.5 * Math.exp(-0.05 * i) + 0.15 + Math.random() * 0.08,
    })),
  },
  display: 'wide',
})
