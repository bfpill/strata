import type { ComponentType, FC } from 'react'
import { createElement } from 'react'
import type { ComponentMeta } from '@/types/schema'

const registry = new Map<string, ComponentMeta>()

export function register<P>(meta: ComponentMeta<P>) {
  registry.set(meta.id, meta as ComponentMeta)
}

export function getComponent(id: string): ComponentMeta | undefined {
  return registry.get(id)
}

export function getAllComponents(): ComponentMeta[] {
  return Array.from(registry.values())
}

export function getByCategory(category: ComponentMeta['category']): ComponentMeta[] {
  return getAllComponents().filter(c => c.category === category)
}

export function getByTag(tag: string): ComponentMeta[] {
  return getAllComponents().filter(c => c.tags?.includes(tag))
}

export function getSchema(id: string) {
  return registry.get(id)?.schema
}

export function getManifest() {
  return getAllComponents().map(({ id, name, category, description, schema, tags, embedTag }) => ({
    id,
    name,
    category,
    description,
    schema,
    tags,
    embedTag: embedTag ?? defaultEmbedTag(name),
  }))
}

function defaultEmbedTag(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, '')
}

export function getEmbedTag(meta: ComponentMeta): string {
  return meta.embedTag ?? defaultEmbedTag(meta.name)
}

const DISPLAY_CLASSES: Record<string, string> = {
  inline: 'not-prose w-full my-4 overflow-hidden',
  wide: 'not-prose relative left-1/2 right-1/2 -ml-[45vw] -mr-[45vw] w-[90vw] my-8',
  full: 'not-prose relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-[100vw] my-12',
}

function wrapWithDisplay(Component: ComponentType<Record<string, unknown>>, display: string): FC<Record<string, unknown>> {
  const cls = DISPLAY_CLASSES[display] ?? DISPLAY_CLASSES.inline
  const Wrapped: FC<Record<string, unknown>> = (props) =>
    createElement('div', { className: cls },
      createElement('div', { className: display === 'full' ? 'px-6' : '' },
        createElement(Component, props)
      )
    )
  Wrapped.displayName = `Display(${display})`
  return Wrapped
}

export function getMdxComponents(): Record<string, ComponentType<Record<string, unknown>>> {
  const map: Record<string, ComponentType<Record<string, unknown>>> = {}
  for (const meta of getAllComponents()) {
    const tag = getEmbedTag(meta)
    if (meta.category === 'layout') {
      map[tag] = meta.component as ComponentType<Record<string, unknown>>
    } else {
      map[tag] = wrapWithDisplay(meta.component as ComponentType<Record<string, unknown>>, meta.display ?? 'inline')
    }
  }
  return map
}

export function getEmbedSnippet(meta: ComponentMeta): string {
  const tag = getEmbedTag(meta)
  const requiredFields = meta.schema.fields.filter(f => f.required)
  if (requiredFields.length === 0) return `<${tag} />`
  const props = requiredFields.map(f => {
    const sample = (meta.sampleData as Record<string, unknown>)?.[f.name]
    if (sample === undefined) return `${f.name}={...}`
    if (typeof sample === 'string') return `${f.name}="${sample}"`
    return `${f.name}={${JSON.stringify(sample)}}`
  }).join(' ')
  return `<${tag} ${props} />`
}
