import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import {
  companySchema,
  contactSchema,
  memberSchema,
  pageSchema,
  savedViewSchema,
  tagSchema,
  trashItemSchema,
  type SavedViewObject,
} from '@crm/shared'
import { api, send } from './api'

export const keys = {
  contacts: ['contacts'] as const,
  contact: (id: string) => ['contacts', 'one', id] as const,
  companies: ['companies'] as const,
  company: (id: string) => ['companies', 'one', id] as const,
  members: ['members'] as const,
  tags: ['tags'] as const,
  views: (object: SavedViewObject) => ['saved-views', object] as const,
  trash: ['trash'] as const,
}

const qs = (params: URLSearchParams) => (params.toString() ? `?${params}` : '')

export const useContactList = (params: URLSearchParams) =>
  useQuery({
    queryKey: [...keys.contacts, 'list', params.toString()],
    queryFn: () => api(`/contacts${qs(params)}`, pageSchema(contactSchema)),
    placeholderData: keepPreviousData,
  })

export const useCompanyList = (params: URLSearchParams) =>
  useQuery({
    queryKey: [...keys.companies, 'list', params.toString()],
    queryFn: () => api(`/companies${qs(params)}`, pageSchema(companySchema)),
    placeholderData: keepPreviousData,
  })

export const useContact = (id: string) =>
  useQuery({ queryKey: keys.contact(id), queryFn: () => api(`/contacts/${id}`, contactSchema), retry: false })

export const useCompany = (id: string) =>
  useQuery({ queryKey: keys.company(id), queryFn: () => api(`/companies/${id}`, companySchema), retry: false })

export const useMembers = () =>
  useQuery({ queryKey: keys.members, queryFn: () => api('/workspace/members', z.array(memberSchema)), staleTime: 60_000 })

export const useTags = () =>
  useQuery({ queryKey: keys.tags, queryFn: () => api('/tags', z.array(tagSchema)), staleTime: 30_000 })

export const useSavedViews = (object: SavedViewObject) =>
  useQuery({ queryKey: keys.views(object), queryFn: () => api(`/saved-views?object=${object}`, z.array(savedViewSchema)) })

export const useTrash = () => useQuery({ queryKey: keys.trash, queryFn: () => api('/trash', z.array(trashItemSchema)) })

// Any change to records can affect lists, counts, tags and Trash.
export function useInvalidateRecords() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(
      [keys.contacts, keys.companies, keys.tags, keys.trash, ['deals'], ['pipelines']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    )
}

export function useRecordMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const invalidate = useInvalidateRecords()
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate() })
}

export const recordApi = {
  createContact: (body: object) => send('POST', '/contacts', body).then((r) => contactSchema.parse(r)),
  updateContact: (id: string, body: object) => send('PATCH', `/contacts/${id}`, body).then((r) => contactSchema.parse(r)),
  deleteContact: (id: string) => send('DELETE', `/contacts/${id}`),
  restore: (type: 'contact' | 'company' | 'deal', id: string) =>
    send('POST', `/${{ contact: 'contacts', company: 'companies', deal: 'deals' }[type]}/${id}/restore`),
  createCompany: (body: object) => send('POST', '/companies', body).then((r) => companySchema.parse(r)),
  updateCompany: (id: string, body: object) => send('PATCH', `/companies/${id}`, body).then((r) => companySchema.parse(r)),
  deleteCompany: (id: string) => send('DELETE', `/companies/${id}`),
  suggestCompany: (email: string) =>
    api(`/companies/suggest?email=${encodeURIComponent(email)}`, z.object({ company: z.object({ id: z.uuid(), name: z.string() }).nullable() })),
  searchCompanies: (q: string) =>
    api(`/companies?pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}`, pageSchema(companySchema)),
}

export const fullName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim()
