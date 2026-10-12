import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// Native <select> styled like the inputs: accessible, fast with long lists (time zones), good on phones.
export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'border-input bg-background focus-visible:ring-ring/50 h-9 w-full appearance-none rounded-md border px-3 pr-8 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="text-muted-foreground pointer-events-none absolute top-2.5 right-2.5 size-4" aria-hidden />
    </div>
  ),
)
NativeSelect.displayName = 'NativeSelect'
