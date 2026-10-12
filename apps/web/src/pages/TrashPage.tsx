import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Building2, Handshake, Trash2, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/records/EmptyState'
import { recordApi, useRecordMutation, useTrash } from '@/lib/crm'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'

export function TrashPage() {
  const { t, i18n } = useTranslation()
  const trash = useTrash()
  const restore = useRecordMutation(({ type, id }: { type: 'contact' | 'company' | 'deal'; id: string }) => recordApi.restore(type, id))

  return (
    <div className="mx-auto grid grid-cols-1 max-w-3xl gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('trash.title')}</h1>
      <p className="text-muted-foreground">{t('trash.intro')}</p>
      {trash.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : trash.isError ? (
        <p className="text-destructive">{errorMessage(t, trash.error)}</p>
      ) : trash.data.length === 0 ? (
        <EmptyState icon={Trash2} title={t('trash.empty')} />
      ) : (
        <ul className="divide-y rounded-md border">
          {trash.data.map((item) => {
            const Icon = { contact: User, company: Building2, deal: Handshake }[item.type]
            const date = formatDate(item.deletedAt, i18n.language)
            return (
              <li key={`${item.type}-${item.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <Icon className="text-muted-foreground size-4 shrink-0" aria-label={t(`trash.${item.type}`)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.name}</div>
                  <div className="text-muted-foreground text-sm">
                    {item.deletedBy ? t('trash.deletedBy', { date, name: item.deletedBy }) : t('trash.deletedAt', { date })}
                    {' · '}
                    {t('trash.purgeAt', { date: formatDate(item.purgeAt, i18n.language) })}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() =>
                    restore.mutate(item, {
                      onSuccess: () => toast.success(t('trash.restored', { name: item.name })),
                      onError: (err) => toast.error(errorMessage(t, err)),
                    })
                  }
                >
                  {t('common.restore')}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
