import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: string; action?: ReactNode }) {
  return (
    <section className="grid justify-items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <Icon className="text-muted-foreground size-10" aria-hidden />
      <h2 className="text-lg font-medium">{title}</h2>
      {body && <p className="text-muted-foreground max-w-md">{body}</p>}
      {action}
    </section>
  )
}
