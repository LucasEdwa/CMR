import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CALL_OUTCOMES, EMAIL_DIRECTIONS, type Activity, type ActivityType, type RecordRef, type RichDoc } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/NativeSelect'
import { activityApi, toDateTimeLocal, useActivityMutation } from '@/lib/activities'
import { useMembers } from '@/lib/crm'
import { errorMessage } from '@/lib/errors'
import { Skeleton } from '@/components/ui/skeleton'

// The editor (Tiptap/ProseMirror) is the biggest dependency in the app: load it with the first timeline.
const RichTextEditor = lazy(() => import('./RichTextEditor').then((m) => ({ default: m.RichTextEditor })))

type Props =
  | { mode: 'create'; record: RecordRef; type: ActivityType; onDone?: () => void }
  | { mode: 'edit'; activity: Activity; onDone?: () => void }

// One form for every activity type: a note is just text; calls, meetings and emails add a subject,
// a time and type-specific fields.
export function ActivityComposer(props: Props) {
  const { t } = useTranslation()
  const members = useMembers()
  const existing = props.mode === 'edit' ? props.activity : null
  const type = existing?.type ?? (props.mode === 'create' ? props.type : 'note')
  const [body, setBody] = useState<RichDoc | null>(existing?.body ?? null)
  const [empty, setEmpty] = useState(!existing?.body)
  const [subject, setSubject] = useState(existing?.subject ?? '')
  const [occurredAt, setOccurredAt] = useState(toDateTimeLocal(existing ? new Date(existing.occurredAt) : new Date()))
  const [duration, setDuration] = useState(existing?.durationMinutes?.toString() ?? '')
  const [outcome, setOutcome] = useState(existing?.outcome ?? (type === 'call' ? 'connected' : ''))
  const [direction, setDirection] = useState(existing?.direction ?? (type === 'email' ? 'outbound' : ''))
  const [missing, setMissing] = useState(false)
  // Remounting the editor clears it after a save.
  const [editorKey, setEditorKey] = useState(0)

  const save = useActivityMutation((payload: object) =>
    props.mode === 'edit' ? activityApi.update(props.activity.id, payload) : activityApi.create(payload),
  )

  const submit = () => {
    const hasText = !empty
    if (type === 'note' ? !hasText : !hasText && !subject.trim()) {
      setMissing(true)
      return
    }
    const fields = {
      body: hasText ? body : null,
      ...(type === 'note'
        ? {}
        : {
            subject: subject.trim() || null,
            occurredAt: new Date(occurredAt).toISOString(),
            durationMinutes: type === 'email' || duration === '' ? null : Number(duration),
            ...(type === 'call' ? { outcome: outcome || null } : {}),
            ...(type === 'email' ? { direction: direction || null } : {}),
          }),
    }
    save.mutate(props.mode === 'create' ? { type, record: props.record, ...fields } : fields, {
      onSuccess: () => {
        toast.success(t(props.mode === 'create' ? 'activities.logged' : 'common.saved'))
        if (props.mode === 'create') {
          setBody(null)
          setEmpty(true)
          setSubject('')
          setDuration('')
          setOccurredAt(toDateTimeLocal(new Date()))
          setEditorKey((k) => k + 1)
        }
        props.onDone?.()
      },
      onError: (err) => toast.error(errorMessage(t, err)),
    })
  }

  const prefix = existing ? `edit-${existing.id}` : `new-${type}`
  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {type !== 'note' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={`${prefix}-subject`}>{t('activities.subject')}</Label>
            <Input
              id={`${prefix}-subject`}
              value={subject}
              maxLength={200}
              placeholder={t(`activities.subjectPlaceholder.${type}`)}
              onChange={(e) => {
                setSubject(e.target.value)
                setMissing(false)
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${prefix}-when`}>{t('activities.when')}</Label>
            <Input id={`${prefix}-when`} type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </div>
          {type !== 'email' && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${prefix}-duration`}>{t('activities.duration')}</Label>
              <Input
                id={`${prefix}-duration`}
                type="number"
                inputMode="numeric"
                min={0}
                max={1440}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
          )}
          {type === 'call' && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${prefix}-outcome`}>{t('activities.outcome')}</Label>
              <NativeSelect id={`${prefix}-outcome`} value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
                {CALL_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {t(`activities.outcomes.${o}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {type === 'email' && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${prefix}-direction`}>{t('activities.direction')}</Label>
              <NativeSelect id={`${prefix}-direction`} value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
                {EMAIL_DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {t(`activities.directions.${d}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>
      )}
      <Suspense fallback={<Skeleton className="h-28" />}>
      <RichTextEditor
        key={editorKey}
        id={`${prefix}-body`}
        initial={existing?.body}
        placeholder={t(`activities.bodyPlaceholder.${type}`)}
        members={members.data ?? []}
        invalid={missing}
        onSubmit={submit}
        onChange={(doc, isEmpty) => {
          setBody(doc)
          setEmpty(isEmpty)
          setMissing(false)
        }}
      />
      </Suspense>
      {missing && (
        <p role="alert" className="text-destructive text-sm">
          {t(type === 'note' ? 'activities.noteRequired' : 'activities.contentRequired')}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {props.mode === 'edit' && (
          <Button type="button" variant="outline" onClick={props.onDone}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" disabled={save.isPending}>
          {props.mode === 'edit' ? t('common.save') : t(`activities.log.${type}`)}
        </Button>
      </div>
    </form>
  )
}
