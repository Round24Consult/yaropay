import Link from "next/link"
import { BrandMark } from "@/components/shared/brand-mark"
import { site } from "@/lib/site"

const LANES = [
  { name: "Shop", slot: 1, y: 22 },
  { name: "SaaS", slot: 2, y: 50 },
  { name: "App", slot: 3, y: 78 },
]

/** Split layout for sign-in, setup and invite pages: form on the left, the routing idea on the right. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-w-0 flex-col px-4 py-6 sm:px-10 sm:py-8">
        <header>
          <Link href="/" className="inline-flex items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <BrandMark />
            <span className="text-sm font-semibold tracking-tight">{site.name}</span>
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>
        <footer className="text-xs text-muted-foreground">Self-hosted and open source. Your keys never leave this install.</footer>
      </div>
      <aside className="relative hidden overflow-hidden border-l bg-muted/40 lg:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_60%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--grid)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)] bg-[size:32px_32px] opacity-60" />
        <div className="relative flex h-full flex-col justify-center gap-10 p-12 xl:p-16">
          <svg viewBox="0 0 100 100" className="mx-auto w-full max-w-md" fill="none">
            {LANES.map((l) => (
              <path
                key={l.name}
                d={`M 22 ${l.y} C 45 ${l.y}, 45 50, 62 50`}
                stroke={`var(--series-${l.slot})`}
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            ))}
            <path d="M 70 50 H 88" stroke="var(--primary)" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2 2.4" />
            {LANES.map((l) => (
              <g key={`n-${l.name}`}>
                <rect x="2" y={l.y - 6} width="20" height="12" rx="3" fill="var(--card)" stroke="var(--border)" strokeWidth="0.5" />
                <circle cx="6.5" cy={l.y} r="1.6" fill={`var(--series-${l.slot})`} />
                <text x="9.6" y={l.y + 1.3} fontSize="3.6" fill="var(--foreground)" fontFamily="var(--font-sans)">
                  {l.name}
                </text>
              </g>
            ))}
            <rect x="60" y="43" width="12" height="14" rx="3.5" fill="var(--primary)" />
            <path d="M 63 47.5 c 2.4 0 2.8 2.5 4.6 2.5 h 2 M 63 50 h 6.6 M 63 52.5 c 2.4 0 2.8 -2.5 4.6 -2.5" stroke="var(--primary-foreground)" strokeWidth="0.7" strokeLinecap="round" />
            <rect x="86" y="44" width="11" height="12" rx="3" fill="var(--card)" stroke="var(--border)" strokeWidth="0.5" />
            {/* A card: any payment gateway, not one brand. */}
            <rect x="88.4" y="47.6" width="6.2" height="4.6" rx="0.8" fill="none" stroke="var(--muted-foreground)" strokeWidth="0.5" />
            <path d="M 88.4 49.1 h 6.2" stroke="var(--muted-foreground)" strokeWidth="0.5" />
          </svg>
          <div className="mx-auto max-w-md space-y-3">
            <p className="text-2xl font-semibold tracking-tight text-balance">One gateway account. Every payment tied to the product that started it.</p>
            <p className="text-sm text-muted-foreground text-pretty">
              {site.name} routes your payment gateway&apos;s events to the right product, signs every delivery and keeps sales separate per product.
            </p>
          </div>
        </div>
      </aside>
    </div>
  )
}

export function AuthHeading({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="mb-7 space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground text-pretty">{description}</p> : null}
    </div>
  )
}

export function AuthFormSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded-md bg-muted" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-3.5 w-20 animate-pulse rounded bg-muted" />
          <div className="h-9 w-full animate-pulse rounded-lg bg-muted" />
        </div>
      ))}
      <div className="h-9 w-full animate-pulse rounded-lg bg-muted" />
    </div>
  )
}
