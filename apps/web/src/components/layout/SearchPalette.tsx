import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Building2, Clock, Handshake, Search, User } from 'lucide-react'
import type { SearchHit } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useDebounced } from '@/hooks/useDebounced'
import { recordPath } from '@/lib/activities'
import { useRecent, useSearch } from '@/lib/data'

const ICONS = { contact: User, company: Building2, deal: Handshake }
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

// Global search (Ctrl/Cmd+K): contacts, companies and deals, plus recently viewed records.
export function SearchPalette() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const go = (hit: SearchHit) => {
    setOpen(false)
    navigate(recordPath(hit))
  }

  return (
    <>
      <Button
        variant="outline"
        className="text-muted-foreground h-9 w-9 justify-center gap-2 overflow-hidden px-0 has-[>svg]:px-0 sm:w-56 sm:justify-start sm:px-3 sm:has-[>svg]:px-3"
        onClick={() => setOpen(true)}
        aria-label={t('search.open')}
        aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        {/* Short label here; the dialog has the full placeholder. Truncates rather than spilling over the bell. */}
        <span className="hidden min-w-0 flex-1 truncate text-left sm:inline">{t('search.button')}</span>
        <kbd className="bg-muted hidden shrink-0 rounded px-1.5 text-[10px] font-medium sm:inline">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[15%] translate-y-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
          <DialogTitle className="sr-only">{t('search.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('search.description')}</DialogDescription>
          <PaletteBody onSelect={go} />
        </DialogContent>
      </Dialog>
    </>
  )
}

// Mounted only while the dialog is open: every opening starts empty and loads a fresh "recently viewed" list.
function PaletteBody({ onSelect: go }: { onSelect: (hit: SearchHit) => void }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const q = useDebounced(query.trim(), 200)
  const results = useSearch(q)
  const recent = useRecent()
  const hits = q ? (results.data?.hits ?? []) : []
  const groups = (['contact', 'company', 'deal'] as const).map((type) => ({ type, items: hits.filter((h) => h.type === type) })).filter((g) => g.items.length)

  return (
    <>
          {/* The server ranks the results; cmdk's own filtering is off. */}
          <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs">
            <CommandInput value={query} onValueChange={setQuery} placeholder={t('search.placeholder')} aria-label={t('search.title')} />
            <CommandList className="max-h-[60vh]">
              {q && !results.isFetching && hits.length === 0 && <CommandEmpty>{t('search.none', { q })}</CommandEmpty>}
              {!q && (
                <CommandGroup heading={t('search.recent')}>
                  {recent.data?.hits.length ? (
                    recent.data.hits.map((hit) => <Hit key={`${hit.type}-${hit.id}`} hit={hit} recent onSelect={go} />)
                  ) : (
                    <p className="text-muted-foreground px-2 py-3 text-sm">{t('search.noRecent')}</p>
                  )}
                </CommandGroup>
              )}
              {groups.map((g) => (
                <CommandGroup key={g.type} heading={t(`search.groups.${g.type}`)}>
                  {g.items.map((hit) => (
                    <Hit key={hit.id} hit={hit} onSelect={go} />
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
    </>
  )
}

function Hit({ hit, recent, onSelect }: { hit: SearchHit; recent?: boolean; onSelect: (hit: SearchHit) => void }) {
  const { t } = useTranslation()
  const Icon = recent ? Clock : ICONS[hit.type]
  return (
    <CommandItem value={`${hit.type}-${hit.id}`} onSelect={() => onSelect(hit)} className="gap-3">
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="grid min-w-0">
        <span className="truncate">{hit.name}</span>
        {(hit.detail || recent) && <span className="text-muted-foreground truncate text-xs">{hit.detail ?? t(`search.types.${hit.type}`)}</span>}
      </span>
    </CommandItem>
  )
}
