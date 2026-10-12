import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { PICKLIST_KINDS, type PicklistItem, type PicklistKind } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveWorkspace } from '@/hooks/useMe'
import { send } from '@/lib/api'
import { dealKeys, usePicklists } from '@/lib/deals'
import { errorMessage } from '@/lib/errors'

export function PicklistSettings() {
  const { t } = useTranslation()
  const picklists = usePicklists()
  if (picklists.isPending) return <Skeleton className="h-72 w-full" />
  if (picklists.isError) return <p className="text-destructive">{errorMessage(t, picklists.error)}</p>
  return (
    <div className="grid max-w-xl gap-8">
      <p className="text-muted-foreground">{t('picklistsPage.intro')}</p>
      {PICKLIST_KINDS.map((kind) => (
        <PicklistEditor key={`${kind}-${JSON.stringify(picklists.data[kind])}`} kind={kind} items={picklists.data[kind] ?? []} />
      ))}
    </div>
  )
}

type Draft = { rowKey: string; key?: string; label: string; placeholder: string }

function PicklistEditor({ kind, items }: { kind: PicklistKind; items: PicklistItem[] }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { canManage } = useActiveWorkspace()
  // Built-in items show their translation as placeholder; typing a label renames them for this workspace.
  const [rows, setRows] = useState<Draft[]>(() =>
    items.map((i) => ({ rowKey: i.key, key: i.key, label: i.label ?? '', placeholder: t(`picklists.${kind}.${i.key}`, { defaultValue: i.key }) })),
  )
  const save = useMutation({
    mutationFn: () => send('PUT', `/picklists/${kind}`, { items: rows.map((r) => ({ key: r.key, label: r.label.trim() || null })) }),
    onSuccess: async () => {
      toast.success(t('picklistsPage.saved'))
      await queryClient.invalidateQueries({ queryKey: dealKeys.picklists })
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })
  const move = (index: number, by: -1 | 1) =>
    setRows((list) => {
      const next = [...list]
      const [item] = next.splice(index, 1)
      next.splice(index + by, 0, item!)
      return next
    })
  const valid = rows.every((r) => r.key || r.label.trim())

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-medium">{t(`picklistsPage.${kind}`)}</h2>
      <fieldset disabled={!canManage} className="grid gap-2">
        <ol className="grid gap-2">
          {rows.map((row, i) => (
            <li key={row.rowKey} className="flex items-center gap-1">
              <Input
                aria-label={t(`picklistsPage.${kind}`)}
                value={row.label}
                placeholder={row.key ? row.placeholder : ''}
                maxLength={60}
                onChange={(e) => setRows((list) => list.map((r) => (r.rowKey === row.rowKey ? { ...r, label: e.target.value } : r)))}
              />
              <Button type="button" variant="ghost" size="icon" aria-label={t('pipelines.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={t('pipelines.moveDown')} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="size-4" aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={t('picklistsPage.remove')} onClick={() => setRows((list) => list.filter((r) => r.rowKey !== row.rowKey))}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
        {canManage && (
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setRows((list) => [...list, { rowKey: crypto.randomUUID(), label: '', placeholder: '' }])}>
              <Plus className="size-4" aria-hidden />
              {t('picklistsPage.add')}
            </Button>
            <Button type="button" size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
              {t('picklistsPage.save')}
            </Button>
          </div>
        )}
      </fieldset>
    </section>
  )
}
