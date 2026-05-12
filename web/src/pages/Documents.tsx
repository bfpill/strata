import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import db from '@/lib/db'
import { LiveDoc } from '@/components/core/content/LiveDoc'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

interface TimelineItem {
  type: 'year' | 'month-tick' | 'entry'
  year?: number
  month?: number
  entry?: { slug: string; title: string; updatedAt: number }
  side?: 'left' | 'right'
}

function buildTimeline(drafts: Array<{ slug: string; title: string; updatedAt: number }>): TimelineItem[] {
  const sorted = [...drafts].sort((a, b) => b.updatedAt - a.updatedAt)
  const items: TimelineItem[] = []
  let lastYear: number | null = null
  let lastMonth: number | null = null
  let sideCounter = 0

  for (const entry of sorted) {
    const d = new Date(entry.updatedAt)
    const y = d.getFullYear()
    const m = d.getMonth()

    if (y !== lastYear) {
      if (lastYear !== null && lastMonth !== null) {
        for (let t = lastMonth - 1; t >= 0; t--) items.push({ type: 'month-tick', month: t, year: lastYear })
      }
      items.push({ type: 'year', year: y })
      if (lastYear !== null) {
        for (let t = 11; t > m; t--) items.push({ type: 'month-tick', month: t, year: y })
      }
      lastYear = y
    } else if (lastMonth !== null) {
      for (let t = lastMonth - 1; t > m; t--) items.push({ type: 'month-tick', month: t, year: y })
    }

    items.push({ type: 'entry', entry, side: sideCounter % 2 === 0 ? 'right' : 'left' })
    sideCounter++
    lastMonth = m
  }
  return items
}

function DocBrowser() {
  const [slugInput, setSlugInput] = useState('')
  const navigate = useNavigate()

  const { data, isLoading } = db.useQuery({ draftPosts: {} })
  const drafts = (data?.draftPosts ?? [])
    .filter((d: { updatedAt?: number }) => d.updatedAt)
    .map((d: { slug: string; title: string; updatedAt: number }) => ({ slug: d.slug, title: d.title, updatedAt: d.updatedAt }))

  const timeline = buildTimeline(drafts)

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 px-6 py-8">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 transition-colors mb-4">
          <ArrowLeft size={14} />
          Back
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900">Documents</h1>
        <p className="mt-1 text-sm text-zinc-500">Live-rendered content from Google Docs via InstantDB</p>
      </header>

      <main className="max-w-3xl mx-auto px-6 pt-8 pb-32">
        {/* Slug input */}
        <form
          onSubmit={e => { e.preventDefault(); if (slugInput.trim()) navigate(`/doc/${slugInput.trim()}`) }}
          className="flex gap-2 mb-12"
        >
          <input
            type="text"
            value={slugInput}
            onChange={e => setSlugInput(e.target.value)}
            placeholder="Open by slug..."
            className="flex-1 bg-white border border-zinc-200 rounded-lg px-4 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          />
          <button
            type="submit"
            disabled={!slugInput.trim()}
            className="px-4 py-2 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 disabled:opacity-30 transition-colors"
          >
            Open
          </button>
        </form>

        {/* Timeline */}
        {isLoading ? (
          <p className="text-xs font-mono text-zinc-400 tracking-wide">Loading...</p>
        ) : timeline.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-12">No synced documents yet.</p>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-300 hidden md:block" />
            <div className="absolute left-4 top-0 bottom-0 w-px bg-zinc-300 md:hidden block" />

            {timeline.map((item, idx) => {
              if (item.type === 'year') {
                return (
                  <div key={`y-${item.year}`} className="relative flex items-center justify-center py-6 md:py-8">
                    <span className="hidden md:block relative z-10 bg-blue-50/50 px-4 font-mono text-[13px] font-medium text-zinc-900 tracking-widest">
                      {item.year}
                    </span>
                    <span className="md:hidden relative z-10 pl-10 font-mono text-[13px] font-medium text-zinc-900 tracking-widest">
                      {item.year}
                    </span>
                    <div className="hidden md:block absolute left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-zinc-900" />
                    <div className="md:hidden absolute left-4 -translate-x-1/2 w-2 h-2 rounded-full bg-zinc-900" />
                  </div>
                )
              }

              if (item.type === 'month-tick') {
                return (
                  <div key={`m-${item.year}-${item.month}`} className="relative h-6 md:h-7">
                    <div className="hidden md:block absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[7px] h-px bg-zinc-300" />
                    <div className="md:hidden absolute left-4 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[7px] h-px bg-zinc-300" />
                  </div>
                )
              }

              if (item.type === 'entry' && item.entry) {
                const e = item.entry
                const d = new Date(e.updatedAt)
                const monthLabel = MONTH_NAMES[d.getMonth()]
                const isRight = item.side === 'right'

                const card = (align: 'left' | 'right' | 'mobile') => {
                  const textAlign = align === 'left' ? 'text-right' : 'text-left'
                  const pad = align === 'left' ? 'pr-2' : align === 'right' ? 'pl-2' : 'pl-10'
                  return (
                    <Link
                      to={`/doc/${e.slug}`}
                      className={`group block ${textAlign} no-underline ${pad} hover:opacity-80 transition-opacity`}
                    >
                      <time className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest leading-none inline-block">
                        {monthLabel} {d.getDate()}
                      </time>
                      <h2 className="font-serif text-[15px] text-zinc-500 group-hover:text-blue-600 transition-colors leading-snug mt-1">
                        {e.title || e.slug}
                      </h2>
                      <p className="text-[10px] font-mono text-zinc-400 mt-0.5">{e.slug}</p>
                    </Link>
                  )
                }

                return (
                  <div key={`e-${idx}`} className="relative py-0.5">
                    {/* Desktop */}
                    <div className="hidden md:flex items-start">
                      <div className="w-[calc(50%-24px)] -mt-[14px]">{!isRight && card('left')}</div>
                      <div className="w-12 shrink-0 flex items-center h-0 relative z-10">
                        <div className={`flex-1 h-px ${!isRight ? 'bg-zinc-300' : 'bg-transparent'}`} />
                        <div className="shrink-0 w-[9px] h-[9px] rounded-full border-[1.5px] border-zinc-900 bg-white" />
                        <div className={`flex-1 h-px ${isRight ? 'bg-zinc-300' : 'bg-transparent'}`} />
                      </div>
                      <div className="w-[calc(50%-24px)] -mt-[14px]">{isRight && card('right')}</div>
                    </div>
                    {/* Mobile */}
                    <div className="md:hidden relative">
                      <div className="absolute left-4 top-[5px] -translate-x-1/2 w-[9px] h-[9px] rounded-full border-[1.5px] border-zinc-900 bg-white z-10" />
                      <div className="absolute left-[21px] top-[8px] w-[15px] h-px bg-zinc-300" />
                      {card('mobile')}
                    </div>
                  </div>
                )
              }

              return null
            })}
          </div>
        )}
      </main>
    </div>
  )
}

function DocViewer({ slug }: { slug: string }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <Link to="/doc" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 transition-colors">
            <ArrowLeft size={14} />
            Documents
          </Link>
          <span className="text-xs font-mono text-zinc-500 bg-zinc-100 px-2 py-1 rounded border border-zinc-200">
            {slug}
          </span>
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-6 py-8">
        <LiveDoc slug={slug} />
      </div>
    </div>
  )
}

export function DocPage() {
  const { slug } = useParams<{ slug: string }>()
  if (!slug) return <DocBrowser />
  return <DocViewer slug={slug} />
}
