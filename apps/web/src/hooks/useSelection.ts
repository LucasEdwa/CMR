import { useState } from 'react'

// Selected row ids for bulk actions. They survive paging, so rows on several pages can be picked.
export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const onChange = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  return { selected, onChange, clear: () => setSelected(new Set()), ids: [...selected] }
}
