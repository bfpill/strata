import { createContext, useContext, useCallback, useSyncExternalStore, useRef } from 'react'
import type { ReactNode } from 'react'

type Store = Map<string, Record<string, unknown>>
type Listener = () => void

function createChannelStore() {
  const store: Store = new Map()
  const listeners = new Set<Listener>()

  return {
    get(channel: string) { return store.get(channel) },
    set(channel: string, value: Record<string, unknown>) {
      store.set(channel, value)
      listeners.forEach(l => l())
    },
    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

type ChannelStoreType = ReturnType<typeof createChannelStore>
const ChannelCtx = createContext<ChannelStoreType | null>(null as ChannelStoreType | null)

export function ChannelProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<ChannelStoreType>(null!)
  if (!storeRef.current) storeRef.current = createChannelStore()
  return <ChannelCtx.Provider value={storeRef.current}>{children}</ChannelCtx.Provider>
}

export function usePublish(channel: string | undefined) {
  const store = useContext(ChannelCtx)
  return useCallback((value: Record<string, unknown>) => {
    if (channel && store) store.set(channel, value)
  }, [channel, store])
}

export function useSubscribe<T = Record<string, unknown>>(channel: string | undefined): T | undefined {
  const store = useContext(ChannelCtx)
  return useSyncExternalStore(
    cb => store?.subscribe(cb) ?? (() => {}),
    () => (channel && store ? store.get(channel) as T | undefined : undefined),
  )
}
