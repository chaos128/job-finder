import { AXIS_COLORS, type Axis } from '@job-finder/ui'

/**
 * 카드 세그먼트 바·상세 ScoreBars가 쓰는 축별 막대 색. 값의 정의처는
 * `@job-finder/ui`의 axis-colors.ts 하나뿐이다 — 여기서는 그 `bar` 필드만 뽑아 쓴다.
 * packages/ui는 apps/web을 import할 수 없어 반대 방향(여기서 저쪽을 import)으로 둔다.
 */
export const AXIS_BAR_COLOR: Record<Axis, string> = {
  stack: AXIS_COLORS.stack.bar,
  role: AXIS_COLORS.role.bar,
  domain: AXIS_COLORS.domain.bar,
  growth: AXIS_COLORS.growth.bar,
  conditions: AXIS_COLORS.conditions.bar,
}

/**
 * 실측(168건, 2026-08-16) total 분포: min 17 / p50 53 / p90 74 / max 84.
 * 하위권(30점 이하, 하위 약 10%)만 옅게 죽인다 — 명도 차이라 축 색상과 겹치지 않는다.
 *
 * 상위권에는 색을 얹지 않는다. 원래는 emerald-600(OKLCH 약 163도)으로 강한 매치를
 * 강조했는데, 그 시점의 stack 축 색(green-500, 약 150도)과 14도밖에 안 떨어져 있어
 * 84점 카드에서 총점 숫자와 stack 세그먼트가 둘 다 그냥 "초록"으로 읽혔다 — 팔레트가
 * 이미 쓰고 있는 색상 위에 총점 강도라는 여섯 번째 의미가 얹힌 것이다(리뷰 지적).
 * 다른 색상으로 옮기는 대신 아예 뺐다: 다섯 축 팔레트가 이미 쓸 수 있는 색상 공간을
 * 채우고 있고(amber는 경고, red는 에러 전용), 세그먼트 바가 이미 구성을, 큰 숫자
 * 자체가 이미 크기로 강도를 전달하므로 색조가 없어도 된다.
 */
export function scoreBandClass(total: number): string {
  if (total <= 30) return 'text-neutral-400'
  return ''
}
