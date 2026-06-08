import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import * as cov from '../lib/covModes'
import { RUNS, type RunDef } from '../lib/covModes'

// ── Helpers ──────────────────────────────────────────────

function fmtCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
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


// ── Mode sidebar card ────────────────────────────────────

function ModeCard({ k, sigma, varPct, selected, onClick, thumbUrl }: {
  k: number; sigma: number; varPct: number; selected: boolean; onClick: () => void; thumbUrl: string | null
}) {
  return (
    <button onClick={onClick} className={`w-full text-left px-2 py-1.5 rounded-md border transition-colors ${
      selected ? 'bg-blue-50 border-blue-300' : 'bg-white border-zinc-200 hover:border-zinc-300'
    }`}>
      <div className="flex items-center gap-1.5">
        <span className={`text-[11px] font-mono w-5 text-right ${selected ? 'text-blue-600 font-semibold' : 'text-zinc-400 font-medium'}`}>
          {k}
        </span>
        {thumbUrl
          ? <img src={thumbUrl} alt="" className="h-5 flex-1 object-contain opacity-60" loading="lazy" />
          : <div className="h-5 flex-1" />
        }
        <div className="text-right">
          <div className="text-[10px] font-mono text-zinc-500 leading-tight">{sigma.toFixed(0)}</div>
          <div className="text-[9px] text-zinc-400 leading-tight">{varPct.toFixed(1)}%</div>
        </div>
      </div>
    </button>
  )
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

  const W = 700, H = 190
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
      {/* Hit area — SVG backgrounds are transparent to events without this */}
      <rect x={0} y={0} width={W} height={H} fill="transparent" />

      {/* Grid */}
      {yTicks.map(([v]) => (
        <line key={v} x1={ml} y1={toY(v)} x2={ml + pw} y2={toY(v)} stroke="#f4f4f5" strokeWidth={0.5} />
      ))}

      {/* Committed range highlight */}
      {rangeLo != null && rangeHi != null && !dragVis && (
        <rect x={toX(Math.max(rangeLo, xMin))} y={mt}
          width={Math.max(0, toX(Math.min(rangeHi, xMax)) - toX(Math.max(rangeLo, xMin)))}
          height={ph} fill="#3b82f6" opacity={0.08} />
      )}

      {/* Drag preview */}
      {dragVis && (() => {
        const lo = Math.min(dragVis.start, dragVis.current), hi = Math.max(dragVis.start, dragVis.current)
        return <rect x={toX(lo)} y={mt} width={toX(hi) - toX(lo)} height={ph}
          fill="#3b82f6" opacity={0.12} stroke="#3b82f6" strokeWidth={0.5} strokeDasharray="4 2" />
      })()}

      {/* Bars */}
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

      {/* Zero line */}
      {xMin < 0 && xMax > 0 && (
        <line x1={toX(0)} y1={mt} x2={toX(0)} y2={mt + ph}
          stroke="#d4d4d8" strokeWidth={0.5} strokeDasharray="3 3" />
      )}

      {/* X axis */}
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

      {/* Y axis */}
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

// ── Token context display ────────────────────────────────

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

// ── Bigram co-occurrence grid ────────────────────────────

function fmtToken(t: string): string {
  return t.replace(/\n/g, '↵').replace(/\t/g, '→').replace(/ /g, '␣')
}


// ── Stats breakdown (from full range, not sample) ───────

function StatsBreakdown({ stats }: { stats: cov.RangeStats }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <MiniBarChart title="Top tokens" items={stats.tokenFreq} total={stats.total} mono />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <MiniBarChart title="Domains" items={stats.domainFreq} total={stats.total} />
        </div>
      </div>
      <BigramTableFromStats rows={stats.bigramRows} />
    </div>
  )
}

