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
      // 다섯 축 고정 색상 — bg-50/text-700 톤이라 warn(bg-100/text-900)보다 한 단계 옅다.
      // 경고 배지가 화면을 훑을 때도 이 색들 사이에서 더 진하게 두드러지도록 하는 의도다.
      // apps/web의 score-visuals.ts(세그먼트 바)·score-bars.tsx(상세 막대)와 같은 색 계열을
      // 써야 "같은 축은 어디서나 같은 색"이 성립한다 — 바꿀 때 그쪽도 함께 고쳐라.
      stack: 'border-green-300 bg-green-50 text-green-700',
      role: 'border-cyan-300 bg-cyan-50 text-cyan-700',
      domain: 'border-blue-300 bg-blue-50 text-blue-700',
      growth: 'border-violet-300 bg-violet-50 text-violet-700',
      conditions: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700',
    },
  },
  defaultVariants: { variant: 'default' },
})

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badge({ variant }), className)} {...props} />
}
