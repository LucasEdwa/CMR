import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { contactSchema, pageSchema } from '@crm/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDebounced } from '@/hooks/useDebounced'
import { api } from '@/lib/api'
import { fullName } from '@/lib/crm'

type Ref = { id: string; name: string }
type Props = { id?: string; value: Ref[]; onChange: (contacts: Ref[]) => void }

export function ContactsPicker({ id = 'contacts', value, onChange }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 250)
  const results = useQuery({
    queryKey: ['contacts', 'picker', q],
    queryFn: () => api(`/contacts?pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}`, pageSchema(contactSchema)),
    enabled: open,
  })

  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((c) => (
            <li key={c.id}>
              <Badge variant="secondary" className="gap-1 pr-1">
                {c.name}
                <button
                  type="button"
                  className="hover:bg-muted rounded-sm p-0.5"
                  aria-label={t('tags.remove', { name: c.name })}
                  onClick={() => onChange(value.filter((v) => v.id !== c.id))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" size="sm" className="justify-self-start">
            <Plus className="size-4" aria-hidden />
            {t('deals.addContact')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder={t('deals.searchContacts')} value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>{results.isFetching ? t('common.loading') : t('deals.noContactsFound')}</CommandEmpty>
              <CommandGroup>
                {results.data?.items
                  .filter((c) => !value.some((v) => v.id === c.id))
                  .map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      onSelect={() => {
                        onChange([...value, { id: c.id, name: fullName(c) }])
                        setOpen(false)
                        setSearch('')
                      }}
                    >
                      <span className="flex-1 truncate">{fullName(c)}</span>
                      {c.company && <span className="text-muted-foreground truncate text-xs">{c.company.name}</span>}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
