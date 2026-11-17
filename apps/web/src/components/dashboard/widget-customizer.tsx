"use client"

import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, LayoutGrid } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { WIDGETS, type WidgetId, type WidgetLayout } from "./widgets"

function Row({ id, visible, onToggle }: { id: WidgetId; visible: boolean; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const w = WIDGETS.find((x) => x.id === id)!
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-2 rounded-lg px-1.5 py-1.5", isDragging && "relative z-10 bg-card shadow-md ring-1 ring-border")}
    >
      <button
        type="button"
        className="grid size-6 cursor-grab place-items-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
        aria-label={`Reorder ${w.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      <label htmlFor={`w-${id}`} className={cn("flex-1 text-sm", !visible && "text-muted-foreground")}>
        {w.title}
      </label>
      <Switch id={`w-${id}`} size="sm" checked={visible} onCheckedChange={onToggle} />
    </li>
  )
}

/** Show, hide and reorder dashboard widgets. Saved per browser. */
export function WidgetCustomizer({
  layout,
  onToggle,
  onReorder,
  onReset,
}: {
  layout: WidgetLayout
  onToggle: (id: WidgetId) => void
  onReorder: (order: WidgetId[]) => void
  onReset: () => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = layout.order.indexOf(e.active.id as WidgetId)
    const to = layout.order.indexOf(e.over.id as WidgetId)
    onReorder(arrayMove(layout.order, from, to))
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-8 gap-2">
          <LayoutGrid className="size-3.5" />
          <span className="hidden sm:inline">Customize</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="flex items-center justify-between px-1.5 pt-1 pb-2">
          <p className="text-sm font-medium">Widgets</p>
          <button type="button" onClick={onReset} className="text-xs text-muted-foreground hover:text-foreground">
            Reset
          </button>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={layout.order} strategy={verticalListSortingStrategy}>
            <ul className="space-y-0.5">
              {layout.order.map((id) => (
                <Row key={id} id={id} visible={!layout.hidden.includes(id)} onToggle={() => onToggle(id)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </PopoverContent>
    </Popover>
  )
}
