/**
 * 대시보드 정렬의 유일한 정의: hidden(제외됨) 오름차순 → total 내림차순 →
 * jobId 내림차순. 제외된 공고는 점수와 무관하게 맨 뒤로 간다.
 *
 * 이 파일은 의존성이 없고 배럴(index.ts)에도 안 걸린다 — 클라이언트 컴포넌트가
 * `@job-finder/db/dashboard-order` 서브패스로 직접 값 import할 수 있게 하기
 * 위해서다. 배럴을 타면 supabase-store → @supabase/supabase-js가 브라우저
 * 번들로 딸려 들어온다. 정렬 규칙을 서버(MemoryStore)와 클라이언트가 각자
 * 복제하면 어긋나는 순간 페이징이 깨지므로, 정의를 하나로 묶는다.
 */
export function compareDashboardOrder(
  a: { hidden: boolean; total: number; jobId: string },
  b: { hidden: boolean; total: number; jobId: string },
): number {
  if (a.hidden !== b.hidden) return a.hidden ? 1 : -1
  if (a.total !== b.total) return b.total - a.total
  return a.jobId < b.jobId ? 1 : -1
}
