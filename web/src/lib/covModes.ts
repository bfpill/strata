import { r2Fetch, r2FetchRange, presignedUrl } from './r2sign'

const KEY_PREFIX = 'cov-modes/lang_3-pythia-1.4b/v1'

// ── Types ────────────────────────────────────────────────

export interface CovMeta {
  model: { name: string; step: number }
  sampling: {
    n_beta?: number
    burn_in?: number
    n_chains: number
    n_draws_post_burnin: number
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

// ── Module-level caches ──────────────────────────────────

let _meta: CovMeta | null = null
let _vocab: string[] | null = null
let _histograms: ModeHistogram[] | null = null
let _tokensBuf: ArrayBuffer | null = null
let _inputIdsBuf: ArrayBuffer | null = null
const _modeHeaders = new Map<number, ModeHeader>()
let _binaryPromise: Promise<void> | null = null

// ── Fetchers ─────────────────────────────────────────────

export async function getMeta(): Promise<CovMeta> {
  if (!_meta) {
    const r = await r2Fetch(`${KEY_PREFIX}/meta.json`)
    if (!r.ok) throw new Error(`meta.json: ${r.status}`)
    _meta = await r.json()
  }
  return _meta!
}

export async function getVocab(): Promise<string[]> {
  if (!_vocab) {
    const r = await r2Fetch(`${KEY_PREFIX}/vocab.json`)
    if (!r.ok) throw new Error(`vocab.json: ${r.status}`)
    const data = await r.json()
    _vocab = data.tokens ?? data
  }
  return _vocab!
}

export async function getHistograms(): Promise<ModeHistogram[]> {
  if (!_histograms) {
    const r = await r2Fetch(`${KEY_PREFIX}/histograms.json`)
    if (!r.ok) throw new Error(`histograms.json: ${r.status}`)
    const data = await r.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[] = Array.isArray(data) ? data : (data.modes ?? data)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _histograms = raw.map((m: any) => {
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
  return _histograms!
}

export function preloadBinaryData(): Promise<void> {
  if (!_binaryPromise) {
    _binaryPromise = Promise.all([
      r2Fetch(`${KEY_PREFIX}/tokens.bin`).then(r => {
        if (!r.ok) throw new Error(`tokens.bin: ${r.status}`)
        return r.arrayBuffer()
      }).then(buf => { _tokensBuf = buf }),
      r2Fetch(`${KEY_PREFIX}/input_ids.bin`).then(r => {
        if (!r.ok) throw new Error(`input_ids.bin: ${r.status}`)
        return r.arrayBuffer()
      }).then(buf => { _inputIdsBuf = buf }),
      getVocab(),
    ]).then(() => {})
  }
  return _binaryPromise
}

export function binaryDataReady(): boolean {
  return _tokensBuf !== null && _inputIdsBuf !== null && _vocab !== null
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

function parseTokenRecord(buf: ArrayBuffer, posIdx: number): TokenRecord {
  const dv = new DataView(buf)
  const off = posIdx * 6
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
): { tokenIds: number[]; targetOffset: number } {
  const ctxLen = 2048
  const targetPos = posIdx + 1
  const start = Math.max(0, targetPos - windowSize)
  const end = Math.min(ctxLen, targetPos + windowSize + 1)
  const targetOffset = targetPos - start
  const byteOffset = ((domainId * 160 + seqIdx) * ctxLen + start) * 2
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

let _fullMode: { k: number; data: FullModeData } | null = null
let _fullModePromise: Promise<FullModeData> | null = null
let _fullModeK = -1

function modeKey(k: number): string {
  return `${KEY_PREFIX}/modes/mode_${String(k).padStart(2, '0')}.bin`
}

export function fullModeReady(k: number): boolean {
  return _fullMode !== null && _fullMode.k === k
}

export async function loadFullMode(k: number): Promise<FullModeData> {
  if (_fullMode && _fullMode.k === k) return _fullMode.data
  if (_fullModePromise && _fullModeK === k) return _fullModePromise

  _fullModeK = k
  _fullModePromise = (async () => {
    const r = await r2Fetch(modeKey(k))
    if (!r.ok) throw new Error(`mode_${k}: ${r.status}`)
    const buf = await r.arrayBuffer()
    const dv = new DataView(buf)
    if (dv.getUint32(0, true) !== 0x434F5601) throw new Error(`Bad magic in mode ${k}`)
    const nRows = dv.getUint32(4, true)
    const values = new Float32Array(nRows)
    const indices = new Uint32Array(nRows)
    for (let i = 0; i < nRows; i++) {
      const off = 4116 + i * 6
      values[i] = decodeF16(dv.getUint16(off, true))
      indices[i] = dv.getUint32(off + 2, true)
    }
    const data: FullModeData = { values, indices, nRows }
    _fullMode = { k, data }
    _fullModePromise = null
    return data
  })()
  return _fullModePromise
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
  topTokens = 20, topBigrams = 20, topPreceding = 8,
): Promise<RangeStats> {
  await preloadBinaryData()
  const meta = await getMeta()
  const tokDv = new DataView(_tokensBuf!)
  const idsDv = new DataView(_inputIdsBuf!)

  const tokenFreq = new Map<number, number>()
  const domainFreq = new Map<number, number>()
  const bigramFreq = new Map<number, number>()

  for (let i = 0; i < indices.length; i++) {
    const off = indices[i] * 6
    const domainId = tokDv.getUint8(off)
    const posIdx = tokDv.getUint16(off + 2, true)
    const tokenId = tokDv.getUint16(off + 4, true)
    const seqIdx = tokDv.getUint8(off + 1)

    tokenFreq.set(tokenId, (tokenFreq.get(tokenId) ?? 0) + 1)
    domainFreq.set(domainId, (domainFreq.get(domainId) ?? 0) + 1)

    const targetPos = posIdx + 1
    if (targetPos > 0) {
      const prevOff = ((domainId * 160 + seqIdx) * 2048 + targetPos - 1) * 2
      const prevId = idsDv.getUint16(prevOff, true)
      bigramFreq.set(prevId * 65536 + tokenId, (bigramFreq.get(prevId * 65536 + tokenId) ?? 0) + 1)
    }
  }

  const tf = [...tokenFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topTokens)
    .map(([id, c]): [string, number] => [_vocab![id] ?? `<${id}>`, c])

  const df = [...domainFreq.entries()]
    .map(([id, c]): [string, number] => [meta.probe.domains[id] ?? `domain_${id}`, c])
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
      y: _vocab![tokId] ?? `<${tokId}>`,
      count,
      preceding: [...(targetPreceding.get(tokId) ?? new Map()).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topPreceding)
        .map(([pid, c]): [string, number] => [_vocab![pid] ?? `<${pid}>`, c]),
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
): Promise<SampledToken[]> {
  await preloadBinaryData()
  const meta = await getMeta()
  return records.map(({ value, positionIdx }) => {
    const token = parseTokenRecord(_tokensBuf!, positionIdx)
    const { tokenIds, targetOffset } = getContextTokenIds(
      _inputIdsBuf!, token.domain_id, token.seq_idx, token.pos_idx, windowSize,
    )
    return {
      value,
      positionIdx,
      token,
      tokenText: _vocab![token.token_id] ?? `<${token.token_id}>`,
      domain: meta.probe.domains[token.domain_id] ?? `domain_${token.domain_id}`,
      contextTokens: tokenIds.map(id => _vocab![id] ?? `<${id}>`),
      targetOffset,
    }
  })
}

export async function histogramThumbUrl(k: number): Promise<string> {
  return presignedUrl(`${KEY_PREFIX}/histograms/mode_${String(k).padStart(2, '0')}.png`)
}
