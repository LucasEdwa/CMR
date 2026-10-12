import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Bookmark, Columns3, ListFilter, Search, Trash2 } from 'lucide-react'
import type { SavedViewObject } from '@crm/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { NativeSelect } from '@/components/NativeSelect'
import { Field } from '@/components/Field'
import { useDebounced } from '@/hooks/useDebounced'
import { send } from '@/lib/api'
import { keys, useMembers, useSavedViews, useTags } from '@/lib/crm'
import { errorMessage } from '@/lib/errors'
import { paramsToQuery, queryToParams, type useListState } from '@/lib/listState'

type ListState = ReturnType<typeof useListState>

type Props = {
  object: SavedViewObject
  state: ListState
  allColumns: { id: string; label: string }[]
  defaultColumns: string[]
  // Object-specific filters (lifecycle stage, company size...), rendered inside the filter panel.
  extraFilters?: ReactNode
  extraFilterKeys?: string[]
}

const COMMON_FILTER_KEYS = ['owner', 'tag', 'createdFrom', 'createdTo']

export function ListToolbar({ object, state, allColumns, defaultColumns, extraFilters, extraFilterKeys = [] }: Props) {
  const { t } = useTranslation()
  const { params, update, columns, setParams } = state
  const [search, setSearch] = useState(params.get('q') ?? '')
  const debounced = useDebounced(search, 300)
  const members = useMembers()
  const tags = useTags()

  // Push the debounced search into the URL (and back to page 1).
  useEffect(() => {
    if ((params.get('q') ?? '') !== debounced) update({ q: debounced || null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const filterKeys = [...COMMON_FILTER_KEYS, ...extraFilterKeys]
  const activeFilters = filterKeys.filter((k) => params.getAll(k).length > 0).length

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" aria-hidden />
        <Input
          type="search"
          aria-label={t('common.search')}
          placeholder={t('list.searchPlaceholder')}
          className="pl-8"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="gap-2">
            <ListFilter className="size-4" aria-hidden />
            {t('list.filters')}
            {activeFilters > 0 && <Badge variant="secondary">{activeFilters}</Badge>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="grid w-72 gap-3">
          <Field id="filter-owner" label={t('list.owner')}>
            <NativeSelect id="filter-owner" value={params.get('owner') ?? ''} onChange={(e) => update({ owner: e.target.value || null })}>
              <option value="">{t('common.all')}</option>
              <option value="me">{t('list.me')}</option>
              <option value="none">{t('list.noOwner')}</option>
              {members.data?.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="filter-tag" label={t('list.tags')}>
            <NativeSelect id="filter-tag" value={params.get('tag') ?? ''} onChange={(e) => update({ tag: e.target.value || null })}>
              <option value="">{t('common.all')}</option>
              {tags.data?.map((tag) => (
                <option key={tag.id} value={tag.name}>
                  {tag.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {extraFilters}
          <div className="grid grid-cols-2 gap-2">
            <Field id="filter-from" label={t('list.createdFrom')}>
              <Input id="filter-from" type="date" value={params.get('createdFrom') ?? ''} onChange={(e) => update({ createdFrom: e.target.value || null })} />
            </Field>
            <Field id="filter-to" label={t('list.createdTo')}>
              <Input id="filter-to" type="date" value={params.get('createdTo') ?? ''} onChange={(e) => update({ createdTo: e.target.value || null })} />
            </Field>
          </div>
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" onClick={() => update(Object.fromEntries(filterKeys.map((k) => [k, null])))}>
              {t('list.clearFilters')}
            </Button>
          )}
        </PopoverContent>
      </Popover>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="hidden gap-2 md:inline-flex">
            <Columns3 className="size-4" aria-hidden />
            {t('list.columns')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {allColumns.map((col) => (
            <DropdownMenuCheckboxItem
              key={col.id}
              checked={columns.includes(col.id)}
              // The first column (name) always stays: it holds the row link.
              disabled={col.id === allColumns[0]!.id}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) => {
                const next = allColumns.map((c) => c.id).filter((id) => (id === col.id ? on : columns.includes(id)))
                update({ cols: next.join(',') === defaultColumns.join(',') ? null : next.join(',') }, { keepPage: true })
              }}
            >
              {col.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <SavedViewsMenu object={object} params={params} columns={columns} setParams={setParams} />
    </div>
  )
}

function SavedViewsMenu({
  object,
  params,
  columns,
  setParams,
}: {
  object: SavedViewObject
  params: URLSearchParams
  columns: string[]
  setParams: ListState['setParams']
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const views = useSavedViews(object)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const activeId = params.get('view')
  const active = views.data?.find((v) => v.id === activeId)
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.views(object) })
  const config = () => ({ query: paramsToQuery(params), columns })

  const create = useMutation({
    mutationFn: () => send('POST', '/saved-views', { object, name, shared, config: config() }) as Promise<{ id: string }>,
    onSuccess: async (view) => {
      toast.success(t('list.viewSaved'))
      setDialogOpen(false)
      await refresh()
      setParams(queryToParams(config().query, columns, view.id), { replace: true })
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })
  const save = useMutation({
    mutationFn: () => send('PATCH', `/saved-views/${activeId}`, { config: config() }),
    onSuccess: async () => {
      toast.success(t('list.viewSaved'))
      await refresh()
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })
  const remove = useMutation({
    mutationFn: () => send('DELETE', `/saved-views/${activeId}`),
    onSuccess: async () => {
      setParams(new URLSearchParams(), { replace: true })
      await refresh()
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })

  const mine = views.data?.filter((v) => v.mine) ?? []
  const others = views.data?.filter((v) => !v.mine) ?? []

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="max-w-56 gap-2">
            <Bookmark className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{active?.name ?? t('list.views')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onSelect={() => setParams(new URLSearchParams(), { replace: true })}>{t('list.allRecords')}</DropdownMenuItem>
          {mine.length > 0 && <DropdownMenuLabel>{t('list.myViews')}</DropdownMenuLabel>}
          {mine.map((v) => (
            <DropdownMenuItem key={v.id} onSelect={() => setParams(queryToParams(v.config.query, v.config.columns, v.id), { replace: true })}>
              <span className="flex-1 truncate">{v.name}</span>
              {v.shared && <Badge variant="outline">{t('list.sharedViews')}</Badge>}
            </DropdownMenuItem>
          ))}
          {others.length > 0 && <DropdownMenuLabel>{t('list.sharedViews')}</DropdownMenuLabel>}
          {others.map((v) => (
            <DropdownMenuItem key={v.id} onSelect={() => setParams(queryToParams(v.config.query, v.config.columns, v.id), { replace: true })}>
              <span className="flex-1 truncate">{v.name}</span>
              <span className="text-muted-foreground truncate text-xs">{t('list.sharedBy', { name: v.ownerName })}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setName('')
              setShared(false)
              setDialogOpen(true)
            }}
          >
            {t('list.saveView')}…
          </DropdownMenuItem>
          {active?.mine && (
            <>
              <DropdownMenuItem onSelect={() => save.mutate()}>{t('list.updateView')}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate()}>
                <Trash2 className="size-4" aria-hidden />
                {t('list.deleteView')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) create.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('list.saveView')}</DialogTitle>
            </DialogHeader>
            <Field id="view-name" label={t('list.viewName')}>
              <Input id="view-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </Field>
            <div className="flex items-center gap-2">
              <Checkbox id="view-shared" checked={shared} onCheckedChange={(v) => setShared(v === true)} />
              <Label htmlFor="view-shared">{t('list.shareView')}</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
