import type { RunTrigger, ScoredJob, Store } from '@job-finder/db'
import type { Mailer } from '@job-finder/mailer'
import { createNotifyNode, selectForDigest, type NotifyPlan } from '../nodes/notify.js'
import { runNode } from '../core/runner.js'

export interface NotifyReport {
  runId: string
  sent: number
  jobIds: string[]
  skipped: string | null
}

export async function runNotify(
  deps: { store: Store; mailer: Mailer },
  trigger: RunTrigger,
): Promise<NotifyReport> {
  const { store, mailer } = deps
  const runId = await store.startRun(trigger)

  try {
    const profile = await store.getProfile()
    const candidates = await store.listNotifyCandidates()
    const byId = new Map(candidates.map((c) => [c.job.id, c]))

    // 1. 지난 실행에서 발송에 실패한 알림을 먼저 처리한다.
    const plans: NotifyPlan[] = []
    for (const pending of await store.listPendingNotifications()) {
      const items = pending.jobIds
        .map((id) => byId.get(id))
        .filter((c): c is ScoredJob => c !== undefined)
      if (items.length > 0) {
        plans.push({ notificationId: pending.id, to: profile.notifyEmail, items })
      } else {
        await store.markNotificationSent(pending.id) // 대상이 사라졌으면 닫는다
      }
    }

    // 2. 재시도할 알림이 없을 때만 새 다이제스트를 만든다.
    //    재시도가 있으면 이번 실행은 그것만 처리하고, 새 후보는 다음 실행이 가져간다.
    if (plans.length === 0) {
      const picked = selectForDigest(candidates, profile.notifyRule)
      if (picked.length === 0) {
        return { runId, sent: 0, jobIds: [], skipped: 'no candidates above threshold' }
      }
      const notification = await store.createNotification(picked.map((p) => p.job.id))
      plans.push({ notificationId: notification.id, to: profile.notifyEmail, items: picked })
    }

    const summary = await runNode(
      createNotifyNode({ store, mailer }),
      plans,
      (p) => p.notificationId,
      { runId, store, concurrency: 1 },
    )

    const sentPlans = plans.filter((p) => summary.ok.includes(p.notificationId))
    const jobIds = sentPlans.flatMap((p) => p.items.map((i) => i.job.id))

    return { runId, sent: jobIds.length, jobIds, skipped: null }
  } finally {
    await store.endRun(runId)
  }
}
