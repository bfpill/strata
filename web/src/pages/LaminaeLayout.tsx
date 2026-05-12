import type { ReactNode } from 'react'

export function LaminaeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-blue-50/50 text-zinc-900 antialiased" style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {children}
    </div>
  )
}
