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

/**
 * Server Action이 던진 에러를 화면에 적을 문자열로 만든다.
 *
 * Next는 프로덕션 빌드에서 서버 에러의 message를 일반 문구로 갈아치우고 digest만
 * 남긴다(실측: 실패한 Server Action 응답이 `E{"digest":"3807785809"}` 하나였다).
 * 이 저장소엔 대시보드도 로그 수집기도 없어서, digest까지 버리면 서버 로그와 대조할
 * 단서가 0이 된다 — app/error.tsx가 세운 규약을 클라이언트 경계에서도 그대로 쓴다.
 */
export function errorText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  const digest = typeof e === 'object' && e !== null && 'digest' in e
    ? String((e as { digest?: unknown }).digest) : ''
  return digest ? `${message} (digest: ${digest})` : message
}
