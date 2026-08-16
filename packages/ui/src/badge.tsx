import type { HTMLAttributes } from 'react'
import { cn } from './cn.js'

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700',
        className,
      )}
      {...props}
    />
  )
}
