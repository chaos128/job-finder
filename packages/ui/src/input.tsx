import type { InputHTMLAttributes } from 'react'
import { cn } from './cn.js'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-neutral-500',
        className,
      )}
      {...props}
    />
  )
}
