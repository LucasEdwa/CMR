import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { History } from 'lucide-react'
import type { RecordRef } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { useActiveWorkspace } from '@/hooks/useMe'

// The record's audit trail, for owners and admins.
export function HistoryLink({ record }: { record: RecordRef }) {
  const { t } = useTranslation()
  const { canManage } = useActiveWorkspace()
  if (!canManage) return null
  return (
    <Button asChild variant="outline" size="icon" aria-label={t('audit.history')} title={t('audit.history')}>
      <Link to={`/settings/audit?entityType=${record.type}&entityId=${record.id}`}>
        <History className="size-4" aria-hidden />
      </Link>
    </Button>
  )
}
