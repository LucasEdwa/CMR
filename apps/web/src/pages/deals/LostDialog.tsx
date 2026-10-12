import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/Field'
import { NativeSelect } from '@/components/NativeSelect'
import { picklistLabel, usePicklists } from '@/lib/deals'

type Props = { open: boolean; onOpenChange: (open: boolean) => void; pending?: boolean; onConfirm: (reason: string, note: string) => void }

// A lost deal always needs a reason from the workspace's list.
export function LostDialog({ open, onOpenChange, pending, onConfirm }: Props) {
  const { t } = useTranslation()
  const picklists = usePicklists()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (reason) onConfirm(reason, note)
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('deals.lostTitle')}</DialogTitle>
          </DialogHeader>
          <Field id="lost-reason" label={t('deals.lostReason')}>
            <NativeSelect id="lost-reason" required value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="" disabled>
                {t('deals.chooseReason')}
              </option>
              {picklists.data?.lost_reason.map((item) => (
                <option key={item.key} value={item.key}>
                  {picklistLabel(t, picklists.data, 'lost_reason', item.key)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="lost-note" label={t('deals.lostNote')}>
            <Input id="lost-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!reason || pending}>
              {t('deals.markLost')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
