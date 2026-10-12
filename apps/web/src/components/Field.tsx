import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

type FieldProps = {
  id: string
  label: string
  error?: string
  hint?: string
  children: ReactNode
}

// Label, control and message, wired for screen readers via aria-describedby on the control.
export function Field({ id, label, error, hint, children }: FieldProps) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-message`} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-message`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
