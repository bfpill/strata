import { r2Fetch, presignedUrl } from './r2sign'

// ── Runs ────────────────────────────────────────────────

export interface RunDef {
  id: string
  label: string
  prefix: string
}

export const RUNS: RunDef[] = [
  { id: 'pythia-1.4b-v1', label: 'pythia-1.4b-bf16', prefix: 'cov-modes/lang_3-pythia-1.4b/v1' },
  { id: 'dodecahedron-chi-v2', label: 'dodeca-32m-bf16', prefix: 'dodecahedron/chi-modes-v2' },
  { id: 'dodecahedron-67m-chi', label: 'dodeca-67m-fp32', prefix: 'dodecahedron-67m/chi-modes' },
]

const DEFAULT_PREFIX = RUNS[0].prefix

// ── Types ────────────────────────────────────────────────

export interface CovMeta {
  model?: { name: string; step?: number }
  source?: { chi_rect_meta?: string; tokenizer?: string }
  format?: {
    tokens_bin?: { row_bytes: number; layout: string }
    input_ids_bin?: { shape: number[] }
    mode_file?: { magic: number }
  }
  sampling: {
    n_beta?: number
    burn_in?: number
    n_chains: number
    n_draws_post_burnin?: number
    n_draws_total?: number
    n_draws_used?: number
    T_effective: number
  }
  probe: {
    domains: string[]
    n_seq_per_domain: number
    context_len: number
    loss_positions_per_seq: number
    n_positions_total: number
  }
  modes: {
    k_top: number
    k_exported?: number
    sigma_top: number[]
    sigma_all: number[]
    cumvar_all: number[]
    effective_rank: number
    domain_loadings: number[][]
  }
}

export interface ModeHistogram {
  bin_edges: number[]
  counts: number[]
  min: number
  max: number
  mean: number
  std: number
}

export interface ModeHeader {
  nRows: number
  nIdx: number
  quantiles: Float32Array
}

export interface TokenRecord {
  domain_id: number
  seq_idx: number
  pos_idx: number
  token_id: number
}

export interface SampledToken {
  value: number
  positionIdx: number
  token: TokenRecord
  tokenText: string
  domain: string
  contextTokens: string[]
  targetOffset: number
}

// ── Per-run caches ──────────────────────────────────────

interface RunCache {
  meta: CovMeta | null
  vocab: string[] | null
  histograms: ModeHistogram[] | null
  tokensBuf: ArrayBuffer | null
  inputIdsBuf: ArrayBuffer | null
  modeHeaders: Map<number, ModeHeader>
  binaryPromise: Promise<void> | null
  fullMode: { k: number; data: FullModeData } | null
  fullModePromise: Promise<FullModeData> | null
  fullModeK: number
  tokenRowBytes: number
  nSeqPerDomain: number
}

const _caches = new Map<string, RunCache>()

function cache(prefix: string): RunCache {
  let c = _caches.get(prefix)
  if (!c) {
    c = {
      meta: null, vocab: null, histograms: null,
      tokensBuf: null, inputIdsBuf: null,
      modeHeaders: new Map(),
      binaryPromise: null,
      fullMode: null, fullModePromise: null, fullModeK: -1,
      tokenRowBytes: 6, nSeqPerDomain: 160,
    }
    _caches.set(prefix, c)
  }
  return c
}

// ── Fetchers ─────────────────────────────────────────────

