import { useMemo } from 'react'
import db from '@/lib/db'
import { usePublish } from '@/lib/channel'
import { register } from '@/registry'

export interface GraphQueryProps {
  query: Record<string, unknown>
  channel?: string
}

export function GraphQuery({ query, channel }: GraphQueryProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading, error } = db.useQuery(query as any)
  const publish = usePublish(channel)

  useMemo(() => {
    if (data && channel) {
      publish({ ...(data as Record<string, unknown>), _loading: false })
    }
  }, [data, channel, publish])

  if (isLoading) {
    return (
      <div className="text-center py-4 text-xs text-zinc-400 font-mono">
        Querying graph...
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-4 text-xs text-red-500 font-mono">
        Query error: {error.message}
      </div>
    )
  }

  if (!channel) {
    return (
      <pre className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto">
        {JSON.stringify(data, null, 2)}
      </pre>
    )
  }

  return null
}

register({
  id: 'graph-query',
  name: 'Graph Query',
  category: 'data-display',
  description: 'Queries the InstantDB graph and optionally publishes results to a channel for other components to consume.',
  tags: ['graph', 'query', 'instantdb', 'data'],
  schema: {
    fields: [
      { name: 'query', type: 'record', required: true, description: 'InstantDB query object' },
      { name: 'channel', type: 'string', description: 'Channel to publish results to' },
    ],
  },
  component: GraphQuery as unknown as React.ComponentType<Record<string, unknown>>,
  sampleData: { query: { experiments: { $: { limit: 5 } } } },
})
