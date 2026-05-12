import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export function CopyEmbed({ tag, channel = 'cusp' }: { tag: string; channel?: string }) {
  const [copied, setCopied] = useState(false)
  const snippet = `<${tag} channel="${channel}" />`

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(snippet)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      title={snippet}
      className="inline-flex items-center justify-center w-5 h-5 rounded text-zinc-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  )
}
