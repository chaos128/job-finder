import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn.js'

const button = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // 주요 동작은 액센트(브랜드)로. 검정 버튼은 카드·경계선이 전부 옅어진
        // 지금 배색에서 혼자 과하게 무겁다.
        default: 'bg-brand text-white hover:bg-brand/90',
        outline: 'border border-line bg-white hover:bg-neutral-50',
        ghost: 'hover:bg-neutral-100',
      },
      size: { default: 'h-9 px-4', sm: 'h-8 px-3 text-xs' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />
}
