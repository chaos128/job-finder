import type { Store } from '@job-finder/db'
import { beforeEach, expect, test, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  collect: {} as Record<string, unknown>,
  notify: {} as Record<string, unknown>,
}))

vi.mock('@job-finder/graph', () => ({
  runCollect: async () => mocked.collect,
  runNotify: async () => mocked.notify,
}))
vi.mock('@/lib/store', () => ({ getStore: (): Store => ({}) as Store }))
vi.mock('@/lib/mailer', () => ({ getMailer: () => ({ async send() {} }) }))

const { GET: collectGET } = await import('@/app/api/cron/collect/route')
const { GET: notifyGET } = await import('@/app/api/cron/notify/route')

const TOKEN = 'test-cron-secret'
const request = () =>
  new Request('https://example.test/api/cron', { headers: { Authorization: `Bearer ${TOKEN}` } })

const failure = { itemId: 'job_1', code: 'WANTED_HTTP', message: '500 boom', retryable: true }

beforeEach(() => {
  process.env.CRON_SECRET = TOKEN
  mocked.collect = { runId: 'run_1', searches: 1, found: 3, created: 1, detailed: 1, hitDetailLimit: false, failed: [] }
  mocked.notify = { runId: 'run_2', sent: 1, jobIds: ['job_1'], skipped: null, failed: [] }
})

test('collect: 실패가 없으면 200', async () => {
  expect((await collectGET(request())).status).toBe(200)
})

// Vercel cron 로그의 상태 코드가 유일한 실패 신호다 — 200이면 무음 정지가 된다.
test('collect: 건별 실패가 있으면 5xx로 알리되 리포트 본문은 유지한다', async () => {
  mocked.collect = { ...mocked.collect, failed: [{ ...failure, node: 'fetchDetail' }] }
  const res = await collectGET(request())
  expect(res.status).toBe(500)
  expect((await res.json()).failed).toHaveLength(1)
})

test('notify: 실패가 없으면 200', async () => {
  expect((await notifyGET(request())).status).toBe(200)
})

test('notify: 발송 실패가 있으면 5xx로 알리되 리포트 본문은 유지한다', async () => {
  mocked.notify = { ...mocked.notify, sent: 0, failed: [{ ...failure, itemId: 'ntf_1', code: 'SEND_FAILED' }] }
  const res = await notifyGET(request())
  expect(res.status).toBe(500)
  expect((await res.json()).failed).toHaveLength(1)
})
