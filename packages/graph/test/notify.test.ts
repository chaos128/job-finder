import { MemoryStore, type ScoredJob } from '@job-finder/db'
import type { Mailer } from '@job-finder/mailer'
import { expect, test, vi } from 'vitest'
import { runNotify, selectForDigest } from '../src/index.js'

function fakeMailer(onSend?: () => never) {
  const sent: Array<{ to: string; subject: string; idempotencyKey: string }> = []
  const mailer: Mailer = {
    async send(msg) {
      if (onSend) onSend()
      sent.push({ to: msg.to, subject: msg.subject, idempotencyKey: msg.idempotencyKey })
    },
  }
  return { mailer, sent }
}

async function seedScored(store: MemoryStore, totals: number[], offset = 0) {
  for (const [n, total] of totals.entries()) {
    const i = offset + n
    const [job] = await store.insertJobs([{
      source: 'wanted', externalId: String(i), position: `Pos ${i}`,
      companyName: 'ACME', companyId: 1, addressDistrict: null, addressFull: null,
      url: `https://www.wanted.co.kr/wd/${i}`, dueTime: null,
    }])
    await store.saveJobDetail(job!.id, {
      intro: null, requirements: null, mainTasks: null,
      preferredPoints: null, benefits: null, skillTags: [], raw: {},
    })
    await store.saveScore({
      jobId: job!.id, total,
      breakdown: { stack: 0, role: 0, domain: 0, growth: 0, conditions: 0 },
      reasoning: 'r', summary: 's', scorer: 'routine', rubricVersion: 'v1',
    })
  }
}

test('selectForDigest는 상위 N을 최소 점수로 자른다', () => {
  const make = (total: number) => ({ job: { id: `j${total}` }, score: { total } } as ScoredJob)
  const picked = selectForDigest(
    [make(50), make(90), make(70), make(80)],
    { topN: 3, minScore: 60 },
  )
  expect(picked.map((p) => p.score.total)).toEqual([90, 80, 70])
})

test('최소 점수 미만만 있으면 아무것도 고르지 않는다', () => {
  const make = (total: number) => ({ job: { id: `j${total}` }, score: { total } } as ScoredJob)
  expect(selectForDigest([make(10), make(30)], { topN: 3, minScore: 60 })).toEqual([])
})

// 후보는 발송될 때까지 계속 남으므로, 거르지 않으면 마감된 공고가 영원히 떠다닌다.
test('마감이 지난 공고는 점수가 높아도 제외한다', () => {
  const make = (total: number, dueTime: string | null) =>
    ({ job: { id: `j${total}`, dueTime }, score: { total } } as ScoredJob)
  const picked = selectForDigest(
    [make(90, '2026-08-14'), make(80, null), make(70, '2026-08-31')],
    { topN: 3, minScore: 60 },
    new Date('2026-08-15T00:00:00Z'),
  )
  // 90점은 어제 마감. 상시채용(null)과 미래 마감은 남는다.
  expect(picked.map((p) => p.score.total)).toEqual([80, 70])
})

// KST 09:00 발송 시각은 UTC로 아직 같은 날 00:00이다. UTC 날짜로 비교하면
// 오늘 마감인 공고를 하루 일찍 버린다.
test('오늘 마감인 공고는 KST 기준으로 남긴다', () => {
  const make = (dueTime: string) => ({ job: { id: 'j', dueTime }, score: { total: 90 } } as ScoredJob)
  const atKst9am = new Date('2026-08-15T00:00:00Z')
  expect(selectForDigest([make('2026-08-15')], { topN: 3, minScore: 60 }, atKst9am)).toHaveLength(1)
  expect(selectForDigest([make('2026-08-14')], { topN: 3, minScore: 60 }, atKst9am)).toHaveLength(0)
})

test('minScore를 통과해도 topN을 넘는 항목은 잘린다', () => {
  const make = (total: number) => ({ job: { id: `j${total}` }, score: { total } } as ScoredJob)
  // 넷 다 minScore(60)는 넘긴다 — slice(0, topN)이 실제로 잘라내는지를 확인한다.
  const picked = selectForDigest(
    [make(90), make(80), make(70), make(65)],
    { topN: 2, minScore: 60 },
  )
  expect(picked.map((p) => p.score.total)).toEqual([90, 80])
})

test('조건을 만족하면 1통을 보내고 발송 표시한다', async () => {
  const store = new MemoryStore()
  await seedScored(store, [88, 71, 40])
  const { mailer, sent } = fakeMailer()

  const report = await runNotify({ store, mailer }, 'cron')

  expect(sent).toHaveLength(1)
  expect(sent[0]!.to).toBe('me@example.com')
  expect(report.sent).toBe(2)
  expect(await store.listNotifyCandidates()).toHaveLength(1) // 40점은 남아 있음
})

test('조건을 만족하는 게 없으면 메일을 보내지 않는다', async () => {
  const store = new MemoryStore()
  await seedScored(store, [30, 20])
  const { mailer, sent } = fakeMailer()

  const report = await runNotify({ store, mailer }, 'cron')

  expect(sent).toHaveLength(0)
  expect(report.sent).toBe(0)
  expect(report.skipped).toBe('no candidates above threshold')
})

