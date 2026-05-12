import type { ComponentMeta } from '@/types/schema'
import { Link } from 'react-router-dom'

const CATEGORY_COLORS: Record<string, string> = {
  chart: 'bg-violet-50 text-violet-600 border-violet-200',
  'data-display': 'bg-cyan-50 text-cyan-600 border-cyan-200',
  simulation: 'bg-amber-50 text-amber-600 border-amber-200',
  layout: 'bg-emerald-50 text-emerald-600 border-emerald-200',
}

export function ComponentCard({ meta }: { meta: ComponentMeta }) {
  return (
    <Link
      to={`/component/${meta.id}`}
      className="group block rounded-xl border border-zinc-200 bg-white p-5 hover:border-zinc-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-medium text-zinc-800 group-hover:text-zinc-950 transition-colors">
          {meta.name}
        </h3>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[meta.category] ?? 'bg-zinc-100 text-zinc-500'}`}>
          {meta.category}
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-500 line-clamp-2">{meta.description}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {meta.tags?.map(tag => (
          <span key={tag} className="text-[10px] text-zinc-500 bg-zinc-100 rounded px-1.5 py-0.5">
            {tag}
          </span>
        ))}
      </div>
      <div className="mt-3 text-xs text-zinc-400">
        {meta.schema.fields.filter(f => f.required).length} required fields · {meta.schema.fields.length} total
      </div>
    </Link>
  )
}
