import { useMemo } from 'react'
import type { ComponentType } from 'react'
import db from '@/lib/db'
import { MdxRenderer } from './MdxRenderer'
import { register, getMdxComponents } from '@/registry'

export interface LiveDocProps {
  slug: string
  components?: Record<string, ComponentType<Record<string, unknown>>>
  className?: string
}

export function LiveDoc({ slug, components: componentOverrides = {}, className = '' }: LiveDocProps) {
  const allComponents = useMemo(() => ({ ...getMdxComponents(), ...componentOverrides }), [componentOverrides])
  const { data, isLoading, error } = db.useQuery(
    slug ? { draftPosts: { $: { where: { slug } } } } : null
  )

  const post = data?.draftPosts?.[0]

  if (!slug) {
    return (
      <div className="text-center py-12 text-zinc-400 text-sm font-mono">
        No slug provided.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="text-center py-12 text-zinc-400 text-sm font-mono">
        Loading...
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-500 text-sm font-mono">
        Error: {error.message}
      </div>
    )
  }

  if (!post) {
    return (
      <div className="text-center py-12 text-zinc-400 text-sm font-mono">
        No draft found for <strong className="text-zinc-700">{slug}</strong>.
        <br />
        Has the Google Doc been synced?
      </div>
    )
  }

  return (
    <MdxRenderer
      content={post.content}
      components={allComponents}
      className={className}
    />
  )
}

register({
  id: 'live-doc',
  name: 'Live Doc',
  category: 'data-display',
  description: 'Live-rendered MDX content from InstantDB, synced from Google Docs. Supports KaTeX, citations, embeds, and custom components.',
  tags: ['content', 'mdx', 'live', 'google-docs', 'instantdb'],
  schema: {
    fields: [
      { name: 'slug', type: 'string', required: true, description: 'InstantDB draft post slug' },
      { name: 'components', type: 'record', description: 'Custom MDX component overrides' },
      { name: 'className', type: 'string', description: 'Additional CSS classes' },
    ],
  },
  component: LiveDoc as unknown as ComponentType<Record<string, unknown>>,
  sampleData: { slug: '' },
})
