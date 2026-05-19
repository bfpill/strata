const ACCOUNT_ID = 'd00038c6596061598646a3726dd77a60'
const ACCESS_KEY = '09ba025cb497405edc001c265d71e110'
const SECRET_KEY = '51894fbcfaa729d49ca54d1e633de5ed29a3c1d81151e8c64608c0bb5b3f2a40'
const BUCKET = 'patterning'
const ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`
const REGION = 'auto'

async function hmac(key: ArrayBuffer, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))
}

async function sha256hex(msg: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg))
  return hex(h)
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function signingKey(date: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  let k = await hmac(enc.encode('AWS4' + SECRET_KEY).buffer as ArrayBuffer, date)
  k = await hmac(k, REGION)
  k = await hmac(k, 's3')
  k = await hmac(k, 'aws4_request')
  return k
}

export async function presignedUrl(key: string, expiresIn = 3600): Promise<string> {
  const now = new Date()
  const iso = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const date = iso.slice(0, 8)
  const scope = `${date}/${REGION}/s3/aws4_request`
  const path = `/${BUCKET}/${key}`
  const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`

  const params: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${ACCESS_KEY}/${scope}`],
    ['X-Amz-Date', iso],
    ['X-Amz-Expires', String(expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
  ]
  params.sort((a, b) => a[0].localeCompare(b[0]))
  const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')

  const canonical = `GET\n${path}\n${qs}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`
  const toSign = `AWS4-HMAC-SHA256\n${iso}\n${scope}\n${await sha256hex(canonical)}`
  const sig = hex(await hmac(await signingKey(date), toSign))

  return `${ENDPOINT}${path}?${qs}&X-Amz-Signature=${sig}`
}

export async function r2Fetch(key: string, init?: RequestInit): Promise<Response> {
  const url = await presignedUrl(key)
  return fetch(url, init)
}

export async function r2FetchRange(key: string, start: number, endExcl: number): Promise<ArrayBuffer> {
  const url = await presignedUrl(key)
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${endExcl - 1}` } })
  if (!r.ok && r.status !== 206) throw new Error(`R2 range fetch ${r.status}`)
  return r.arrayBuffer()
}
