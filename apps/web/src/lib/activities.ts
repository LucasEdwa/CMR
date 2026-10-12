import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import {
  activitySchema,
  myTasksSchema,
  notificationsSchema,
  taskSchema,
  timelineSchema,
  type ActivityType,
  type Notification,
  type RecordRef,
  type RecordType,
} from '@crm/shared'
import { api, send } from './api'

export const activityKeys = {
  timeline: (ref: RecordRef) => ['timeline', ref.type, ref.id] as const,
  timelines: ['timeline'] as const,
  tasks: ['tasks'] as const,
  myTasks: (assignee: string) => ['tasks', 'my', assignee] as const,
  recordTasks: (ref: RecordRef) => ['tasks', 'record', ref.type, ref.id] as const,
  notifications: ['notifications'] as const,
}

export const useTimeline = (ref: RecordRef, types: ActivityType[]) =>
  useInfiniteQuery({
    queryKey: [...activityKeys.timeline(ref), types.join(',')],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ type: ref.type, id: ref.id })
      if (types.length) params.set('types', types.join(','))
      if (pageParam) params.set('cursor', pageParam)
      return api(`/timeline?${params}`, timelineSchema)
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

export const useMyTasks = (assignee: string) =>
  useQuery({ queryKey: activityKeys.myTasks(assignee), queryFn: () => api(`/tasks/my?assignee=${assignee}`, myTasksSchema) })

export const useRecordTasks = (ref: RecordRef) =>
  useQuery({
    queryKey: activityKeys.recordTasks(ref),
    queryFn: () => api(`/tasks?type=${ref.type}&id=${ref.id}`, z.object({ open: z.array(taskSchema), done: z.array(taskSchema) })),
  })

// The bell polls; new assignments and mentions show up within half a minute.
export const useNotifications = () =>
  useQuery({
    queryKey: activityKeys.notifications,
    queryFn: () => api('/notifications', notificationsSchema),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

// Activities touch timelines and deals (stale marker); tasks touch task lists, deals (next task)
// and notifications of the person they are assigned to.
export function useActivityMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all(
        [activityKeys.timelines, activityKeys.tasks, activityKeys.notifications, ['deals']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  })
}

export const activityApi = {
  create: (body: object) => send('POST', '/activities', body).then((r) => activitySchema.parse(r)),
  update: (id: string, body: object) => send('PATCH', `/activities/${id}`, body).then((r) => activitySchema.parse(r)),
  remove: (id: string) => send('DELETE', `/activities/${id}`),
  createTask: (body: object) => send('POST', '/tasks', body).then((r) => taskSchema.parse(r)),
  updateTask: (id: string, body: object) => send('PATCH', `/tasks/${id}`, body).then((r) => taskSchema.parse(r)),
  removeTask: (id: string) => send('DELETE', `/tasks/${id}`),
  markRead: (id: string) => send('POST', `/notifications/${id}/read`),
  markAllRead: () => send('POST', '/notifications/read-all'),
}

const recordPaths: Record<RecordType, string> = { contact: '/contacts', company: '/companies', deal: '/deals' }
export const recordPath = (ref: { type: RecordType; id: string }) => `${recordPaths[ref.type]}/${ref.id}`

// Where a notification takes you: the record (to the activity for mentions), else My tasks.
export function notificationLink(n: Notification) {
  if (n.record) return `${recordPath(n.record)}${n.activityId ? `#activity-${n.activityId}` : ''}`
  return '/tasks'
}

// Today's date (yyyy-mm-dd) in a timezone, for date inputs.
export const localDate = (timeZone: string, offsetDays = 0) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone }).format(new Date(Date.now() + offsetDays * 86_400_000))

// yyyy-mm-ddThh:mm in local browser time, for datetime-local inputs.
export function toDateTimeLocal(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
