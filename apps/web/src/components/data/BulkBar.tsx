import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Tag, Trash2, X } from 'lucide-react'
import { LIFECYCLE_STAGES, type ImportObject } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/records/ConfirmDialog'
import { NativeSelect } from '@/components/NativeSelect'
import { useMembers } from '@/lib/crm'
import { dataApi, useDataMutation } from '@/lib/data'
import { errorMessage } from '@/lib/errors'

type Props = { object: ImportObject; ids: string[]; onDone: () => void }

// Actions for the selected rows of a list: reassign, change stage, add a tag, delete.
export function BulkBar({ object, ids, onDone }: Props) {
  const { t } = useTranslation()
  const members = useMembers()
  const [deleting, setDeleting] = useState(false)
  const [tag, setTag] = useState('')
  const bulk = useDataMutation((body: object) => dataApi.bulk(object, { ids, ...body }))
  const run = (body: object, message: string) =>
    bulk.mutate(body, {
      onSuccess: ({ count }) => {
        toast.success(t(message, { count }))
        setDeleting(false)
        setTag('')
        onDone()
      },
      onError: (err) => toast.error(errorMessage(t, err)),
    })

  return (
    <div role="region" aria-label={t('bulk.label')} className="bg-muted/60 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
      <span className="text-sm font-medium" aria-live="polite">
        {t('bulk.selected', { count: ids.length })}
      </span>
      <NativeSelect
        aria-label={t('bulk.reassign')}
        className="h-8 w-44"
        value=""
        disabled={bulk.isPending}
        onChange={(e) => e.target.value && run({ action: 'update', changes: { ownerUserId: e.target.value === 'none' ? null : e.target.value } }, 'bulk.reassigned')}
      >
        <option value="">{t('bulk.reassign')}</option>
        <option value="none">{t('list.noOwner')}</option>
        {members.data
          ?.filter((m) => m.role !== 'viewer')
          .map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
      </NativeSelect>
      {object === 'contacts' && (
        <NativeSelect
          aria-label={t('bulk.setStage')}
          className="h-8 w-44"
          value=""
          disabled={bulk.isPending}
          onChange={(e) => e.target.value && run({ action: 'update', changes: { lifecycleStage: e.target.value } }, 'bulk.updated')}
        >
          <option value="">{t('bulk.setStage')}</option>
          {LIFECYCLE_STAGES.map((s) => (
            <option key={s} value={s}>
              {t(`stages.${s}`)}
            </option>
          ))}
        </NativeSelect>
      )}
      {object !== 'deals' && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" disabled={bulk.isPending}>
              <Tag className="size-4" aria-hidden />
              {t('bulk.addTag')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (tag.trim()) run({ action: 'update', changes: { addTags: [tag.trim()] } }, 'bulk.updated')
              }}
            >
              <Input aria-label={t('bulk.tagName')} value={tag} maxLength={40} onChange={(e) => setTag(e.target.value)} autoFocus />
              <Button type="submit" size="sm">
                {t('common.save')}
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      )}
      <Button variant="outline" size="sm" onClick={() => setDeleting(true)} disabled={bulk.isPending}>
        <Trash2 className="size-4" aria-hidden />
        {t('common.delete')}
      </Button>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onDone}>
        <X className="size-4" aria-hidden />
        {t('bulk.clear')}
      </Button>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('common.delete')}
        description={t('bulk.confirmDelete', { count: ids.length })}
        confirmLabel={t('common.delete')}
        pending={bulk.isPending}
        onConfirm={() => run({ action: 'delete' }, 'bulk.deleted')}
      />
    </div>
  )
}
