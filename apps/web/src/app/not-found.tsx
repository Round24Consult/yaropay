import Link from "next/link"
import { BrandMark } from "@/components/shared/brand-mark"

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="space-y-4">
        <BrandMark className="mx-auto size-10" />
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">This route does not exist in this install.</p>
        <Link href="/" className="text-sm font-medium text-primary hover:underline">
          Back to the dashboard
        </Link>
      </div>
    </main>
  )
}
