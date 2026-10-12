import { forwardRef, type SelectHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { NativeSelect } from '@/components/NativeSelect'
import { useMembers } from '@/lib/crm'

// Value "" means no owner. Viewers are listed too: they can own records others work on.
export const OwnerSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>((props, ref) => {
  const { t } = useTranslation()
  const members = useMembers()
  return (
    <NativeSelect ref={ref} {...props}>
      <option value="">{t('common.none')}</option>
      {members.data?.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
        </option>
      ))}
    </NativeSelect>
  )
})
OwnerSelect.displayName = 'OwnerSelect'
