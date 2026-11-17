import { FlaskConical } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/** Marks a product or gateway account that belongs to the sample data. */
export function SampleBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1 border-dashed font-normal text-muted-foreground", className)} title="Sample data: made up, removed together from the banner or Settings">
      <FlaskConical className="size-3" aria-hidden />
      Sample
    </Badge>
  )
}
