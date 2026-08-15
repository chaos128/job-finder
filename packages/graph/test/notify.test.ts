import { MemoryStore, type ScoredJob } from '@job-finder/db'
import type { Mailer } from '@job-finder/mailer'
import { expect, test } from 'vitest'
import { runNotify, selectForDigest } from '../src/index.js'

function fakeMailer(onSend?: () => never) {
  const sent: Array<{ to: string; subject: string }> = []
  const mailer: Mailer = {
    async send(msg) {
      if (onSend) onSend()
      sent.push({ to: msg.to, subject: msg.subject })
    },
  }
  return { mailer, sent }
}

async function seedScored(store: MemoryStore, totals: number[]) {
  for (const [i, total] of totals.entries()) {
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
      reasoning: 'r', scorer: 'routine', rubricVersion: 'v1',
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
