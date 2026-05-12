import { useState, useEffect, Component } from 'react'
import type { ReactNode, ComponentType } from 'react'
import * as runtime from 'react/jsx-runtime'
import { ChannelProvider } from '@/lib/channel'
import { evaluate } from '@mdx-js/mdx'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSlug from 'rehype-slug'
import { remarkCitations } from '@/plugins/remark-citations'
import { remarkEmbeds } from '@/plugins/remark-embeds'

type MDXComponent = ComponentType<{ components?: Record<string, ComponentType<Record<string, unknown>>> }>

const MATH_OR_CODE = /(```[\s\S]*?```|`[^`\n]+`|\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)/g

function fixMathAsterisks(src: string): string {
  return src.replace(MATH_OR_CODE, match =>
    /^\$/.test(match) ? match.replace(/ \* /g, ' \\cdot ') : match
  )
}

function escapeBareBraces(src: string): string {
  const parts = src.split(MATH_OR_CODE)
  return parts.map((part, i) => {
    if (i % 2 === 1) return part
    return part.replace(/(?<!=)\{([a-zA-Z_][a-zA-Z0-9_,\s]*)\}/g, '&#123;$1&#125;')
  }).join('')
}

function fixDetailsTags(src: string): string {
  return src
    .replace(/<details[^>]*>\s*/gi, m => m.trimEnd() + '\n\n')
    .replace(/\s*<\/details>/gi, '\n\n</details>')
    .replace(/<\/summary>\s*/gi, '</summary>\n\n')
}

function stripHeadingIds(src: string): string {
  return src.replace(/^(#{1,6}\s+.*?)\s*\{#[a-zA-Z0-9_-]+\}\s*$/gm, '$1')
}

function preprocess(src: string): string {
  return escapeBareBraces(fixMathAsterisks(fixDetailsTags(stripHeadingIds(src))))
}

async function compilemdx(mdxString: string): Promise<MDXComponent> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: Content } = await evaluate(preprocess(mdxString), {
    ...(runtime as any),
    remarkPlugins: [remarkGfm, remarkMath, remarkCitations, remarkEmbeds],
    rehypePlugins: [
      [rehypeRaw, { passThrough: ['mdxJsxFlowElement', 'mdxJsxTextElement', 'mdxFlowExpression', 'mdxTextExpression', 'mdxjsEsm'] }],
      rehypeSlug,
      rehypeKatex,
    ],
  })
  return Content as unknown as MDXComponent
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  render() {
    if (this.state.error) return (
      <div className="text-red-600 font-mono text-xs p-3 bg-red-50 border border-red-200 rounded-lg">
        Render error: {this.state.error}
      </div>
    )
    return this.props.children
  }
}

export interface MdxRendererProps {
  content: string
  components?: Record<string, ComponentType<Record<string, unknown>>>
  className?: string
}

export function MdxRenderer({ content, components = {}, className = '' }: MdxRendererProps) {
  const [MDXContent, setMDXContent] = useState<MDXComponent | null>(null)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<{ message: string; context: string } | null>(null)

  useEffect(() => {
    if (!content) return
    let cancelled = false
    setRendering(true)
    setError(null)
    compilemdx(content).then(component => {
      if (cancelled) return
      setMDXContent(() => component)
      setRendering(false)
    }).catch((e: Error & { line?: number; column?: number; position?: { start?: { line?: number; column?: number } } }) => {
      if (cancelled) return
      const fromPrefix = e.message?.match(/^(\d+):(\d+):/)
      const line = e.line ?? e.position?.start?.line ?? (fromPrefix ? parseInt(fromPrefix[1], 10) : null)
      const col = e.column ?? e.position?.start?.column ?? (fromPrefix ? parseInt(fromPrefix[2], 10) : null)
      const message = e.message?.replace(/^\d+:\d+:\s*/, '') ?? String(e)
      let context = ''
      if (line && content) {
        const lines = content.split('\n')
        const start = Math.max(0, line - 3)
        const end = Math.min(lines.length, line + 2)
        context = lines.slice(start, end).map((l, i) => {
          const lineNum = start + i + 1
          const marker = lineNum === line ? '> ' : '  '
          const text = marker + String(lineNum).padStart(4) + ' | ' + l
          return lineNum === line && col ? text + '\n' + '       | ' + ' '.repeat(col - 1) + '^' : text
        }).join('\n')
      }
      setError({ message: line ? `Line ${line}${col ? `:${col}` : ''} — ${message}` : message, context })
      setRendering(false)
    })
    return () => { cancelled = true }
  }, [content])

  return (
    <ChannelProvider>
    <article
      className={`prose prose-zinc max-w-none transition-opacity duration-150 ${rendering ? 'opacity-60' : ''} ${className}`}
    >
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 not-prose">
          <p className="text-red-600 font-mono text-xs font-semibold mb-2">MDX parse error</p>
          <p className="text-red-900 font-mono text-xs mb-2">{error.message}</p>
          {error.context && (
            <pre className="bg-white border border-red-200 rounded p-3 text-[11px] overflow-x-auto text-zinc-800 leading-relaxed">
              {error.context}
            </pre>
          )}
        </div>
      )}
      {MDXContent && (
        <ErrorBoundary>
          <MDXContent components={components} />
        </ErrorBoundary>
      )}
    </article>
    </ChannelProvider>
  )
}
