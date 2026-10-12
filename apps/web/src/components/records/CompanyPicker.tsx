import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { recordApi } from '@/lib/crm'
import { useDebounced } from '@/hooks/useDebounced'

type Ref = { id: string; name: string } | null
type Props = { id?: string; value: Ref; onChange: (company: Ref) => void }

// Searches companies on the server as you type (lists can be long).
export function CompanyPicker({ id = 'company', value, onChange }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 250)
  const results = useQuery({
    queryKey: ['companies', 'picker', q],
    queryFn: () => recordApi.searchCompanies(q),
    enabled: open,
  })

  return (
    <div className="flex gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="min-w-0 flex-1 justify-between font-normal">
            <span className={value ? 'truncate' : 'text-muted-foreground'}>{value?.name ?? t('picker.choose')}</span>
            <ChevronsUpDown className="size-4 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder={t('picker.searchCompany')} value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>{results.isFetching ? t('common.loading') : t('picker.noCompanies')}</CommandEmpty>
              <CommandGroup>
                {results.data?.items.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => {
                      onChange({ id: c.id, name: c.name })
                      setOpen(false)
                    }}
                  >
                    <span className="flex-1 truncate">{c.name}</span>
                    {c.city && <span className="text-muted-foreground text-xs">{c.city}</span>}
                    {value?.id === c.id && <Check className="size-4" aria-hidden />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button type="button" variant="ghost" size="icon" aria-label={t('common.clear')} onClick={() => onChange(null)}>
          <X className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  )
}
