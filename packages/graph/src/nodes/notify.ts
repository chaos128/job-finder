import type { NotifyRule, ScoredJob, Store } from '@job-finder/db'
import { renderDigest, type Mailer } from '@job-finder/mailer'
import { fail, ok, type Node } from '../core/node.js'

/**
 * 마감일 비교는 KST 날짜로 한다 — 원티드의 due_time은 한국 시각 기준 날짜이고,
 * notify cron은 UTC 00:00(KST 09:00)에 돈다. UTC 날짜로 비교하면 그 시각에
 * 아직 UTC로는 전날이라, 오늘 마감인 공고를 하루 일찍 버린다.
 */
function todayInKst(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 절대 임계값이 아니라 상대 순위로 자른다 — 채점 눈금이 흔들려도 알림 양이 튀지 않는다.
 *
 * 마감이 지난 공고는 제외한다. 후보는 발송될 때까지 계속 남으므로(notified_at이
 * NULL인 동안 매번 다시 조회된다), 거르지 않으면 몇 달 전 마감된 공고가 후보 풀에
 * 영원히 떠다니다 상위권이 빌 때 추천된다. due_time이 없는 공고(상시채용)는 남긴다.
 */
export function selectForDigest(
  candidates: ScoredJob[],
  rule: NotifyRule,
  now: Date = new Date(),
): ScoredJob[] {
  const today = todayInKst(now)
  return [...candidates]
    .filter((c) => c.score.total >= rule.minScore)
    .filter((c) => !c.job.dueTime || c.job.dueTime >= today)
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, rule.topN)
}

export interface NotifyPlan {
  notificationId: string
  to: string
  items: ScoredJob[]
}

export function createNotifyNode(
  deps: { store: Store; mailer: Mailer },
): Node<NotifyPlan, string> {
  return {
    name: 'notify',

    async run(plan) {
      try {
        const { subject, html, text } = renderDigest(plan.items)
        await deps.mailer.send({
          to: plan.to, subject, html, text, idempotencyKey: plan.notificationId,
        })
        await deps.store.markNotificationSent(plan.notificationId)
        return ok(plan.notificationId)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        await deps.store.markNotificationFailed(plan.notificationId, message)
        return fail('SEND_FAILED', message, true)
      }
    },
  }
}
