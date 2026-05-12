import { useState, useMemo } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { register } from '@/registry'

export interface DataTableProps {
  data: Array<Record<string, unknown>>
  columns?: string[]
  title?: string
  pageSize?: number
}

export function DataTableComponent({ data, columns: columnsProp, title, pageSize = 10 }: DataTableProps) {
  const columns = useMemo(() => columnsProp ?? (data.length > 0 ? Object.keys(data[0]) : []), [columnsProp, data])
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [data, sortKey, sortDir])

  const pageCount = Math.ceil(sorted.length / pageSize)
  const pageData = sorted.slice(page * pageSize, (page + 1) * pageSize)

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return (
    <div className="w-full">
      {title && <h3 className="text-sm font-medium text-zinc-600 mb-2">{title}</h3>}
      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50">
              {columns.map(col => (
                <th
                  key={col}
                  className="px-4 py-2 text-left font-medium text-zinc-500 cursor-pointer hover:text-zinc-800 select-none"
                  onClick={() => toggleSort(col)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col}
                    {sortKey === col && (sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.map((row, i) => (
              <tr key={i} className="border-b border-zinc-100 hover:bg-zinc-50">
                {columns.map(col => (
                  <td key={col} className="px-4 py-2 text-zinc-700 font-mono text-xs">
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-2 text-xs text-zinc-500">
          <span>{sorted.length} rows</span>
          <div className="flex gap-2">
            <button
              className="px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 disabled:opacity-30"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
            >
              Prev
            </button>
            <span className="px-2 py-1">{page + 1} / {pageCount}</span>
            <button
              className="px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 disabled:opacity-30"
              disabled={page >= pageCount - 1}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function formatCell(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

register<DataTableProps>({
  id: 'data-table',
  name: 'Data Table',
  category: 'data-display',
  description: 'Sortable, paginated table for displaying structured data',
  tags: ['table', 'data', 'tabular'],
  schema: {
    fields: [
      { name: 'data', type: 'record', required: true, description: 'Array of row objects' },
      { name: 'columns', type: 'string[]', description: 'Column keys to display (defaults to all keys)' },
      { name: 'title', type: 'string', description: 'Table title' },
      { name: 'pageSize', type: 'number', description: 'Rows per page (default 10)' },
    ],
  },
  component: DataTableComponent,
  sampleData: {
    title: 'Experiment Results',
    data: [
      { run: 'run_001', lr: 0.001, batch_size: 32, accuracy: 0.9234, loss: 0.2341 },
      { run: 'run_002', lr: 0.0005, batch_size: 64, accuracy: 0.9412, loss: 0.1987 },
      { run: 'run_003', lr: 0.01, batch_size: 16, accuracy: 0.8901, loss: 0.3456 },
      { run: 'run_004', lr: 0.001, batch_size: 128, accuracy: 0.9356, loss: 0.2102 },
      { run: 'run_005', lr: 0.0001, batch_size: 32, accuracy: 0.9189, loss: 0.2567 },
    ],
  },
})
