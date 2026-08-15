import type { Store } from '@job-finder/db'
import { NOTIFY_SKIP_MISCONFIGURED } from '@job-finder/graph'
import { beforeEach, expect, test, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  collect: {} as Record<string, unknown>,
  notify: {} as Record<string, unknown>,
}))

// NOTIFY_SKIP_MISCONFIGURED는 실제 값을 그대로 가져온다 — 여기에 리터럴을 박으면
// 상수가 바뀌었을 때 라우트는 깨지는데 테스트는 계속 통과한다.
vi.mock('@job-finder/graph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@job-finder/graph')>()),
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

// 설정 누락은 아무것도 "실패"하지 않아 failed가 비지만, 고쳐주기 전까지 매일
// 아무 일도 안 한다 — 200으로 두면 정상 idle과 구분되지 않는다.
test('notify: notify_email 미설정 skip은 failed가 비어도 5xx', async () => {
  mocked.notify = { ...mocked.notify, sent: 0, jobIds: [], skipped: NOTIFY_SKIP_MISCONFIGURED }
  const res = await notifyGET(request())
  expect(res.status).toBe(500)
  expect((await res.json()).skipped).toBe(NOTIFY_SKIP_MISCONFIGURED)
})

// 반대로 후보가 없어서 쉬는 것은 정상이다 — 여기서 5xx가 나면 매일 거짓 경보가 된다.
test('notify: 후보 없음 skip은 200', async () => {
  mocked.notify = { ...mocked.notify, sent: 0, jobIds: [], skipped: 'no candidates above threshold' }
  expect((await notifyGET(request())).status).toBe(200)
})
