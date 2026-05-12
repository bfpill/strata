import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getComponent, getEmbedTag, getEmbedSnippet } from '@/registry'
import { ArrowLeft, Copy, Check } from 'lucide-react'

function CopyEmbedButton({ meta }: { meta: Parameters<typeof getEmbedSnippet>[0] }) {
  const [copied, setCopied] = useState(false)
  const snippet = getEmbedSnippet(meta)

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(snippet)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy embed'}
    </button>
  )
}

export function ComponentPage() {
  const { id } = useParams<{ id: string }>()
  const meta = id ? getComponent(id) : undefined

  if (!meta) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-500">Component not found</p>
          <Link to="/" className="text-sm text-violet-600 hover:text-violet-500 mt-2 inline-block">
            Back to catalog
          </Link>
        </div>
      </div>
    )
  }

  const Component = meta.component
  const hasSchema = meta.schema.fields.length > 0
  const hasSampleData = Object.keys(meta.sampleData as Record<string, unknown>).length > 0
  const snippet = getEmbedSnippet(meta)

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 px-6 py-4">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 transition-colors mb-3">
          <ArrowLeft size={14} />
          Back
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">{meta.name}</h1>
            <p className="text-sm text-zinc-500 mt-1">{meta.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <CopyEmbedButton meta={meta} />
            <span className="text-xs font-mono text-zinc-500 bg-zinc-100 px-2 py-1 rounded border border-zinc-200">
              {meta.id}
            </span>
          </div>
        </div>
      </header>

      {/* Embed snippet bar */}
      <div className="px-6 py-3 border-b border-zinc-100 bg-zinc-50/50 flex items-center gap-3">
        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Embed</span>
        <code className="flex-1 text-xs font-mono text-zinc-700 bg-white border border-zinc-200 rounded-md px-3 py-1.5 overflow-x-auto">
          {snippet}
        </code>
        <span className="text-[10px] text-zinc-400">
          Tag: <code className="text-zinc-600">{getEmbedTag(meta)}</code>
        </span>
      </div>

      {hasSchema || hasSampleData ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 lg:gap-0">
          <div className="lg:col-span-2 p-6 border-b lg:border-b-0 lg:border-r border-zinc-200">
            <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">Preview</h2>
            <div className="h-80 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <Component {...meta.sampleData as Record<string, unknown>} />
            </div>
          </div>

          <div className="p-6">
            {hasSchema && (
              <>
                <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">Schema</h2>
                <div className="space-y-3">
                  {meta.schema.fields.map(field => (
                    <div key={field.name} className="border border-zinc-200 rounded-lg p-3 bg-zinc-50">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-zinc-800">{field.name}</span>
                        <span className="text-[10px] font-mono text-zinc-500 bg-zinc-200 px-1.5 py-0.5 rounded">{field.type}</span>
                        {field.required && <span className="text-[10px] text-amber-600">required</span>}
                      </div>
                      {field.description && (
                        <p className="text-xs text-zinc-500 mt-1">{field.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {hasSampleData && (
              <>
                <h2 className={`text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3 ${hasSchema ? 'mt-6' : ''}`}>Sample Data</h2>
                <pre className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto">
                  {JSON.stringify(meta.sampleData, null, 2)}
                </pre>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="p-6">
          <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">Preview</h2>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <Component {...meta.sampleData as Record<string, unknown>} />
          </div>
        </div>
      )}
    </div>
  )
}
