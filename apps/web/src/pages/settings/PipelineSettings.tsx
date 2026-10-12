import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { Pipeline } from '@crm/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Field } from '@/components/Field'
import { NativeSelect } from '@/components/NativeSelect'
import { ConfirmDialog } from '@/components/records/ConfirmDialog'
import { useActiveWorkspace } from '@/hooks/useMe'
import { send } from '@/lib/api'
import { dealKeys, usePipelines } from '@/lib/deals'
import { errorMessage } from '@/lib/errors'

type DraftStage = { id?: string; key: string; name: string; probability: number }

const toDraft = (p: Pipeline): DraftStage[] => p.stages.map((s) => ({ id: s.id, key: s.id, name: s.name, probability: s.probability }))

export function PipelineSettings() {
  const { t } = useTranslation()
  const { canManage } = useActiveWorkspace()
  const pipelines = usePipelines()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = pipelines.data?.pipelines.find((p) => p.id === selectedId) ?? pipelines.data?.pipelines[0]

  if (pipelines.isPending) return <Skeleton className="h-72 w-full" />
  if (pipelines.isError) return <p className="text-destructive">{errorMessage(t, pipelines.error)}</p>

  return (
    <div className="grid max-w-2xl gap-8">
      {!canManage && (
        <Alert>
          <AlertDescription>{t('settings.readOnly')}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field id="pipeline" label={t('deals.pipeline')}>
          <NativeSelect id="pipeline" className="w-60" value={selected?.id} onChange={(e) => setSelectedId(e.target.value)}>
            {pipelines.data.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({t('pipelines.openDeals', { count: p.openDeals })})
              </option>
            ))}
          </NativeSelect>
        </Field>
        {canManage && <NewPipeline onCreated={setSelectedId} />}
      </div>
      {/* Keyed so the editor starts fresh when another pipeline is selected or saved. */}
      {selected && <PipelineEditor key={`${selected.id}-${selected.stages.map((s) => s.id + s.name + s.probability).join()}`} pipeline={selected} canManage={canManage} onDeleted={() => setSelectedId(null)} />}
      <StaleDays initial={pipelines.data.staleDays} canManage={canManage} />
    </div>
  )
}

function NewPipeline({ onCreated }: { onCreated: (id: string) => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => send('POST', '/pipelines', { name }) as Promise<{ id: string }>,
    onSuccess: async ({ id }) => {
      setName('')
      await queryClient.invalidateQueries({ queryKey: dealKeys.pipelines })
      onCreated(id)
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) create.mutate()
      }}
    >
      <Input aria-label={t('pipelines.pipelineName')} placeholder={t('pipelines.newPipeline')} value={name} onChange={(e) => setName(e.target.value)} className="w-48" />
      <Button type="submit" variant="outline" disabled={!name.trim() || create.isPending}>
        <Plus className="size-4" aria-hidden />
        {t('pipelines.newPipeline')}
      </Button>
    </form>
  )
}

function PipelineEditor({ pipeline, canManage, onDeleted }: { pipeline: Pipeline; canManage: boolean; onDeleted: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState(pipeline.name)
  const [stages, setStages] = useState<DraftStage[]>(() => toDraft(pipeline))
  const [deleting, setDeleting] = useState(false)
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: dealKeys.pipelines }), queryClient.invalidateQueries({ queryKey: dealKeys.all })])

  const save = useMutation({
    mutationFn: async () => {
      if (name.trim() !== pipeline.name) await send('PATCH', `/pipelines/${pipeline.id}`, { name: name.trim() })
      await send('PUT', `/pipelines/${pipeline.id}/stages`, {
        stages: stages.map((s) => ({ id: s.id, name: s.name.trim(), probability: s.probability })),
      })
    },
    onSuccess: async () => {
      toast.success(t('pipelines.saved'))
      await refresh()
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })
  const remove = useMutation({
    mutationFn: () => send('DELETE', `/pipelines/${pipeline.id}`),
    onSuccess: async () => {
      setDeleting(false)
      onDeleted()
      await refresh()
    },
    onError: (err) => {
      setDeleting(false)
      toast.error(errorMessage(t, err))
    },
  })

  const update = (key: string, change: Partial<DraftStage>) => setStages((list) => list.map((s) => (s.key === key ? { ...s, ...change } : s)))
  const move = (index: number, by: -1 | 1) =>
    setStages((list) => {
      const next = [...list]
      const [item] = next.splice(index, 1)
      next.splice(index + by, 0, item!)
      return next
    })
  const valid = name.trim() && stages.length > 0 && stages.every((s) => s.name.trim() && s.probability >= 0 && s.probability <= 100)

  return (
    <section className="grid gap-4">
      <fieldset disabled={!canManage} className="grid gap-4">
        <Field id="pipeline-name" label={t('pipelines.pipelineName')}>
          <Input id="pipeline-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <h2 className="text-lg font-medium">{t('pipelines.stages')}</h2>
        <ol className="grid gap-2">
          {stages.map((stage, i) => (
            <li key={stage.key} className="grid grid-cols-[1fr_5.5rem_auto] items-center gap-2">
              <Input aria-label={t('pipelines.stageName')} value={stage.name} maxLength={60} onChange={(e) => update(stage.key, { name: e.target.value })} />
              <Input
                aria-label={t('pipelines.probability')}
                type="number"
                min={0}
                max={100}
                value={stage.probability}
                onChange={(e) => update(stage.key, { probability: Number(e.target.value) })}
              />
              <div className="flex">
                <Button type="button" variant="ghost" size="icon" aria-label={t('pipelines.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label={t('pipelines.moveDown')} disabled={i === stages.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('pipelines.removeStage')}
                  disabled={stages.length === 1}
                  onClick={() => setStages((list) => list.filter((s) => s.key !== stage.key))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ol>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStages((list) => [...list, { key: crypto.randomUUID(), name: '', probability: list.at(-1)?.probability ?? 0 }])}
            >
              <Plus className="size-4" aria-hidden />
              {t('pipelines.addStage')}
            </Button>
            <Button type="button" onClick={() => save.mutate()} disabled={!valid || save.isPending}>
              {t('pipelines.save')}
            </Button>
            <Button type="button" variant="ghost" className="ml-auto" onClick={() => setDeleting(true)}>
              <Trash2 className="size-4" aria-hidden />
              {t('pipelines.deletePipeline')}
            </Button>
          </div>
        )}
      </fieldset>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('pipelines.deletePipeline')}
        description={t('pipelines.confirmDelete', { name: pipeline.name })}
        confirmLabel={t('common.delete')}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </section>
  )
}

function StaleDays({ initial, canManage }: { initial: number; canManage: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [days, setDays] = useState(initial)
  const save = useMutation({
    mutationFn: () => send('PATCH', '/pipeline-settings', { staleDays: days }),
    onSuccess: async () => {
      toast.success(t('common.saved'))
      await Promise.all([queryClient.invalidateQueries({ queryKey: dealKeys.pipelines }), queryClient.invalidateQueries({ queryKey: dealKeys.all })])
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <Field id="stale-days" label={t('pipelines.staleDays')}>
        <div className="flex items-center gap-2">
          <Input id="stale-days" type="number" min={1} max={365} className="w-24" value={days} disabled={!canManage} onChange={(e) => setDays(Number(e.target.value))} />
          <span className="text-muted-foreground text-sm">{t('pipelines.days')}</span>
        </div>
      </Field>
      {canManage && (
        <Button type="submit" variant="outline" disabled={days === initial || days < 1 || save.isPending}>
          {t('common.save')}
        </Button>
      )}
    </form>
  )
}
