/**
 * 다섯 축 고정 색상과 총점 밴드. 카드의 세그먼트 바, 상세 ScoreBars의 개별 막대가
 * 이 매핑을 함께 쓴다 — "같은 축은 어디서나 같은 색"이 여기 하나로 강제된다.
 * packages/ui의 Badge variant(stack/role/domain/growth/conditions)와 같은 색
 * 계열이어야 하므로, 바꿀 때 그쪽도 함께 고쳐라.
 */
export const AXIS_BAR_COLOR: Record<string, string> = {
  stack: 'bg-green-500',
  role: 'bg-cyan-500',
  domain: 'bg-blue-500',
  growth: 'bg-violet-500',
  conditions: 'bg-fuchsia-500',
}

/**
 * 실측(168건, 2026-08-16) total 분포: min 17 / p50 53 / p90 74 / max 84.
 * 상위권(70+, 상위 약 18%)만 강조하고 하위권(30 이하, 하위 약 10%)은 옅게 죽인다 —
 * 카드 대부분을 차지하는 중간대는 손대지 않는다("카드마다 소리 지르지 않는다").
 */
export function scoreBandClass(total: number): string {
  if (total >= 70) return 'text-emerald-600'
  if (total <= 30) return 'text-neutral-400'
  return ''
}
