import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getAllComponents } from '@/registry'
import { ComponentCard } from './ComponentCard'
import type { ComponentMeta } from '@/types/schema'

const CATEGORIES: Array<ComponentMeta['category'] | 'all'> = ['all', 'chart', 'data-display', 'simulation', 'layout']

export function CatalogPage() {
  const components = getAllComponents()
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    let result = components
    if (filter !== 'all') result = result.filter(c => c.category === filter)
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.tags?.some(t => t.includes(q))
      )
    }
    return result
  }, [components, filter, search])

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 px-6 py-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">laminae</h1>
            <p className="mt-1 text-sm text-zinc-500">Component registry for data visualization</p>
          </div>
          <Link
            to="/doc"
            className="text-sm px-4 py-2 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 transition-colors"
          >
            Documents
          </Link>
        </div>
      </header>

      <div className="px-6 py-4 flex flex-col sm:flex-row gap-3 border-b border-zinc-200">
        <input
          type="text"
          placeholder="Search components..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400"
        />
        <div className="flex gap-1.5">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                filter === cat
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-50 text-zinc-500 hover:text-zinc-700 border border-zinc-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(meta => (
          <ComponentCard key={meta.id} meta={meta} />
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full text-center text-zinc-400 py-12">No components match your search.</p>
        )}
      </div>
    </div>
  )
}
