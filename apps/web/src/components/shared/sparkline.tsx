import { cn } from "@/lib/utils"

/** Tiny trend line for stat tiles: 2px line, a faint wash, an end dot. */
export function Sparkline({
  values,
  color = "var(--primary)",
  className,
  height = 32,
}: {
  values: number[]
  color?: string
  className?: string
  height?: number
}) {
  const w = 120
  const h = height
  if (values.length < 2) return <div className={cn("h-8", className)} />
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const pad = 3
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (w - pad * 2) + pad,
    h - pad - ((v - min) / range) * (h - pad * 2),
  ])
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`
  const [ex, ey] = pts[pts.length - 1]
  return (
    <div className={cn("relative h-8 w-full", className)} style={{ height }} aria-hidden>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <path d={area} fill={color} opacity={0.1} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* End dot as HTML so it stays round when the line stretches. */}
      <span
        className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
        style={{ left: `${(ex / w) * 100}%`, top: `${(ey / h) * 100}%`, backgroundColor: color }}
      />
    </div>
  )
}
