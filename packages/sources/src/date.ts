/**
 * jobs.due_time is a Postgres `date` column: keep only a real calendar date's
 * YYYY-MM-DD prefix, else null. A shape-only regex would let "2026-02-30" through
 * (Postgres would then abort the whole batch insert with 22007), so the extracted
 * date is round-tripped through `Date` to confirm it doesn't overflow into another day.
 *
 * 소스 공용이다 — 이건 Wanted 응답의 특성이 아니라 우리 쪽 컬럼 타입의 제약이라,
 * 소스마다 복제하면 한 곳만 고쳐지고 나머지가 조용히 틀린다.
 */
export function normalizeDueTime(raw: string | null | undefined): string | null {
  if (!raw) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (!match) return null
  const dateStr = match[0]!
  const year = Number(match[1]!)
  const month = Number(match[2]!)
  const day = Number(match[3]!)
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
  const isRealDate =
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  return isRealDate ? dateStr : null
}
