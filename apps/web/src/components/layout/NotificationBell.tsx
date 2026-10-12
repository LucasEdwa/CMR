import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AtSign, Bell, BellRing, ClipboardList } from 'lucide-react'
import type { Notification } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { activityApi, activityKeys, notificationLink, useNotifications } from '@/lib/activities'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const ICONS = { task_assigned: ClipboardList, task_reminder: BellRing, mention: AtSign }

export function NotificationBell() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const notifications = useNotifications()
  const unread = notifications.data?.unread ?? 0
  const refresh = () => queryClient.invalidateQueries({ queryKey: activityKeys.notifications })
  const markRead = useMutation({ mutationFn: activityApi.markRead, onSuccess: refresh })
  const markAll = useMutation({ mutationFn: activityApi.markAllRead, onSuccess: refresh })

  const openOne = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id)
    setOpen(false)
    navigate(notificationLink(n))
  }

  const describe = (n: Notification) => {
    const record = n.record?.name ?? ''
    if (n.type === 'mention') return t('notifications.mention', { actor: n.actor ?? t('notifications.someone'), record })
    if (n.type === 'task_assigned') return t('notifications.assigned', { actor: n.actor ?? t('notifications.someone') })
    return t('notifications.reminder')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t('notifications.label', { count: unread })}>
          <Bell className="size-5" aria-hidden />
          {unread > 0 && (
            <span className="bg-destructive absolute top-1 right-1 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4 font-semibold text-white" aria-hidden>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">{t('notifications.title')}</h2>
          {unread > 0 && (
            <Button variant="link" size="sm" className="h-auto px-0" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
              {t('notifications.markAll')}
            </Button>
          )}
        </div>
        {notifications.data?.items.length ? (
          <ul className="max-h-[60vh] overflow-y-auto" aria-label={t('notifications.title')}>
            {notifications.data.items.map((n) => {
              const Icon = ICONS[n.type]
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openOne(n)}
                    className={cn('hover:bg-muted flex w-full gap-3 px-4 py-3 text-left', !n.readAt && 'bg-primary/5')}
                  >
                    <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-sm">{describe(n)}</span>
                      <span className="text-muted-foreground truncate text-sm">{n.title}</span>
                      <span className="text-muted-foreground text-xs">{formatDateTime(n.createdAt, i18n.language)}</span>
                    </span>
                    {!n.readAt && (
                      <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full">
                        <span className="sr-only">{t('notifications.unread')}</span>
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground px-4 py-6 text-center text-sm">{t('notifications.empty')}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
