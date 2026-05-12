import katex from 'katex'
import { tokens } from '@/theme/tokens'

export function fmt(x: number, digits = 3): string {
  return Number.isFinite(x) ? x.toFixed(digits) : 'n/a'
}

export function svgPath(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
}

export function CatastropheGlyph({ x, y, type, color, bg }: {
  x: number; y: number; type: 'birth' | 'death'; color: string; bg: string
}) {
  const left = type === 'birth'
  return (
    <g>
      <title>
        {type === 'birth'
          ? 'Fold birth: entering the bistable region; a stable minimum/saddle pair appears.'
          : 'Fold death: exiting the bistable region; a tracked stable minimum can annihilate with a saddle.'}
      </title>
      <circle cx={x} cy={y} r={7} fill={bg} stroke={color} strokeWidth={1.6} />
      {left
        ? <path d={`M ${x} ${y - 7} A 7 7 0 0 0 ${x} ${y + 7} Z`} fill={color} opacity={0.85} />
        : <path d={`M ${x} ${y - 7} A 7 7 0 0 1 ${x} ${y + 7} Z`} fill={color} opacity={0.85} />}
      <line x1={x} x2={x} y1={y - 7} y2={y + 7} stroke={color} strokeWidth={1} opacity={0.75} />
    </g>
  )
}

export function Info({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="inline-flex items-center justify-center w-4 h-4 rounded-full border text-[11px] cursor-help"
      style={{ borderColor: tokens.stroke.primary, color: tokens.text.secondary }}
    >
      i
    </span>
  )
}

export function MathBlock({ children }: { children: string }) {
  const html = katex.renderToString(children, { displayMode: true, throwOnError: false })
  return (
    <div
      className="rounded-md px-2.5 py-2 overflow-x-auto"
      style={{ background: tokens.fill.tertiary, border: `1px solid ${tokens.stroke.tertiary}` }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
