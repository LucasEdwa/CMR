import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, ArrowLeftRight, CheckCircle2, Merge } from 'lucide-react'
import { MERGE_FIELDS, type Contact, type DuplicateGroup, type MergeField } from '@crm/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/records/EmptyState'
import { fullName, useContact } from '@/lib/crm'
import { dataApi, useDataMutation, useDuplicates } from '@/lib/data'
import { picklistLabel, usePicklists } from '@/lib/deals'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

export function DuplicatesPage() {
  const { t, i18n } = useTranslation()
  const duplicates = useDuplicates()
  const [pair, setPair] = useState<[string, string] | null>(null)

  return (
    <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6">
      <Link to="/contacts" className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="size-4" aria-hidden />
        {t('contacts.title')}
      </Link>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('duplicates.title')}</h1>
        <p className="text-muted-foreground">{t('duplicates.intro')}</p>
      </header>

      {duplicates.isPending ? (
        <Skeleton className="h-64" />
      ) : duplicates.isError ? (
        <p className="text-destructive">{errorMessage(t, duplicates.error)}</p>
      ) : duplicates.data.groups.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t('duplicates.noneTitle')} body={t('duplicates.noneBody')} />
      ) : (
        duplicates.data.groups.map((group: DuplicateGroup) => (
          <Card key={group.contacts.map((c) => c.id).join()}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>
                <h2 className="text-base">{group.contacts[0]!.name}</h2>
              </CardTitle>
              <Badge variant="secondary">{t(`duplicates.reasons.${group.reason}`)}</Badge>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {group.contacts.map((c, i) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link to={`/contacts/${c.id}`} className="grid min-w-0 hover:underline">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="text-muted-foreground truncate text-sm">
                        {[c.email, c.phone, c.company, t('duplicates.created', { date: formatDate(c.createdAt, i18n.language) })].filter(Boolean).join(' · ')}
                      </span>
                    </Link>
                    {i > 0 && (
                      <Button size="sm" variant="outline" onClick={() => setPair([group.contacts[0]!.id, c.id])}>
                        <Merge className="size-4" aria-hidden />
                        {t('duplicates.merge')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
      {pair && <MergeDialog ids={pair} onClose={() => setPair(null)} />}
    </div>
  )
}

const valueOf = (c: Contact, f: MergeField): string | null => {
  if (f === 'companyId') return c.company?.name ?? null
  if (f === 'ownerUserId') return c.owner?.name ?? null
  return (c[f] as string | null) ?? null
}

// Side by side: for each field where the two differ, pick the value to keep.
function MergeDialog({ ids, onClose }: { ids: [string, string]; onClose: () => void }) {
  const { t } = useTranslation()
  const picklists = usePicklists()
  const [[survivorId, mergedId], setOrder] = useState(ids)
  const a = useContact(survivorId)
  const b = useContact(mergedId)
  // Fields where the user chose the other contact's value. Defaults: fill the survivor's empty fields.
  const [picks, setPicks] = useState<Set<MergeField> | null>(null)
  const merge = useDataMutation(dataApi.merge)

  const survivor = a.data
  const other = b.data
  const differing = survivor && other ? MERGE_FIELDS.filter((f) => valueOf(survivor, f) !== valueOf(other, f)) : []
  const defaults = new Set(differing.filter((f) => survivor && other && !valueOf(survivor, f) && valueOf(other, f)))
  const chosen = picks ?? defaults
  const display = (c: Contact, f: MergeField) => {
    const v = valueOf(c, f)
    if (!v) return '–'
    if (f === 'lifecycleStage') return t(`stages.${v}`)
    if (f === 'leadSource') return picklistLabel(t, picklists.data, 'lead_source', v)
    return v
  }

  const swap = () => {
    setOrder([mergedId, survivorId])
    setPicks(null)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('duplicates.mergeTitle')}</DialogTitle>
          <DialogDescription>{t('duplicates.mergeBody')}</DialogDescription>
        </DialogHeader>
        {!survivor || !other ? (
          <Skeleton className="h-48" />
        ) : (
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>
                {t('duplicates.keeping')} <strong>{fullName(survivor)}</strong>
              </span>
              <Button variant="ghost" size="sm" onClick={swap}>
                <ArrowLeftRight className="size-4" aria-hidden />
                {t('duplicates.swap')}
              </Button>
            </div>
            {differing.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('duplicates.identical')}</p>
            ) : (
              <div className="max-h-[50vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('duplicates.field')}</TableHead>
                      <TableHead>{t('duplicates.keep')}</TableHead>
                      <TableHead>{t('duplicates.mergeIn')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {differing.map((f) => {
                      const takeOther = chosen.has(f)
                      const pick = (fromOther: boolean) =>
                        setPicks(() => {
                          const next = new Set(chosen)
                          if (fromOther) next.add(f)
                          else next.delete(f)
                          return next
                        })
                      return (
                        <TableRow key={f}>
                          <TableCell className="text-muted-foreground">{t(`duplicates.fields.${f}`)}</TableCell>
                          {[false, true].map((fromOther) => (
                            <TableCell key={String(fromOther)}>
                              <label className={cn('flex cursor-pointer items-center gap-2', takeOther === fromOther && 'font-medium')}>
                                <input type="radio" name={`merge-${f}`} checked={takeOther === fromOther} onChange={() => pick(fromOther)} />
                                <span className="break-all">{display(fromOther ? other : survivor, f)}</span>
                              </label>
                            </TableCell>
                          ))}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-muted-foreground text-sm">{t('duplicates.moves', { name: fullName(other) })}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!survivor || !other || merge.isPending}
            onClick={() =>
              merge.mutate(
                { survivorId, mergedId, takeFromMerged: [...chosen] },
                {
                  onSuccess: () => {
                    toast.success(t('duplicates.merged'))
                    onClose()
                  },
                  onError: (err) => toast.error(errorMessage(t, err)),
                },
              )
            }
          >
            <Merge className="size-4" aria-hidden />
            {t('duplicates.mergeButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
