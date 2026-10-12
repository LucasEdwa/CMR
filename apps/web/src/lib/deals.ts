import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import {
  boardSchema,
  dealDetailSchema,
  dealSchema,
  pageSchema,
  picklistsSchema,
  pipelinesResponseSchema,
  type PicklistKind,
  type Picklists,
} from '@crm/shared'
import { api, send } from './api'
import { keys as recordKeys } from './crm'

export const dealKeys = {
  all: ['deals'] as const,
  board: (pipelineId: string) => ['deals', 'board', pipelineId] as const,
  list: (params: string) => ['deals', 'list', params] as const,
  one: (id: string) => ['deals', 'one', id] as const,
  pipelines: ['pipelines'] as const,
  picklists: ['picklists'] as const,
}

export const usePipelines = () =>
  useQuery({ queryKey: dealKeys.pipelines, queryFn: () => api('/pipelines', pipelinesResponseSchema), staleTime: 60_000 })

export const useBoard = (pipelineId: string | undefined) =>
  useQuery({
    queryKey: dealKeys.board(pipelineId ?? ''),
    queryFn: () => api(`/deals/board?pipelineId=${pipelineId}`, boardSchema),
    enabled: !!pipelineId,
  })

export const useDealList = (params: URLSearchParams, enabled = true) =>
  useQuery({
    queryKey: dealKeys.list(params.toString()),
    queryFn: () => api(`/deals?${params}`, pageSchema(dealSchema)),
    placeholderData: keepPreviousData,
    enabled,
  })

export const useDeal = (id: string) =>
  useQuery({ queryKey: dealKeys.one(id), queryFn: () => api(`/deals/${id}`, dealDetailSchema), retry: false })

export const usePicklists = () =>
  useQuery({ queryKey: dealKeys.picklists, queryFn: () => api('/picklists', picklistsSchema), staleTime: 5 * 60_000 })

// Deals touch boards, lists, pipelines (open counts), contacts/companies pages and Trash.
export function useInvalidateDeals() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(
      [dealKeys.all, dealKeys.pipelines, recordKeys.trash].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    )
}

export function useDealMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const invalidate = useInvalidateDeals()
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate() })
}

export const dealApi = {
  create: (body: object) => send('POST', '/deals', body).then((r) => dealDetailSchema.parse(r)),
  update: (id: string, body: object) => send('PATCH', `/deals/${id}`, body).then((r) => dealDetailSchema.parse(r)),
  move: (id: string, stageId: string, index?: number) => send('POST', `/deals/${id}/move`, { stageId, index }),
  won: (id: string) => send('POST', `/deals/${id}/won`),
  lost: (id: string, reason: string, note?: string) => send('POST', `/deals/${id}/lost`, { reason, note }),
  reopen: (id: string) => send('POST', `/deals/${id}/reopen`),
  remove: (id: string) => send('DELETE', `/deals/${id}`),
}

// Built-in picklist items are translated; a workspace label (rename or custom item) wins.
// Values no longer in the list (removed items, old free text) are shown as stored.
export function picklistLabel(t: TFunction, lists: Picklists | undefined, kind: PicklistKind, key: string | null | undefined) {
  if (!key) return ''
  const item = lists?.[kind]?.find((i) => i.key === key)
  if (item?.label) return item.label
  return t(`picklists.${kind}.${key}`, { defaultValue: key })
}

export const statusVariant = (status: 'open' | 'won' | 'lost') =>
  status === 'won' ? 'default' : status === 'lost' ? 'destructive' : 'secondary'

export const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
