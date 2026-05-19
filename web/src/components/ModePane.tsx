import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { register } from '@/registry'
import { usePublish, useSubscribe } from '@/lib/channel'
import * as cov from '@/lib/covModes'

// ── Helpers ──────────────────────────────────────────────

function fmtToken(t: string): string {
  return t.replace(/\n/g, '↵').replace(/\t/g, '→').replace(/ /g, '␣')
}

function niceTicksForRange(lo: number, hi: number, count: number): number[] {
  const range = hi - lo
  if (range <= 0) return [lo]
  const rawStep = range / count
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / mag
  const step = (norm <= 1.5 ? 1 : norm <= 3.5 ? 2 : norm <= 7.5 ? 5 : 10) * mag
  const ticks: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    ticks.push(Math.round(v / step) * step)
  }
  return ticks
}

function fmtCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

// ── Domain loadings ──────────────────────────────────────

function DomainLoadings({ loadings, domains }: { loadings: number[]; domains: string[] }) {
  const sorted = useMemo(() =>
    domains.map((d, i) => ({ domain: d, loading: loadings[i] }))
      .sort((a, b) => Math.abs(b.loading) - Math.abs(a.loading)),
    [loadings, domains],
  )
  const maxAbs = Math.max(0.01, ...sorted.map(d => Math.abs(d.loading)))

  return (
    <div className="space-y-0.5">
      {sorted.map(({ domain, loading }) => (
        <div key={domain} className="flex items-center gap-2 h-[18px]">
          <span className="w-28 text-right text-zinc-500 truncate text-[11px]">{domain}</span>
          <div className="flex-1 h-3 bg-zinc-50 rounded relative overflow-hidden">
            <div className="absolute left-1/2 top-0 w-px h-full bg-zinc-200" />
            <div
              className={`absolute top-0 h-full rounded-sm ${loading >= 0 ? 'bg-blue-400' : 'bg-rose-400'}`}
              style={{
                left: loading >= 0 ? '50%' : `${50 - (Math.abs(loading) / maxAbs) * 50}%`,
                width: `${(Math.abs(loading) / maxAbs) * 50}%`,
              }}
            />
          </div>
          <span className="w-12 text-right font-mono text-zinc-400 text-[10px]">
            {loading >= 0 ? '+' : ''}{loading.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── SVG histogram with drag-to-select ────────────────────

function HistogramChart({ hist, rangeLo, rangeHi, onRangeSelect }: {
  hist: cov.ModeHistogram
  rangeLo: number | null
  rangeHi: number | null
  onRangeSelect: (lo: number, hi: number) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ start: number; current: number } | null>(null)
  const [dragVis, setDragVis] = useState<{ start: number; current: number } | null>(null)

  const W = 700, H = 120
  const ml = 50, mr = 12, mt = 8, mb = 24
  const pw = W - ml - mr, ph = H - mt - mb

  const edges = hist.bin_edges
  const counts = hist.counts
  const xMin = edges[0], xMax = edges[edges.length - 1]
  const maxCount = Math.max(1, ...counts)

  const toX = useCallback((v: number) => ml + ((v - xMin) / (xMax - xMin)) * pw, [xMin, xMax, pw])
  const fromX = useCallback((px: number) => xMin + ((px - ml) / pw) * (xMax - xMin), [xMin, xMax, pw])
  const toY = useCallback((c: number) => mt + ph * (1 - c / maxCount), [ph, maxCount])

  const clientToVal = useCallback((clientX: number) => {
    if (!svgRef.current) return 0
    const rect = svgRef.current.getBoundingClientRect()
    const svgX = (clientX - rect.left) / rect.width * W
    return Math.max(xMin, Math.min(xMax, fromX(svgX)))
  }, [xMin, xMax, fromX])

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const v = clientToVal(e.clientX)
    dragRef.current = { start: v, current: v }
    setDragVis({ start: v, current: v })
  }, [clientToVal])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    const v = clientToVal(e.clientX)
    dragRef.current.current = v
    setDragVis({ start: dragRef.current.start, current: v })
  }, [clientToVal])

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    const d = dragRef.current
    if (!d) return
    const lo = Math.min(d.start, d.current)
    const hi = Math.max(d.start, d.current)
    dragRef.current = null
    setDragVis(null)
    if (hi - lo > (xMax - xMin) * 0.003) onRangeSelect(lo, hi)
  }, [onRangeSelect, xMin, xMax])

  const barW = pw / counts.length
  const xTicks = useMemo(() => niceTicksForRange(xMin, xMax, 7), [xMin, xMax])
  const yTicks = useMemo(() => {
    const ticks: [number, string][] = []
    const step = niceTicksForRange(0, maxCount, 4)
    for (const v of step) { if (v >= 0 && v <= maxCount * 1.05) ticks.push([v, fmtCount(v)]) }
    return ticks
  }, [maxCount])

  return (
    <svg
      ref={svgRef} viewBox={`0 0 ${W} ${H}`}
      className="w-full select-none" style={{ cursor: 'crosshair', aspectRatio: `${W}/${H}`, touchAction: 'none' }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
    >
      <rect x={0} y={0} width={W} height={H} fill="transparent" />
      {yTicks.map(([v]) => (
        <line key={v} x1={ml} y1={toY(v)} x2={ml + pw} y2={toY(v)} stroke="#f4f4f5" strokeWidth={0.5} />
      ))}
      {rangeLo != null && rangeHi != null && !dragVis && (
        <rect x={toX(Math.max(rangeLo, xMin))} y={mt}
          width={Math.max(0, toX(Math.min(rangeHi, xMax)) - toX(Math.max(rangeLo, xMin)))}
          height={ph} fill="#3b82f6" opacity={0.08} />
      )}
      {dragVis && (() => {
        const lo = Math.min(dragVis.start, dragVis.current), hi = Math.max(dragVis.start, dragVis.current)
        return <rect x={toX(lo)} y={mt} width={toX(hi) - toX(lo)} height={ph}
          fill="#3b82f6" opacity={0.12} stroke="#3b82f6" strokeWidth={0.5} strokeDasharray="4 2" />
      })()}
      {counts.map((count, i) => {
        if (count <= 0) return null
        const bx = ml + i * barW
        const by = toY(count)
        const bh = mt + ph - by
        if (bh <= 0) return null
        const center = (edges[i] + edges[i + 1]) / 2
        const inRange = rangeLo != null && rangeHi != null && center >= rangeLo && center <= rangeHi
        return <rect key={i} x={bx} y={by} width={Math.max(barW - 0.3, 0.5)} height={bh}
          fill={inRange ? '#3b82f6' : '#94a3b8'} opacity={inRange ? 0.85 : 0.5} />
      })}
      {xMin < 0 && xMax > 0 && (
        <line x1={toX(0)} y1={mt} x2={toX(0)} y2={mt + ph}
          stroke="#d4d4d8" strokeWidth={0.5} strokeDasharray="3 3" />
      )}
      <line x1={ml} y1={mt + ph} x2={ml + pw} y2={mt + ph} stroke="#d4d4d8" strokeWidth={0.5} />
      {xTicks.map(v => (
        <g key={v}>
          <line x1={toX(v)} y1={mt + ph} x2={toX(v)} y2={mt + ph + 4} stroke="#a1a1aa" strokeWidth={0.5} />
          <text x={toX(v)} y={mt + ph + 15} textAnchor="middle" fontSize={9} fill="#71717a"
            style={{ fontFamily: 'system-ui' }}>
            {v === 0 ? '0' : v.toPrecision(3)}
          </text>
        </g>
      ))}
      {yTicks.map(([v, label]) => (
        <g key={v}>
          <line x1={ml - 3} y1={toY(v)} x2={ml} y2={toY(v)} stroke="#a1a1aa" strokeWidth={0.5} />
          <text x={ml - 6} y={toY(v) + 3} textAnchor="end" fontSize={8} fill="#a1a1aa"
            style={{ fontFamily: 'system-ui' }}>{label}</text>
        </g>
      ))}
    </svg>
  )
}

// ── Context display ──────────────────────────────────────

function ContextDisplay({ tokens, targetOffset }: { tokens: string[]; targetOffset: number }) {
  return (
    <span className="font-mono text-[11px] whitespace-pre-wrap break-all leading-relaxed">
      {tokens.map((tok, i) => (
        <span key={i} className={
          i === targetOffset
            ? 'bg-amber-200 text-amber-900 font-semibold rounded-sm'
            : 'text-zinc-600'
        }>{tok}</span>
      ))}
    </span>
  )
}

// ── Mini bar chart ───────────────────────────────────────

const BAR_COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#0ea5e9']

function MiniBarChart({ title, items, total, mono }: {
  title: string; items: [string, number][]; total: number; mono?: boolean
}) {
  return (
    <div>
      <div style={{ fontSize: '0.6rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {items.map(([label, count], i) => {
          const pct = count / total * 100
          const displayLabel = label.replace(/\n/g, '↵').replace(/\t/g, '→').replace(/ /g, '␣')
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 3, height: 14 }}>
              <span style={{
                width: mono ? 50 : 80, textAlign: 'right', fontSize: '0.6rem',
                fontFamily: mono ? 'monospace' : 'inherit', color: '#52525b',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {mono ? displayLabel : label.replace('pile_', '')}
              </span>
              <div style={{ flex: 1, height: 8, background: '#f4f4f5', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: `${(count / total) * 100}%`,
                  background: BAR_COLORS[i % BAR_COLORS.length],
                  opacity: 0.7,
                }} />
              </div>
              <span style={{ fontSize: '0.55rem', color: '#a1a1aa', width: 26, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {pct >= 1 ? `${pct.toFixed(0)}%` : `${count}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Bigram table ─────────────────────────────────────────

function BigramTable({ rows }: { rows: cov.RangeStats['bigramRows'] }) {
  if (rows.length === 0) return null
  return (
    <div>
      <div style={{ fontSize: '0.6rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
        Bigrams — x → y
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {rows.map(({ y, count, preceding }) => (
          <div key={y} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 4px', borderRadius: 3,
            background: 'white', border: '1px solid #f4f4f5',
          }}>
            <span style={{
              fontFamily: 'monospace', fontSize: '0.6rem', color: '#1e40af',
              background: '#eff6ff', border: '1px solid #bfdbfe',
              padding: '0 4px', borderRadius: 9999, whiteSpace: 'pre', flexShrink: 0,
            }}>{fmtToken(y)}</span>
            <span style={{ fontSize: '0.55rem', color: '#a1a1aa', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', minWidth: 0 }}>
              {preceding.map(([x, xCount]) => (
                <span key={x} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 1,
                  fontFamily: 'monospace', fontSize: '0.55rem',
                  padding: '0 3px', borderRadius: 9999,
                  background: '#f5f5f4', border: '1px solid #e7e5e4',
                  whiteSpace: 'pre', lineHeight: 1.5,
                }}>
                  <span style={{ color: '#57534e' }}>{fmtToken(x)}</span>
                  <span style={{ color: '#d6d3d1' }}>{xCount}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── ModePane component ───────────────────────────────────

export interface ModePaneProps {
  mode: number
  rangeLo?: number
  rangeHi?: number
  height?: number
  channel?: string
}

export function ModePaneComponent({ mode, rangeLo: initLo, rangeHi: initHi, height = 700, channel }: ModePaneProps) {
  const ch = channel ?? `mode-${mode}`
  const [meta, setMeta] = useState<cov.CovMeta | null>(null)
  const [histograms, setHistograms] = useState<cov.ModeHistogram[] | null>(null)
  const [rangeLo, setRangeLo] = useState(initLo?.toPrecision(6) ?? '')
  const [rangeHi, setRangeHi] = useState(initHi?.toPrecision(6) ?? '')
  const [tab, setTab] = useState<'samples' | 'loadings' | 'stats'>('samples')
  const [samples, setSamples] = useState<cov.SampledToken[]>([])
  const [rangeStats, setRangeStats] = useState<cov.RangeStats | null>(null)
  const [sampling, setSampling] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [ctxSize, setCtxSize] = useState(15)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const filteredRef = useRef<{ values: Float32Array; indices: Uint32Array } | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const BATCH = 30

  useEffect(() => {
    Promise.all([cov.getMeta(), cov.getHistograms(), cov.preloadBinaryData(), cov.loadFullMode(mode)])
      .then(([m, h]) => { setMeta(m); setHistograms(h); setReady(true) })
      .catch(e => setError(e.message))
  }, [mode])

  // Auto-compute if initial range was provided
  useEffect(() => {
    if (ready && initLo != null && initHi != null) {
      computeForRange(initLo, initHi)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  const currentHist = histograms?.[mode] ?? null
  const sigma = meta?.modes.sigma_top[mode] ?? 0
  const totalVar = useMemo(() => meta?.modes.sigma_all.reduce((a, s) => a + s * s, 0) ?? 1, [meta])
  const varPct = (sigma * sigma / totalVar) * 100
  const domainLoadings = useMemo(
    () => meta ? meta.modes.domain_loadings.map(row => row[mode]) : null,
    [meta, mode],
  )

  const shuffledRef = useRef<number[]>([])
  const cursorRef = useRef(0)

  const loadBatch = useCallback(async (append: boolean) => {
    const filtered = filteredRef.current
    if (!filtered || filtered.values.length === 0) return
    const shuffled = shuffledRef.current
    if (cursorRef.current >= shuffled.length) return
    if (append) setLoadingMore(true); else setSampling(true)
    try {
      const start = cursorRef.current
      const end = Math.min(start + BATCH, shuffled.length)
      cursorRef.current = end
      const batch = shuffled.slice(start, end).map(i => ({
        value: filtered.values[i], positionIdx: filtered.indices[i],
      }))
      const resolved = await cov.resolveSamples(batch, ctxSize)
      resolved.sort((a, b) => b.value - a.value)
      setSamples(prev => append ? [...prev, ...resolved] : resolved)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSampling(false); setLoadingMore(false) }
  }, [ctxSize])

  const computeForRange = useCallback(async (lo: number, hi: number) => {
    setSampling(true); setError(null)
    try {
      const modeData = await cov.loadFullMode(mode)
      const filtered = cov.filterRange(modeData, lo, hi)
      filteredRef.current = filtered
      // Fisher-Yates shuffle of indices [0..len)
      const order = Array.from({ length: filtered.values.length }, (_, i) => i)
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[order[i], order[j]] = [order[j], order[i]]
      }
      shuffledRef.current = order
      cursorRef.current = 0
      const stats = await cov.computeRangeStats(filtered.indices)
      setRangeStats(stats)
      await loadBatch(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setSampling(false)
    }
  }, [mode, loadBatch])

  const handleRangeSelect = useCallback((lo: number, hi: number) => {
    setRangeLo(lo.toPrecision(6))
    setRangeHi(hi.toPrecision(6))
    computeForRange(lo, hi)
  }, [computeForRange])

  const handleManualRange = useCallback(() => {
    const lo = parseFloat(rangeLo), hi = parseFloat(rangeHi)
    if (isNaN(lo) || isNaN(hi) || lo >= hi) return
    computeForRange(lo, hi)
  }, [rangeLo, rangeHi, computeForRange])

  // Listen for range updates from ModeRange components
  const channelMsg = useSubscribe<{ rangeLo: number; rangeHi: number; tab?: string }>(ch)
  const lastMsgRef = useRef(channelMsg)
  useEffect(() => {
    if (channelMsg && channelMsg !== lastMsgRef.current && ready) {
      lastMsgRef.current = channelMsg
      const { rangeLo: lo, rangeHi: hi, tab: t } = channelMsg
      setRangeLo(lo.toPrecision(6))
      setRangeHi(hi.toPrecision(6))
      if (t === 'loadings' || t === 'stats' || t === 'samples') setTab(t)
      computeForRange(lo, hi)
    }
  }, [channelMsg, ready, computeForRange])

  // Re-resolve all loaded samples when context size changes
  useEffect(() => {
    if (samples.length === 0) return
    let cancelled = false
    const records = samples.map(s => ({ value: s.value, positionIdx: s.positionIdx }))
    cov.resolveSamples(records, ctxSize).then(resolved => {
      if (!cancelled) setSamples(resolved.sort((a, b) => b.value - a.value))
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxSize])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loadingMore && !sampling && filteredRef.current) {
        loadBatch(true)
      }
    }, { threshold: 0.1 })
    obs.observe(sentinel)
    return () => obs.disconnect()
  }, [loadBatch, loadingMore, sampling])

  if (!ready && !error) {
    return <div style={{ padding: 16, fontSize: '0.75rem', color: '#d97706' }}>Loading mode {mode}…</div>
  }

  return (
    <div style={{ height, display: 'flex', flexDirection: 'column', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fafafa', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Title bar */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 10px', borderBottom: '1px solid #e5e7eb', background: 'white', flexShrink: 0 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#27272a' }}>Mode {mode}</span>
        <span style={{ color: '#a1a1aa', fontSize: '0.7rem' }}>
          σ={sigma.toFixed(1)} · {varPct.toFixed(1)}% var
        </span>
        {error && <span style={{ fontSize: '0.7rem', color: '#dc2626', marginLeft: 'auto' }}>{error}</span>}
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: '6px 8px' }}>
        {/* Histogram — full width */}
        {currentHist && currentHist.counts.length > 0 && (
          <div style={{ flexShrink: 0, marginBottom: 4 }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, background: 'white', padding: '4px 6px 2px' }}>
              <HistogramChart
                hist={currentHist}
                rangeLo={rangeLo ? parseFloat(rangeLo) : null}
                rangeHi={rangeHi ? parseFloat(rangeHi) : null}
                onRangeSelect={handleRangeSelect}
              />
            </div>
          </div>
        )}

        {/* Controls bar */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', flexShrink: 0,
          marginBottom: 4, padding: '3px 6px',
          background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: '0.65rem',
        }}>
          <input type="text" value={rangeLo} onChange={e => setRangeLo(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleManualRange()}
            placeholder="min"
            style={{ width: 80, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3, fontSize: '0.65rem', fontFamily: 'monospace', textAlign: 'center' }}
          />
          <span style={{ color: '#a1a1aa' }}>→</span>
          <input type="text" value={rangeHi} onChange={e => setRangeHi(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleManualRange()}
            placeholder="max"
            style={{ width: 80, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3, fontSize: '0.65rem', fontFamily: 'monospace', textAlign: 'center' }}
          />
          {(rangeLo || rangeHi) && (
            <button onClick={() => { setRangeLo(''); setRangeHi(''); setSamples([]); setRangeStats(null); filteredRef.current = null; shuffledRef.current = []; cursorRef.current = 0 }}
              style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 3, padding: '1px 5px', fontSize: '0.6rem', cursor: 'pointer' }}>×</button>
          )}
          {rangeStats && (
            <span style={{ color: '#6b7280', marginLeft: 4 }}>
              {rangeStats.total.toLocaleString()} tokens
            </span>
          )}
          {/* Top tokens inline */}
          {rangeStats && rangeStats.tokenFreq.length > 0 && (
            <div style={{ display: 'flex', gap: 3, marginLeft: 'auto', flexWrap: 'wrap' }}>
              {rangeStats.tokenFreq.slice(0, 12).map(([token, count]) => (
                <span key={token} style={{
                  fontFamily: 'monospace', fontSize: '0.6rem', whiteSpace: 'pre',
                  padding: '0 4px', borderRadius: 9999,
                  background: '#eff6ff', border: '1px solid #bfdbfe', lineHeight: 1.5,
                }}>
                  <span style={{ color: '#1e40af' }}>{fmtToken(token)}</span>
                  <span style={{ color: '#93c5fd', marginLeft: 2 }}>{count}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', flexShrink: 0, marginBottom: 4 }}>
          {(['samples', 'loadings', 'stats'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '4px 12px', fontSize: '0.7rem', fontWeight: tab === t ? 600 : 400,
              color: tab === t ? '#2563eb' : '#6b7280',
              borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent',
              background: 'none', border: 'none', borderBottomStyle: 'solid', cursor: 'pointer',
            }}>
              {t === 'samples' ? 'Sequences' : t === 'loadings' ? 'Domain Loadings' : 'Token Stats'}
            </button>
          ))}
          {tab === 'samples' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', padding: '4px 8px', fontSize: '0.65rem', color: '#6b7280' }}>
              ctx
              <button onClick={() => setCtxSize(s => Math.max(5, s - 5))}
                style={{ width: 18, height: 18, border: '1px solid #d1d5db', borderRadius: 3, background: '#f9fafb', cursor: 'pointer', fontSize: '0.7rem', lineHeight: 1 }}>−</button>
              <span style={{ fontFamily: 'monospace', width: 20, textAlign: 'center' }}>{ctxSize}</span>
              <button onClick={() => setCtxSize(s => Math.min(200, s + 5))}
                style={{ width: 18, height: 18, border: '1px solid #d1d5db', borderRadius: 3, background: '#f9fafb', cursor: 'pointer', fontSize: '0.7rem', lineHeight: 1 }}>+</button>
            </div>
          )}
        </div>

        {/* Tab content — scrollable */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {/* Sequences tab */}
          {tab === 'samples' && (
            <>
              {samples.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {samples.map((s, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: 8, padding: '4px 6px',
                      background: 'white', borderRadius: 4,
                      border: '1px solid #f4f4f5', alignItems: 'flex-start',
                    }}>
                      <span style={{
                        fontFamily: 'monospace', fontSize: '0.65rem', width: 48,
                        textAlign: 'right', flexShrink: 0,
                        color: s.value >= 0 ? '#2563eb' : '#e11d48',
                      }}>
                        {s.value >= 0 ? '+' : ''}{s.value.toPrecision(3)}
                      </span>
                      <span style={{
                        fontSize: '0.6rem', color: '#a1a1aa', width: 60,
                        flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', paddingTop: 1,
                      }}>
                        {s.domain.replace('pile_', '')}
                      </span>
                      <ContextDisplay tokens={s.contextTokens} targetOffset={s.targetOffset} />
                    </div>
                  ))}
                  <div ref={sentinelRef} style={{ height: 1 }} />
                  {loadingMore && (
                    <div style={{ fontSize: '0.65rem', color: '#a1a1aa', textAlign: 'center', padding: 4 }}>Loading…</div>
                  )}
                </div>
              )}
              {!sampling && !rangeStats && samples.length === 0 && ready && (
                <div style={{ fontSize: '0.7rem', color: '#a1a1aa', padding: '2rem 0', textAlign: 'center' }}>
                  Drag on the histogram to select a range.
                </div>
              )}
            </>
          )}

          {/* Domain Loadings tab */}
          {tab === 'loadings' && domainLoadings && meta && (
            <div style={{ padding: '4px 0' }}>
              <DomainLoadings loadings={domainLoadings} domains={meta.probe.domains} />
              {rangeStats && (
                <div style={{ marginTop: 12 }}>
                  <MiniBarChart title="Domains in selection" items={rangeStats.domainFreq} total={rangeStats.total} />
                </div>
              )}
            </div>
          )}

          {/* Token Stats tab */}
          {tab === 'stats' && rangeStats && (
            <div style={{ padding: '4px 0' }}>
              <div style={{ marginBottom: 10 }}>
                <MiniBarChart title="Top tokens" items={rangeStats.tokenFreq} total={rangeStats.total} mono />
              </div>
              <BigramTable rows={rangeStats.bigramRows} />
            </div>
          )}
          {tab === 'stats' && !rangeStats && (
            <div style={{ fontSize: '0.7rem', color: '#a1a1aa', padding: '2rem 0', textAlign: 'center' }}>
              Select a range to see token statistics.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Register with Laminae ────────────────────────────────

register<ModePaneProps>({
  id: 'mode-pane',
  name: 'Mode Pane',
  category: 'data-display',
  description: 'Interactive browser for a single covariance mode from Pythia-1.4B SGLD posterior',
  tags: ['patterning', 'cov-modes', 'sgld'],
  schema: {
    fields: [
      { name: 'mode', type: 'number', required: true, description: 'Mode index (0–19)' },
      { name: 'rangeLo', type: 'number', description: 'Initial range lower bound' },
      { name: 'rangeHi', type: 'number', description: 'Initial range upper bound' },
      { name: 'height', type: 'number', description: 'Pane height in pixels (default 700)' },
      { name: 'channel', type: 'string', description: 'Channel name for receiving range commands (default: mode-{N})' },
    ],
  },
  component: ModePaneComponent,
  sampleData: { mode: 1 },
  display: 'inline',
})

// ── ModeRange — clickable inline range selector ──────────

interface ModeRangeProps {
  mode: number
  lo: number
  hi: number
  channel?: string
  tab?: string
  children?: React.ReactNode
}

function ModeRangeComponent({ mode, lo, hi, channel, tab, children }: ModeRangeProps) {
  const ch = channel ?? `mode-${mode}`
  const publish = usePublish(ch)

  const handleClick = useCallback(() => {
    publish({ rangeLo: lo, rangeHi: hi, tab: tab ?? 'samples' })
  }, [publish, lo, hi, tab])

  const label = children ?? `${lo.toPrecision(6)} to ${hi.toPrecision(6)}`

  return (
    <span onClick={handleClick} style={{
      color: '#2563eb', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted',
      textUnderlineOffset: 2,
    }}>({label})</span>
  )
}

register<ModeRangeProps>({
  id: 'mode-range',
  name: 'Mode Range',
  category: 'layout',
  description: 'Clickable inline link that sets a range on a ModePane component',
  tags: ['patterning', 'cov-modes'],
  schema: {
    fields: [
      { name: 'mode', type: 'number', required: true, description: 'Mode index to target' },
      { name: 'lo', type: 'number', required: true, description: 'Range lower bound' },
      { name: 'hi', type: 'number', required: true, description: 'Range upper bound' },
      { name: 'channel', type: 'string', description: 'Channel name (default: mode-{N})' },
      { name: 'tab', type: 'string', description: 'Tab to switch to (samples/loadings/stats)' },
    ],
  },
  component: ModeRangeComponent,
  sampleData: { mode: 5, lo: -0.002, hi: 0.001 },
})
