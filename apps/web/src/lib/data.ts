import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import {
  bulkResultSchema,
  companySchema,
  contactSchema,
  dealSchema,
  duplicateGroupSchema,
  importDetailSchema,
  importSchema,
  searchResultSchema,
  toCsv,
  type ImportObject,
  type RecordRef,
} from '@crm/shared'
import { api, send } from './api'

export const dataKeys = {
  imports: ['imports'] as const,
  import: (id: string) => ['imports', id] as const,
  search: (q: string) => ['search', q] as const,
  recent: ['recent'] as const,
  duplicates: ['duplicates'] as const,
}

export const useImports = () => useQuery({ queryKey: dataKeys.imports, queryFn: () => api('/imports', z.array(importSchema)) })

// Polls while the import is queued or running.
export const useImport = (id: string | null) =>
  useQuery({
    queryKey: dataKeys.import(id ?? ''),
    queryFn: () => api(`/imports/${id}`, importDetailSchema),
    enabled: !!id,
    refetchInterval: (query) => (['queued', 'running'].includes(query.state.data?.status ?? 'queued') ? 1000 : false),
  })

export const useSearch = (q: string) =>
  useQuery({
    queryKey: dataKeys.search(q),
    queryFn: () => api(`/search?q=${encodeURIComponent(q)}`, searchResultSchema),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  })

export const useRecent = () =>
  useQuery({ queryKey: dataKeys.recent, queryFn: () => api('/recent', searchResultSchema), refetchOnMount: 'always' })

export const useDuplicates = () =>
  useQuery({ queryKey: dataKeys.duplicates, queryFn: () => api('/contacts/duplicates', z.object({ groups: z.array(duplicateGroupSchema) })) })

// Imports, bulk changes and merges touch every list, detail page and count.
export function useDataMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => queryClient.invalidateQueries() })
}

export const dataApi = {
  startImport: (body: object) => send('POST', '/imports', body).then((r) => z.object({ id: z.uuid() }).parse(r)),
  undoImport: (id: string) => send('POST', `/imports/${id}/undo`).then((r) => importDetailSchema.parse(r)),
  bulk: (object: ImportObject, body: object) => send('POST', `/${object}/bulk`, body).then((r) => bulkResultSchema.parse(r)),
  merge: (body: object) => send('POST', '/contacts/merge', body).then((r) => contactSchema.parse(r)),
  // Fire and forget: a failed "recently viewed" write must never bother the user.
  viewed: (ref: RecordRef) => send('POST', '/recent', ref).catch(() => undefined),
}

const exportSchemas = { contacts: contactSchema, companies: companySchema, deals: dealSchema }

// Every record matching the list's current filters (up to 50 000), for CSV export.
export async function fetchExport<O extends ImportObject>(object: O, params: URLSearchParams) {
  const query = new URLSearchParams(params)
  query.delete('page')
  query.delete('pageSize')
  const schema = z.object({ items: z.array(exportSchemas[object]), total: z.number(), truncated: z.boolean() })
  return api(`/${object}/export?${query}`, schema) as Promise<{
    items: Array<z.infer<(typeof exportSchemas)[O]>>
    total: number
    truncated: boolean
  }>
}

// Saves a CSV in the format Excel expects in Sweden (UTF-8 BOM, semicolons).
export function downloadCsv(fileName: string, header: string[], rows: unknown[][]) {
  const blob = new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const today = () => new Date().toISOString().slice(0, 10)
