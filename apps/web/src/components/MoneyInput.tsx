import { useState } from 'react'
import { formatMoney, parseMoney, type Currency } from '@crm/shared'
import { Input } from '@/components/ui/input'

type Props = {
  id: string
  value: number
  currency: Currency
  onChange: (minorUnits: number) => void
  invalid?: boolean
}

// Typed as "1 999,50" (or 1999.50); stored as integer öre. Shows the formatted amount when not editing.
export function MoneyInput({ id, value, currency, onChange, invalid }: Props) {
  const [text, setText] = useState(() => (value ? formatMoney(value, currency).replace(/\s?[^\d\s,.-]+$/, '') : ''))
  const [error, setError] = useState(false)

  return (
    <Input
      id={id}
      inputMode="decimal"
      autoComplete="off"
      aria-invalid={invalid || error}
      value={text}
      placeholder="0"
      onChange={(e) => {
        setText(e.target.value)
        const parsed = e.target.value.trim() === '' ? 0 : parseMoney(e.target.value)
        setError(parsed === null)
        if (parsed !== null) onChange(parsed)
      }}
      onBlur={() => {
        const parsed = text.trim() === '' ? 0 : parseMoney(text)
        if (parsed !== null) setText(parsed ? formatMoney(parsed, currency).replace(/\s?[^\d\s,.-]+$/, '') : '')
      }}
    />
  )
}
