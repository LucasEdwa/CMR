import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

// List state (search, filters, sort, page, columns) lives in the URL, so it survives reloads,
// works with the back button and can be shared as a link.
export function useListState(defaultColumns: string[]) {
  const [params, setParams] = useSearchParams()

  const update = useCallback(
    (changes: Record<string, string | string[] | null>, { keepPage = false } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(changes)) {
            next.delete(key)
            for (const v of value === null ? [] : Array.isArray(value) ? value : [value]) if (v !== '') next.append(key, v)
          }
          if (!keepPage) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const columns = params.get('cols')?.split(',').filter(Boolean) ?? defaultColumns
  // The API gets everything except UI-only keys.
  const apiParams = new URLSearchParams(params)
  apiParams.delete('cols')
  apiParams.delete('view')

  return { params, apiParams, update, columns, setParams }
}

// Query part of a saved view: everything except page/view, with multi-values as arrays.
export function paramsToQuery(params: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  for (const key of new Set(params.keys())) {
    if (['page', 'view', 'cols'].includes(key)) continue
    const values = params.getAll(key)
    query[key] = values.length > 1 ? values : values[0]!
  }
  return query
}

export function queryToParams(query: Record<string, string | string[]>, columns: string[], viewId: string) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) for (const v of Array.isArray(value) ? value : [value]) params.append(key, v)
  params.set('cols', columns.join(','))
  params.set('view', viewId)
  return params
}