function BigramTableFromStats({ rows }: { rows: cov.RangeStats['bigramRows'] }) {
  if (rows.length === 0) return null

  return (
    <div>
      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
        Bigrams — x → y (y in selected range)
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
              padding: '0 4px', borderRadius: 9999, whiteSpace: 'pre',
              flexShrink: 0,
            }}>
              {fmtToken(y)}
            </span>
            <span style={{ fontSize: '0.55rem', color: '#a1a1aa', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {count}
            </span>
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

const BAR_COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#0ea5e9']

function MiniBarChart({ title, items, total, mono }: {
  title: string; items: [string, number][]; total: number; mono?: boolean
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
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

// ── Main page ────────────────────────────────────────────

export function ModeBrowser() {
  const [selectedRun, setSelectedRun] = useState<RunDef>(RUNS[0])
  const [meta, setMeta] = useState<cov.CovMeta | null>(null)
  const [histograms, setHistograms] = useState<cov.ModeHistogram[] | null>(null)
  const [selectedMode, setSelectedMode] = useState(1)
  const [rangeLo, setRangeLo] = useState('')
  const [rangeHi, setRangeHi] = useState('')
  const [samples, setSamples] = useState<cov.SampledToken[]>([])
  const [rangeStats, setRangeStats] = useState<cov.RangeStats | null>(null)
  const [sampling, setSampling] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [binaryReady, setBinaryReady] = useState(false)
  const [modeLoading, setModeLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initDone, setInitDone] = useState(false)
  const [thumbUrls, setThumbUrls] = useState<(string | null)[]>([])
  const filteredRef = useRef<{ values: Float32Array; indices: Uint32Array } | null>(null)
  const usedRef = useRef(new Set<number>())
  const sentinelRef = useRef<HTMLDivElement>(null)
  const BATCH = 30
  const prefix = selectedRun.prefix

  const switchRun = useCallback((run: RunDef) => {
    setSelectedRun(run)
    setMeta(null); setHistograms(null); setThumbUrls([])
    setSelectedMode(1); setSamples([]); setRangeStats(null)
    setRangeLo(''); setRangeHi('')
    setBinaryReady(false)
    setInitDone(false); setError(null)
    filteredRef.current = null; usedRef.current = new Set()
  }, [])

  useEffect(() => {
    Promise.all([cov.getMeta(prefix), cov.getHistograms(prefix)])
      .then(([m, h]) => {
        setMeta(m); setHistograms(h); setInitDone(true)
        Promise.all(Array.from({ length: m.modes.k_top }, (_, k) => cov.histogramThumbUrl(k, prefix)))
          .then(urls => setThumbUrls(urls))
      })
      .catch(e => { setError(e.message); setInitDone(true) })
  }, [prefix])

  useEffect(() => {
    cov.preloadBinaryData(prefix)
      .then(() => setBinaryReady(true))
      .catch(() => {})
  }, [prefix])

  useEffect(() => {
    setModeLoading(true)
    cov.loadFullMode(selectedMode, prefix)
      .then(() => setModeLoading(false))
      .catch(() => setModeLoading(false))
  }, [selectedMode, prefix])

  const currentHist = histograms?.[selectedMode] ?? null
  const sigma = meta?.modes.sigma_top[selectedMode] ?? 0
  const totalVar = useMemo(
    () => meta?.modes.sigma_all.reduce((a, s) => a + s * s, 0) ?? 1,
    [meta],
  )
  const varPct = (sigma * sigma / totalVar) * 100
  const domainLoadings = useMemo(
    () => meta ? meta.modes.domain_loadings.map(row => row[selectedMode]) : null,
    [meta, selectedMode],
  )

  const loadBatch = useCallback(async (append: boolean) => {
    const filtered = filteredRef.current
    if (!filtered || filtered.values.length === 0) return
    if (append) setLoadingMore(true); else setSampling(true)
    try {
      const batch: { value: number; positionIdx: number }[] = []
      const len = filtered.values.length
      let attempts = 0
      while (batch.length < BATCH && attempts < BATCH * 5 && usedRef.current.size < len) {
        const idx = Math.floor(Math.random() * len)
        if (usedRef.current.has(idx)) { attempts++; continue }
        usedRef.current.add(idx)
        batch.push({ value: filtered.values[idx], positionIdx: filtered.indices[idx] })
      }
      if (batch.length > 0) {
        const resolved = await cov.resolveSamples(batch, 15, prefix)
        resolved.sort((a, b) => b.value - a.value)
        setSamples(prev => append ? [...prev, ...resolved] : resolved)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSampling(false); setLoadingMore(false) }
  }, [prefix])

  const computeForRange = useCallback(async (lo: number, hi: number) => {
    setSampling(true); setError(null)
    usedRef.current = new Set()
    try {
      const modeData = await cov.loadFullMode(selectedMode, prefix)
      const filtered = cov.filterRange(modeData, lo, hi)
      filteredRef.current = filtered
      const stats = await cov.computeRangeStats(filtered.indices, prefix)
      setRangeStats(stats)
      await loadBatch(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setSampling(false)
    }
  }, [selectedMode, prefix, loadBatch])

  const handleRangeSelect = useCallback((lo: number, hi: number) => {
    setRangeLo(lo.toPrecision(6))
    setRangeHi(hi.toPrecision(6))
    computeForRange(lo, hi)
  }, [computeForRange])

  const handleSample = useCallback(async () => {
    const lo = parseFloat(rangeLo), hi = parseFloat(rangeHi)
    if (isNaN(lo) || isNaN(hi) || lo >= hi) return
    computeForRange(lo, hi)
  }, [rangeLo, rangeHi, computeForRange])

  // Infinite scroll via IntersectionObserver
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

  const switchMode = useCallback((k: number) => {
    setSelectedMode(k)
    setSamples([])
    setRangeStats(null)
    filteredRef.current = null
    usedRef.current = new Set()
  }, [])

  if (!initDone) {
    return <div className="strata"><div className="loading">Loading cov-mode data...</div></div>
  }

  return (
    <div className="strata detail-page">
      {/* Header */}
      <div className="detail-header">
        <Link to="/" className="back-link">← Feed</Link>
        <h2>Cov-Mode Browser</h2>
        <select
          value={selectedRun.id}
          onChange={e => { const r = RUNS.find(r => r.id === e.target.value); if (r) switchRun(r) }}
          style={{
            fontSize: '0.75rem', padding: '2px 6px', border: '1px solid #d1d5db',
            borderRadius: 4, background: 'white', color: '#374151', cursor: 'pointer',
          }}
        >
          {RUNS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        {meta && (
          <span className="header-meta">
            {meta.model?.name ?? meta.source?.tokenizer ?? 'unknown'}
            {meta.model?.step != null && ` · step ${meta.model.step.toLocaleString()}`}
            {' · '}{fmtCount(meta.probe.n_positions_total)} tokens · eff. rank {meta.modes.effective_rank}
          </span>
        )}
      </div>

      <div className="detail-body">
        {/* ── Sidebar: mode selector ── */}
        <div className="detail-sidebar" style={{ width: 195, minWidth: 195, maxWidth: 195 }}>
          <div className="sidebar-content" style={{ padding: '0.5rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem', paddingLeft: 4 }}>
              Modes
            </div>
            <div className="space-y-1">
              {meta && histograms && Array.from({ length: meta.modes.k_top }, (_, k) => {
                const s = meta.modes.sigma_top[k]
                return (
                  <ModeCard key={k} k={k} sigma={s}
                    varPct={(s * s / totalVar) * 100}
                    selected={k === selectedMode}
                    onClick={() => switchMode(k)}
                    thumbUrl={thumbUrls[k] ?? null} />
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Main content ── */}
        <div className="detail-main">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0.75rem 1rem', overflow: 'hidden' }}>
            {/* Mode title bar */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#27272a', margin: 0 }}>
                Mode {selectedMode}
              </h3>
              <span style={{ color: '#a1a1aa', fontSize: '0.75rem' }}>
                σ={sigma.toFixed(1)} · {varPct.toFixed(1)}% var
                {currentHist && ` · μ=${currentHist.mean.toPrecision(3)} · std=${currentHist.std.toPrecision(3)}`}
              </span>
              {(!binaryReady || modeLoading) && (
                <span style={{ fontSize: '0.7rem', color: '#d97706', marginLeft: 'auto' }}>
                  {modeLoading ? `Loading mode…` : 'Loading tokens…'}
                </span>
              )}
            </div>

            {/* Two-column layout: left = hist + loadings, right = stats + samples */}
            <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
              {/* ── Left column: histogram + controls + domain loadings ── */}
              <div style={{ width: '45%', flexShrink: 0, overflowY: 'auto', minHeight: 0 }}>
                {/* Histogram */}
                {currentHist && currentHist.counts.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
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

                {/* Controls */}
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center',
                  marginBottom: 8, padding: '4px 6px',
                  background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: '0.7rem',
                }}>
                  <input type="text" value={rangeLo} onChange={e => setRangeLo(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSample()}
                    placeholder="min"
                    style={{ width: 80, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3, fontSize: '0.7rem', fontFamily: 'monospace', textAlign: 'center' }}
                  />
                  <span style={{ color: '#a1a1aa' }}>→</span>
                  <input type="text" value={rangeHi} onChange={e => setRangeHi(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSample()}
                    placeholder="max"
                    style={{ width: 80, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3, fontSize: '0.7rem', fontFamily: 'monospace', textAlign: 'center' }}
                  />
                  {(rangeLo || rangeHi) && (
                    <button onClick={() => { setRangeLo(''); setRangeHi(''); setSamples([]); setRangeStats(null); filteredRef.current = null; usedRef.current = new Set() }}
                      className="btn-small" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>×</button>
                  )}
                  {rangeStats && (
                    <span style={{ color: '#6b7280', marginLeft: 'auto' }}>
                      {rangeStats.total.toLocaleString()} tokens
                    </span>
                  )}
                </div>

                {/* Domain loadings */}
                {domainLoadings && meta && (
                  <DomainLoadings loadings={domainLoadings} domains={meta.probe.domains} />
                )}

                {/* Stats breakdown (top tokens, domain dist, bigrams) */}
                {rangeStats && <StatsBreakdown stats={rangeStats} />}
              </div>

              {/* ── Right column: samples only (scrollable pane) ── */}
              <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', minHeight: 0 }}>
                {error && (
                  <div style={{ fontSize: '0.75rem', color: '#dc2626', marginBottom: 6, padding: '4px 8px', background: '#fef2f2', borderRadius: 4 }}>
                    {error}
                  </div>
                )}

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
                      <div style={{ fontSize: '0.7rem', color: '#a1a1aa', textAlign: 'center', padding: 4 }}>
                        Loading more…
                      </div>
                    )}
                  </div>
                )}

                {!sampling && !rangeStats && samples.length === 0 && initDone && (
                  <div style={{ fontSize: '0.75rem', color: '#a1a1aa', padding: '2rem 0', textAlign: 'center' }}>
                    Drag on the histogram to select a range.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
