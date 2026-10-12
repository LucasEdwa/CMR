import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { formatMoney, type Board as BoardData, type Deal } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { dealApi, dealKeys, useInvalidateDeals } from '@/lib/deals'
import { errorMessage } from '@/lib/errors'
import { DealCard } from './DealCard'

type Columns = Record<string, string[]>

const toColumns = (board: BoardData): Columns => Object.fromEntries(board.columns.map((c) => [c.stage.id, c.deals.map((d) => d.id)]))

function SortableDeal({ deal, onOpen }: { deal: Deal; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id })
  return (
    <DealCard
      ref={setNodeRef}
      deal={deal}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? 'opacity-40' : 'cursor-grab hover:border-foreground/20'}
      {...attributes}
      {...listeners}
      role="button"
      aria-roledescription="draggable"
      onClick={onOpen}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e)
        if (e.key === 'Enter') onOpen()
      }}
    />
  )
}

function Column({
  stageId,
  title,
  probability,
  deals,
  canWrite,
  onAdd,
  onOpen,
}: {
  stageId: string
  title: string
  probability: number
  deals: Deal[]
  canWrite: boolean
  onAdd: () => void
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({ id: `column:${stageId}` })
  const totals = new Map<Deal['currency'], number>()
  for (const d of deals) totals.set(d.currency, (totals.get(d.currency) ?? 0) + d.value)
  const sum = [...totals].map(([currency, value]) => formatMoney(value, currency)).join(' + ') || formatMoney(0)

  return (
    <section aria-label={title} className="bg-muted/40 flex w-72 shrink-0 flex-col rounded-lg">
      <header className="grid gap-0.5 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <span className="text-muted-foreground text-xs tabular-nums">{probability} %</span>
        </div>
        <div className="text-muted-foreground flex justify-between gap-2 text-xs" data-testid={`totals-${title}`}>
          <span>{t('deals.deals', { count: deals.length })}</span>
          <span className="tabular-nums">{sum}</span>
        </div>
      </header>
      <SortableContext id={stageId} items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={`grid min-h-24 content-start gap-2 px-2 pb-2 ${isOver ? 'bg-muted/60 rounded-md' : ''}`}>
          {deals.map((deal) => (
            <SortableDeal key={deal.id} deal={deal} onOpen={() => onOpen(deal.id)} />
          ))}
          {deals.length === 0 && <p className="text-muted-foreground px-1 py-6 text-center text-xs">{t('deals.emptyColumn')}</p>}
        </div>
      </SortableContext>
      {canWrite && (
        <Button variant="ghost" size="sm" className="text-muted-foreground mx-2 mb-2 justify-start" onClick={onAdd}>
          <Plus className="size-4" aria-hidden />
          {t('deals.new')}
        </Button>
      )}
    </section>
  )
}

type Props = { board: BoardData; canWrite: boolean; onAdd: (stageId: string) => void }

export function Board({ board, canWrite, onAdd }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const invalidate = useInvalidateDeals()
  const dealsById = useMemo(() => new Map(board.columns.flatMap((c) => c.deals.map((d) => [d.id, d] as const))), [board])
  const [columns, setColumns] = useState<Columns>(() => toColumns(board))
  const [activeId, setActiveId] = useState<string | null>(null)
  const startColumn = useRef<string | null>(null)
  // A drag ends with a click on the card; this keeps it from opening the deal.
  const justDragged = useRef(false)

  // New server data replaces the local (optimistic) order.
  const [syncedBoard, setSyncedBoard] = useState(board)
  if (board !== syncedBoard) {
    setSyncedBoard(board)
    setColumns(toColumns(board))
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const columnOf = (id: string) =>
    id.startsWith('column:') ? id.slice(7) : Object.keys(columns).find((stageId) => columns[stageId]!.includes(id))

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id))
    startColumn.current = columnOf(String(active.id)) ?? null
  }

  // Moving across columns while dragging, so the card can be dropped at any position.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return
    const from = columnOf(String(active.id))
    const to = columnOf(String(over.id))
    if (!from || !to || from === to) return
    setColumns((prev) => {
      const target = prev[to]!
      const overIndex = target.indexOf(String(over.id))
      const index = overIndex === -1 ? target.length : overIndex
      return {
        ...prev,
        [from]: prev[from]!.filter((id) => id !== active.id),
        [to]: [...target.slice(0, index), String(active.id), ...target.slice(index)],
      }
    })
  }

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    justDragged.current = true
    setTimeout(() => (justDragged.current = false), 0)
    const id = String(active.id)
    const to = over ? columnOf(String(over.id)) : null
    if (!to) return setColumns(toColumns(board))

    const list = columns[to]!.filter((x) => x !== id)
    const overIndex = over && !String(over.id).startsWith('column:') ? list.indexOf(String(over.id)) : -1
    const currentIndex = columns[to]!.indexOf(id)
    const index = to === startColumn.current && overIndex !== -1 ? (currentIndex < overIndex ? overIndex + 1 : overIndex) : currentIndex === -1 ? list.length : currentIndex
    const nextColumn = [...list.slice(0, index), id, ...list.slice(index)]
    if (to === startColumn.current && nextColumn.join() === toColumns(board)[to]!.join()) return

    setColumns((prev) => ({ ...prev, [to]: nextColumn }))
    try {
      await dealApi.move(id, to, index)
      if (to !== startColumn.current) {
        const stage = board.columns.find((c) => c.stage.id === to)?.stage.name
        toast.success(t('deals.movedTo', { stage }))
      }
    } catch (err) {
      toast.error(errorMessage(t, err))
      await queryClient.invalidateQueries({ queryKey: dealKeys.board(board.pipelineId) })
    } finally {
      void invalidate()
    }
  }

  const active = activeId ? dealsById.get(activeId) : null
  return (
    <DndContext
      sensors={canWrite ? sensors : []}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null)
        setColumns(toColumns(board))
      }}
      accessibility={{ screenReaderInstructions: { draggable: t('deals.dragHint') } }}
    >
      {/* The board scrolls sideways inside its own box; the page itself never does. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        <div className="flex items-start gap-3">
          {board.columns.map((col) => (
            <Column
              key={col.stage.id}
              stageId={col.stage.id}
              title={col.stage.name}
              probability={col.stage.probability}
              deals={(columns[col.stage.id] ?? []).map((id) => dealsById.get(id)).filter((d): d is Deal => !!d)}
              canWrite={canWrite}
              onAdd={() => onAdd(col.stage.id)}
              onOpen={(id) => !justDragged.current && navigate(`/deals/${id}`)}
            />
          ))}
        </div>
      </div>
      <DragOverlay>{active ? <DealCard deal={active} dragging /> : null}</DragOverlay>
    </DndContext>
  )
}
