import type { RunTrigger, ScoredJob, Store } from '@job-finder/db'
import type { Mailer } from '@job-finder/mailer'
import { createNotifyNode, selectForDigest, type NotifyPlan } from '../nodes/notify.js'
import { runNode, type FailedItem } from '../core/runner.js'

export interface NotifyReport {
  runId: string
  sent: number
  jobIds: string[]
  skipped: string | null
  /**
   * notifications에 attempts 카운터가 없어서, 영구히 실패하는 알림이 있으면
   * retry-first 게이트 때문에 이후 모든 실행이 그 알림만 계속 재시도하며
   * 새 다이제스트를 만들지 않는다 — sent: 0, skipped: null로 idle과 구분이
   * 안 된다. 이 필드는 그 상황을 드러내기 위한 것이다 (근본 수정은 attempts
   * 컬럼 추가 — DB 마이그레이션 필요, 이번 범위 밖).
   */
  failed: FailedItem[]
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
        return { runId, sent: 0, jobIds: [], skipped: 'no candidates above threshold', failed: [] }
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

    return { runId, sent: jobIds.length, jobIds, skipped: null, failed: summary.failed }
  } finally {
    try {
      await store.endRun(runId)
    } catch {
      // endRun은 관측용 마무리 기록이다 — 이게 실패했다고 이미 만든 report를
      // 날리거나(성공 케이스), 본문에서 던진 진짜 에러를 가려서는(실패 케이스) 안 된다.
    }
  }
}
