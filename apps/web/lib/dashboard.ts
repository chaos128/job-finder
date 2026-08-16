import { MAX_AXIS_SCORE } from '@job-finder/scoring'

/** 수동 채점 주기를 감안한 값. 이보다 벌어지면 사람이 손대야 한다. */
const STALE_DAYS = 7

export function isScoringStale(lastScoredAt: string | null, now: Date): boolean {
  if (!lastScoredAt) return true
  return now.getTime() - new Date(lastScoredAt).getTime() > STALE_DAYS * 86_400_000
}

export function formatRelativeTime(at: string | null, now: Date): string {
  if (!at) return '없음'
  const min = Math.floor((now.getTime() - new Date(at).getTime()) / 60_000)
  // started_at은 Postgres now(), 여기 now는 Node Date라 시계가 어긋나면 미래 시각이 온다
  // (실측: 8건 중 1건이 ended_at이 started_at보다 1442ms 빨랐다). 음수를 그대로 찍으면 "-1분 전".
  if (min <= 0) return '방금 전'
  if (min < 60) return `${min}분 전`
  if (min < 1440) return `${Math.floor(min / 60)}시간 전`
  return `${Math.floor(min / 1440)}일 전`
}

export function axisPercent(score: number): number {
  return (score / MAX_AXIS_SCORE) * 100
}
