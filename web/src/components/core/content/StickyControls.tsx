import { useRef, useState, useEffect, useCallback } from 'react'
import { useSubscribe } from '@/lib/channel'
import { register } from '@/registry'

interface ChannelWithControls {
  controlsElement?: React.ReactNode
}

export function StickyControls({ channel }: { channel: string }) {
  const state = useSubscribe<ChannelWithControls>(channel)
  const startRef = useRef<HTMLDivElement>(null)
  const [endEl, setEndEl] = useState<HTMLElement | null>(null)
  const [regionHeight, setRegionHeight] = useState(0)

  const registerEnd = useCallback((el: HTMLElement | null) => setEndEl(el), [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__stickyControlsRegisterEnd = registerEnd
    }
    return () => {
      if (typeof window !== 'undefined') delete (window as unknown as Record<string, unknown>).__stickyControlsRegisterEnd
    }
  }, [registerEnd])

  useEffect(() => {
    const measure = () => {
      const startEl = startRef.current
      if (!startEl || !endEl) { setRegionHeight(0); return }
      setRegionHeight(endEl.offsetTop - startEl.offsetTop)
    }
    measure()
    window.addEventListener('resize', measure, { passive: true })
    const interval = setInterval(measure, 1000)
    return () => { window.removeEventListener('resize', measure); clearInterval(interval) }
  }, [endEl])

  if (!state?.controlsElement) return <div ref={startRef} className="h-px" />

  return (
    <div
      ref={startRef}
      className="relative h-0"
      style={{ height: 0 }}
    >
      <div
        className="absolute right-full mr-14"
        style={{ height: regionHeight || 'auto', top: 0 }}
      >
        <div
          className="sticky top-4 w-[300px] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl shadow-lg border border-zinc-200 bg-white"
        >
          {state.controlsElement}
        </div>
      </div>
    </div>
  )
}

export function HideControls() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const register = (window as unknown as Record<string, unknown>).__stickyControlsRegisterEnd as ((el: HTMLElement | null) => void) | undefined
    register?.(el)
  }, [])

  return <div ref={ref} className="h-px" />
}

register({
  id: 'sticky-controls',
  name: 'Sticky Controls',
  category: 'layout',
  description: 'Shows controls from a channel simulation in the left margin. Uses CSS sticky positioning between StickyControls and HideControls markers.',
  tags: ['controls', 'sticky', 'channel', 'layout'],
  schema: { fields: [{ name: 'channel', type: 'string', required: true, description: 'Channel to read controls from' }] },
  component: StickyControls as unknown as React.ComponentType<Record<string, unknown>>,
  sampleData: { channel: 'cusp' },
})

register({
  id: 'hide-controls',
  name: 'Hide Controls',
  category: 'layout',
  description: 'Bottom boundary for StickyControls.',
  tags: ['controls', 'sticky', 'layout'],
  schema: { fields: [] },
  component: HideControls,
  sampleData: {},
})
