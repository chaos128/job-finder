import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from './cn.js'

const badge = cva('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'border-neutral-200 bg-neutral-100 text-neutral-700',
      // 옅은 카드 배경보다 눈에 띄어야 한다 — 채점이 멈춘 걸 놓치면 다이제스트 침묵의 원인을 못 찾는다.
      // amber-900 on amber-100은 대비비 약 8:1로 WCAG AA(4.5:1)를 넉넉히 넘는다.
      // (이전엔 amber-500 배경에 흰 텍스트라 약 2.15:1 — 흰 배지보다 오히려 안 보였다.)
      warn: 'border-amber-300 bg-amber-100 text-amber-900',
    },
  },
  defaultVariants: { variant: 'default' },
})

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badge({ variant }), className)} {...props} />
}
