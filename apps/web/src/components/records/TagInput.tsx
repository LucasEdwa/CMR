import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useTags } from '@/lib/crm'

type Props = { id?: string; value: string[]; onChange: (tags: string[]) => void }

// Type a tag and press Enter or comma. Existing tags are suggested by the browser's datalist.
export function TagInput({ id = 'tags', value, onChange }: Props) {
  const { t } = useTranslation()
  const tags = useTags()
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const name = raw.trim().replace(/,$/, '')
    if (name && !value.some((v) => v.toLowerCase() === name.toLowerCase())) onChange([...value, name])
    setDraft('')
  }

  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <li key={tag}>
              <Badge variant="secondary" className="gap-1 pr-1">
                {tag}
                <button
                  type="button"
                  className="hover:bg-muted rounded-sm p-0.5"
                  aria-label={t('tags.remove', { name: tag })}
                  onClick={() => onChange(value.filter((v) => v !== tag))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        list={`${id}-suggestions`}
        value={draft}
        placeholder={t('tags.placeholder')}
        onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(draft)
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={() => draft && add(draft)}
      />
      <datalist id={`${id}-suggestions`}>
        {tags.data?.filter((tag) => !value.includes(tag.name)).map((tag) => <option key={tag.id} value={tag.name} />)}
      </datalist>
    </div>
  )
}