export async function getMeta(prefix = DEFAULT_PREFIX): Promise<CovMeta> {
  const c = cache(prefix)
  if (!c.meta) {
    const r = await r2Fetch(`${prefix}/meta.json`)
    if (!r.ok) throw new Error(`meta.json: ${r.status}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await r.json()

    // Normalize v1 vs v2 differences
    if (!raw.model && raw.source) {
      raw.model = { name: raw.source.tokenizer ?? 'unknown' }
    }
    if (raw.model && raw.model.step == null && raw.model.step_or_revision != null) {
      raw.model.step = raw.model.step_or_revision
    }
    if (raw.modes.k_exported != null && raw.modes.k_top == null) {
      raw.modes.k_top = raw.modes.k_exported
    }

    c.meta = raw as CovMeta
    c.tokenRowBytes = raw.format?.tokens_bin?.row_bytes ?? 6
    c.nSeqPerDomain = raw.probe?.n_seq_per_domain ?? 160
  }
  return c.meta!
}

export async function getVocab(prefix = DEFAULT_PREFIX): Promise<string[]> {
  const c = cache(prefix)
  if (!c.vocab) {
    const r = await r2Fetch(`${prefix}/vocab.json`)
    if (!r.ok) throw new Error(`vocab.json: ${r.status}`)
    const data = await r.json()
    c.vocab = data.tokens ?? data
  }
  return c.vocab!
}

export async function getHistograms(prefix = DEFAULT_PREFIX): Promise<ModeHistogram[]> {
  const c = cache(prefix)
  if (!c.histograms) {
    const r = await r2Fetch(`${prefix}/histograms.json`)
    if (!r.ok) { c.histograms = []; return c.histograms }
    const data = await r.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[] = Array.isArray(data) ? data : (data.modes ?? data)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c.histograms = raw.map((m: any) => {
      let bin_edges: number[] = m.bin_edges ?? m.edges ?? []
      const counts: number[] = m.counts ?? m.bin_counts ?? []
      if (bin_edges.length === 0 && m.v_max_symmetric != null && m.n_bins) {
        const vmax = m.v_max_symmetric
        const n = m.n_bins
        bin_edges = Array.from({ length: n + 1 }, (_, i) => -vmax + (2 * vmax * i) / n)
      }
      return { bin_edges, counts, min: m.min ?? 0, max: m.max ?? 0, mean: m.mean ?? 0, std: m.std ?? 0 }
    })
  }
  return c.histograms!
}

export function preloadBinaryData(prefix = DEFAULT_PREFIX): Promise<void> {
  const c = cache(prefix)
  if (!c.binaryPromise) {
    c.binaryPromise = Promise.all([
      r2Fetch(`${prefix}/tokens.bin`).then(r => {
        if (!r.ok) throw new Error(`tokens.bin: ${r.status}`)
        return r.arrayBuffer()
      }).then(buf => { c.tokensBuf = buf }),
      r2Fetch(`${prefix}/input_ids.bin`).then(r => {
        if (!r.ok) throw new Error(`input_ids.bin: ${r.status}`)
        return r.arrayBuffer()
      }).then(buf => { c.inputIdsBuf = buf }),
      getVocab(prefix),
      getMeta(prefix),
    ]).then(() => {})
  }
  return c.binaryPromise
}

export function binaryDataReady(prefix = DEFAULT_PREFIX): boolean {
  const c = cache(prefix)
  return c.tokensBuf !== null && c.inputIdsBuf !== null && c.vocab !== null
}

// ── Binary helpers ───────────────────────────────────────

export function decodeF16(bits: number): number {
  const s = (bits & 0x8000) >> 15
  const e = (bits & 0x7C00) >> 10
  const f = bits & 0x03FF
  if (e === 0) return (s ? -1 : 1) * 2 ** -14 * (f / 1024)
  if (e === 0x1F) return f ? NaN : (s ? -1 : 1) * Infinity
  return (s ? -1 : 1) * 2 ** (e - 15) * (1 + f / 1024)
}

function parseTokenRecord(buf: ArrayBuffer, posIdx: number, rowBytes: number): TokenRecord {
  const dv = new DataView(buf)
  const off = posIdx * rowBytes
  if (rowBytes === 8) {
    return {
      domain_id: dv.getUint16(off, true),
      seq_idx: dv.getUint16(off + 2, true),
      pos_idx: dv.getUint16(off + 4, true),
      token_id: dv.getUint16(off + 6, true),
    }
  }
  return {
    domain_id: dv.getUint8(off),
    seq_idx: dv.getUint8(off + 1),
    pos_idx: dv.getUint16(off + 2, true),
    token_id: dv.getUint16(off + 4, true),
  }
}

function getContextTokenIds(
  inputIdsBuf: ArrayBuffer,
  domainId: number,
  seqIdx: number,
  posIdx: number,
  windowSize: number,
  nSeqPerDomain: number,
): { tokenIds: number[]; targetOffset: number } {
  const ctxLen = 2048
  const targetPos = posIdx + 1
  const start = Math.max(0, targetPos - windowSize)
  const end = Math.min(ctxLen, targetPos + windowSize + 1)
  const targetOffset = targetPos - start
  const byteOffset = ((domainId * nSeqPerDomain + seqIdx) * ctxLen + start) * 2
  const length = end - start
  const arr = new Uint16Array(inputIdsBuf, byteOffset, length)
  return { tokenIds: Array.from(arr), targetOffset }
}

// ── Full mode loading ────────────────────────────────────

export interface FullModeData {
  values: Float32Array
  indices: Uint32Array
  nRows: number
}

export interface RangeStats {
  total: number
  tokenFreq: [string, number][]
  domainFreq: [string, number][]
  bigramRows: { y: string; count: number; preceding: [string, number][] }[]
}

function modeKey(prefix: string, k: number): string {
  return `${prefix}/modes/mode_${String(k).padStart(2, '0')}.bin`
}

export function fullModeReady(k: number, prefix = DEFAULT_PREFIX): boolean {
  const c = cache(prefix)
  return c.fullMode !== null && c.fullMode.k === k
}

export async function loadFullMode(k: number, prefix = DEFAULT_PREFIX): Promise<FullModeData> {
  const c = cache(prefix)
  if (c.fullMode && c.fullMode.k === k) return c.fullMode.data
  if (c.fullModePromise && c.fullModeK === k) return c.fullModePromise

  c.fullModeK = k
  c.fullModePromise = (async () => {
    const r = await r2Fetch(modeKey(prefix, k))
    if (!r.ok) throw new Error(`mode_${k}: ${r.status}`)
    const buf = await r.arrayBuffer()
    const dv = new DataView(buf)
    const magic = dv.getUint32(0, true)
    if (magic !== 0x434F5601 && magic !== 0x434F5602) throw new Error(`Bad magic in mode ${k}: 0x${magic.toString(16)}`)
    const nRows = dv.getUint32(4, true)
    const values = new Float32Array(nRows)
    const indices = new Uint32Array(nRows)
    for (let i = 0; i < nRows; i++) {
      const off = 4116 + i * 6
      values[i] = decodeF16(dv.getUint16(off, true))
      indices[i] = dv.getUint32(off + 2, true)
    }
    const data: FullModeData = { values, indices, nRows }
    c.fullMode = { k, data }
    c.fullModePromise = null
    return data
  })()
  return c.fullModePromise
}

export function filterRange(
  data: FullModeData, lo: number, hi: number,
): { values: Float32Array; indices: Uint32Array; start: number; end: number } {
  let left = 0, right = data.nRows
  while (left < right) { const m = (left + right) >>> 1; if (data.values[m] < lo) left = m + 1; else right = m }
  const start = left
  left = start; right = data.nRows
  while (left < right) { const m = (left + right) >>> 1; if (data.values[m] <= hi) left = m + 1; else right = m }
  const end = left
  return { values: data.values.subarray(start, end), indices: data.indices.subarray(start, end), start, end }
}

export async function computeRangeStats(
  indices: Uint32Array,
  prefix = DEFAULT_PREFIX,
  topTokens = 20, topBigrams = 20, topPreceding = 8,
): Promise<RangeStats> {
  await preloadBinaryData(prefix)
  const meta = await getMeta(prefix)
  const c = cache(prefix)
  const tokDv = new DataView(c.tokensBuf!)
  const idsDv = new DataView(c.inputIdsBuf!)
  const rowBytes = c.tokenRowBytes
  const nSeq = c.nSeqPerDomain

  const tokenFreq = new Map<number, number>()
  const domainFreq = new Map<number, number>()
  const bigramFreq = new Map<number, number>()

  for (let i = 0; i < indices.length; i++) {
    const off = indices[i] * rowBytes
    let domainId: number, seqIdx: number, posIdx: number, tokenId: number
    if (rowBytes === 8) {
      domainId = tokDv.getUint16(off, true)
      seqIdx = tokDv.getUint16(off + 2, true)
      posIdx = tokDv.getUint16(off + 4, true)
      tokenId = tokDv.getUint16(off + 6, true)
    } else {
      domainId = tokDv.getUint8(off)
      seqIdx = tokDv.getUint8(off + 1)
      posIdx = tokDv.getUint16(off + 2, true)
      tokenId = tokDv.getUint16(off + 4, true)
    }

    tokenFreq.set(tokenId, (tokenFreq.get(tokenId) ?? 0) + 1)
    domainFreq.set(domainId, (domainFreq.get(domainId) ?? 0) + 1)

    const targetPos = posIdx + 1
    if (targetPos > 0) {
      const prevOff = ((domainId * nSeq + seqIdx) * 2048 + targetPos - 1) * 2
      const prevId = idsDv.getUint16(prevOff, true)
      bigramFreq.set(prevId * 65536 + tokenId, (bigramFreq.get(prevId * 65536 + tokenId) ?? 0) + 1)
    }
  }

  const tf = [...tokenFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topTokens)
    .map(([id, cnt]): [string, number] => [c.vocab![id] ?? `<${id}>`, cnt])

  const df = [...domainFreq.entries()]
    .map(([id, cnt]): [string, number] => [meta.probe.domains[id] ?? `domain_${id}`, cnt])
    .sort((a, b) => a[0].localeCompare(b[0]))

  const targetTotals = new Map<number, number>()
  const targetPreceding = new Map<number, Map<number, number>>()
  for (const [key, count] of bigramFreq) {
    const tokId = key % 65536, prevId = (key - tokId) / 65536
    targetTotals.set(tokId, (targetTotals.get(tokId) ?? 0) + count)
    if (!targetPreceding.has(tokId)) targetPreceding.set(tokId, new Map())
    targetPreceding.get(tokId)!.set(prevId, (targetPreceding.get(tokId)!.get(prevId) ?? 0) + count)
  }
  const bigramRows = [...targetTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topBigrams)
    .map(([tokId, count]) => ({
      y: c.vocab![tokId] ?? `<${tokId}>`,
      count,
      preceding: [...(targetPreceding.get(tokId) ?? new Map()).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topPreceding)
        .map(([pid, cnt]): [string, number] => [c.vocab![pid] ?? `<${pid}>`, cnt]),
    }))

  return { total: indices.length, tokenFreq: tf, domainFreq: df, bigramRows }
}

export function sampleFromFiltered(
  filtered: { values: Float32Array; indices: Uint32Array }, n: number,
): { value: number; positionIdx: number }[] {
  const len = filtered.values.length
  const take = Math.min(n, len)
  const chosen = new Set<number>()
  const results: { value: number; positionIdx: number }[] = []
  while (results.length < take) {
    const idx = Math.floor(Math.random() * len)
    if (chosen.has(idx)) continue
    chosen.add(idx)
    results.push({ value: filtered.values[idx], positionIdx: filtered.indices[idx] })
  }
  results.sort((a, b) => b.value - a.value)
  return results
}

// ── Token resolution ─────────────────────────────────────

export async function resolveSamples(
  records: { value: number; positionIdx: number }[],
  windowSize = 15,
  prefix = DEFAULT_PREFIX,
): Promise<SampledToken[]> {
  await preloadBinaryData(prefix)
  const meta = await getMeta(prefix)
  const c = cache(prefix)
  return records.map(({ value, positionIdx }) => {
    const token = parseTokenRecord(c.tokensBuf!, positionIdx, c.tokenRowBytes)
    const { tokenIds, targetOffset } = getContextTokenIds(
      c.inputIdsBuf!, token.domain_id, token.seq_idx, token.pos_idx, windowSize, c.nSeqPerDomain,
    )
    return {
      value,
      positionIdx,
      token,
      tokenText: c.vocab![token.token_id] ?? `<${token.token_id}>`,
      domain: meta.probe.domains[token.domain_id] ?? `domain_${token.domain_id}`,
      contextTokens: tokenIds.map(id => c.vocab![id] ?? `<${id}>`),
      targetOffset,
    }
  })
}

export async function histogramThumbUrl(k: number, prefix = DEFAULT_PREFIX): Promise<string> {
  return presignedUrl(`${prefix}/histograms/mode_${String(k).padStart(2, '0')}.png`)
}