test('발송 실패 시 pending으로 남아 다음 실행이 재시도한다', async () => {
  const store = new MemoryStore()
  await seedScored(store, [88])
  const failing = fakeMailer(() => { throw new Error('smtp down') })

  await runNotify({ store, mailer: failing.mailer }, 'cron')
  expect(await store.listPendingNotifications()).toHaveLength(1)
  expect(await store.listNotifyCandidates()).toHaveLength(1) // 아직 미발송

  const working = fakeMailer()
  const retry = await runNotify({ store, mailer: working.mailer }, 'cron')
  expect(working.sent).toHaveLength(1)
  expect(retry.sent).toBe(1)
  expect(await store.listPendingNotifications()).toHaveLength(0)
})

// poison pill: 영구 실패하는 알림 한 건이 retry-first 게이트를 막으면 이 서비스의
// 유일한 산출물이 영원히 멈춘다. attempts 상한이 그 고리를 끊는지 확인한다.
test('발송이 상한까지 실패하면 알림을 failed로 확정하고 다음 실행이 새 다이제스트를 만든다', async () => {
  const store = new MemoryStore()
  await seedScored(store, [88])
  const failing = fakeMailer(() => { throw new Error('Resend 422: invalid to') })

  for (let day = 0; day < 3; day++) {
    await runNotify({ store, mailer: failing.mailer }, 'cron')
  }
  expect(store.notifications.size).toBe(1) // 상한 전에는 같은 행만 재시도한다
  expect([...store.notifications.values()][0]!.status).toBe('failed')
  expect(await store.listPendingNotifications()).toHaveLength(0)

  // 그 사이 쌓인 신규 공고가 다음 실행에서 실제로 메일에 실려야 한다.
  await seedScored(store, [95], 1)
  const working = fakeMailer()
  const report = await runNotify({ store, mailer: working.mailer }, 'cron')

  expect(working.sent).toHaveLength(1)
  expect(working.sent[0]!.subject).toContain('최고 95점')
  expect(report.sent).toBe(2) // 못 보냈던 88점도 후보로 남아 있어 함께 나간다
  expect(store.notifications.size).toBe(2)
})

test('notify_email이 비어 있으면 알림 행을 만들지 않고 skip한다', async () => {
  const store = new MemoryStore()
  store.profile = { ...store.profile, notifyEmail: '' }
  await seedScored(store, [88])
  const { mailer, sent } = fakeMailer()

  const report = await runNotify({ store, mailer }, 'cron')

  expect(sent).toHaveLength(0)
  expect(report.skipped).toBe('notify_email not configured')
  expect(store.notifications.size).toBe(0) // 행을 만들면 그 자체가 poison pill이 된다
})

test('두 번 연속 실행해도 같은 공고를 두 번 보내지 않는다 (멱등)', async () => {
  const store = new MemoryStore()
  await seedScored(store, [88])
  const first = fakeMailer()
  await runNotify({ store, mailer: first.mailer }, 'cron')

  const second = fakeMailer()
  const report = await runNotify({ store, mailer: second.mailer }, 'cron')
  expect(second.sent).toHaveLength(0)
  expect(report.sent).toBe(0)
})

// 발송(mailer.send)은 성공했는데 그 직후 markNotificationSent 자체가 실패하는
// 경우 — row-before-send 설계가 막지 못하는 유일한 경로다. 메일은 이미
// 나갔는데 그 사실을 기록하지 못했으니 알림은 pending으로 남고, 다음 실행이
// 같은 공고를 다시 보낸다. 파이프라인 층위의 이 동작은 그대로다.
// 달라진 것은 두 번의 send가 같은 Idempotency-Key를 지고 나간다는 점이다 —
// 실제 Resend는 그 키로 두 번째 요청을 접어 수신함에는 한 통만 남는다
// (여기 fakeMailer는 그 접기를 흉내 내지 않으므로 호출은 2회로 잡힌다).
test('발송 후 markNotificationSent가 실패하면 다음 실행이 같은 알림을 같은 키로 재발송한다', async () => {
  const store = new MemoryStore()
  await seedScored(store, [88])
  vi.spyOn(store, 'markNotificationSent').mockRejectedValueOnce(new Error('commit failed'))

  const first = fakeMailer()
  await runNotify({ store, mailer: first.mailer }, 'cron')

  // 메일은 실제로 나갔다 — 하지만 기록에 실패해 pending으로 되돌아가고,
  // notifiedAt도 안 찍혀서 여전히 후보로 남는다.
  expect(first.sent).toHaveLength(1)
  expect(await store.listPendingNotifications()).toHaveLength(1)
  expect(await store.listNotifyCandidates()).toHaveLength(1)

  const second = fakeMailer()
  const retry = await runNotify({ store, mailer: second.mailer }, 'cron')

  // 두 번째 요청이 나가긴 하지만 첫 요청과 키가 같다 — Resend가 접는다.
  expect(second.sent).toHaveLength(1)
  expect(second.sent[0]!.idempotencyKey).toBe(first.sent[0]!.idempotencyKey)
  expect(retry.sent).toBe(1)
  expect(await store.listPendingNotifications()).toHaveLength(0)
})
