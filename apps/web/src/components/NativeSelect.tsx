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
          'border-input bg-background focus-visible:ring-ring/50 h-8 w-full appearance-none rounded-md border px-2.5 pr-8 text-[13px] shadow-xs outline-none focus-visible:ring-2 pointer-coarse:h-9 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2" aria-hidden />
    </div>
  ),
)
NativeSelect.displayName = 'NativeSelect'
