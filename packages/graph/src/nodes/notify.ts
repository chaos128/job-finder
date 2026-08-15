import type { NotifyRule, ScoredJob, Store } from '@job-finder/db'
import { renderDigest, type Mailer } from '@job-finder/mailer'
import { fail, ok, type Node } from '../core/node.js'

/** 절대 임계값이 아니라 상대 순위로 자른다 — 채점 눈금이 흔들려도 알림 양이 튀지 않는다. */
export function selectForDigest(candidates: ScoredJob[], rule: NotifyRule): ScoredJob[] {
  return [...candidates]
    .filter((c) => c.score.total >= rule.minScore)
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
