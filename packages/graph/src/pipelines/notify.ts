import type { RunTrigger, ScoredJob, Store } from '@job-finder/db'
import type { Mailer } from '@job-finder/mailer'
import { createNotifyNode, selectForDigest, type NotifyPlan } from '../nodes/notify.js'
import { runNode, type FailedItem } from '../core/runner.js'

/**
 * 설정 누락으로 인한 skip — "오늘 후보 없음"과 달리 사람이 고쳐야 하는 상태다.
 * cron 라우트가 이 값만 골라 5xx로 올리므로 상수로 공유한다.
 */
export const NOTIFY_SKIP_MISCONFIGURED = 'notify_email not configured'

export interface NotifyReport {
  runId: string
  sent: number
  jobIds: string[]
  skipped: string | null
  /**
   * 발송 실패는 sent: 0, skipped: null이라 idle과 구분이 안 된다 — 이 필드가
   * 유일한 흔적이고, cron 라우트는 이게 비어 있지 않으면 5xx로 응답한다.
   * (영구 실패는 notifications.attempts 상한이 status='failed'로 확정한다.)
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
    // 수신 주소가 없으면 알림 행조차 만들지 않는다 — 빈 주소는 Resend에서
    // 영구 4xx라, 행을 만들면 상한(3)까지 헛발송한 뒤에야 게이트가 풀린다.
    if (profile.notifyEmail.trim() === '') {
      return { runId, sent: 0, jobIds: [], skipped: NOTIFY_SKIP_MISCONFIGURED, failed: [] }
    }
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
