import type { Source } from '@job-finder/db'

/**
 * 소스 → 배지 라벨. `row.source === 'remember' ? '리멤버' : '원티드'` 식의 삼항은
 * 매핑에 없는 값까지 전부 '원티드'로 잘못 표시한다 — 여기서는 모르는 값이면
 * 틀린 라벨 대신 원문 그대로 보여준다.
 */
const SOURCE_LABELS: Record<Source, string> = { wanted: '원티드', remember: '리멤버' }

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as Source] ?? source
}
