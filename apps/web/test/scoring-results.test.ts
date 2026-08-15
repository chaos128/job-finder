import { randomUUID } from 'node:crypto'
import type { Store } from '@job-finder/db'
import { beforeEach, expect, test, vi } from 'vitest'

// getStore()는 실제 Supabase 클라이언트를 만든다 — 라우트가 부르기 전에 갈아끼운다.
const mocked = vi.hoisted(() => ({
  store: {} as { saveScore: ReturnType<typeof vi.fn>; recordScoreFailure: ReturnType<typeof vi.fn> },
}))
vi.mock('@/lib/store', () => ({ getStore: (): Store => mocked.store as unknown as Store }))

const { POST } = await import('@/app/api/scoring/results/route')

const TOKEN = 'test-scoring-token'

function request(body: unknown): Request {
  return new Request('https://example.test/api/scoring/results', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function validItem(jobId: string) {
  return {
    jobId,
    total: 70,
    breakdown: { stack: 14, role: 14, domain: 14, growth: 14, conditions: 14 },
    reasoning: '스택이 겹치고 연차도 맞는다.',
  }
}

beforeEach(() => {
  process.env.SCORING_TOKEN = TOKEN
  mocked.store = {
    saveScore: vi.fn(async () => {}),
    recordScoreFailure: vi.fn(async () => {}),
  }
})

test('19건 유효 + 1건 형식 오류면 19건을 저장하고 그 1건만 거부하며 실패를 기록한다', async () => {
  const ids = Array.from({ length: 20 }, () => randomUUID())
  const items = ids.map(validItem)
  items[19] = { ...items[19]!, total: 71 } // 합계 불일치 — routine이 가장 흔히 내는 실수

  const res = await POST(request(items))
  const body = await res.json()

  expect(res.status).toBe(200)
  expect(body.accepted).toBe(19)
  expect(body.rejected).toEqual([{ jobId: ids[19], reason: expect.stringContaining('합계') }])
  expect(mocked.store.saveScore).toHaveBeenCalledTimes(19)
  // attempts가 올라가야 3회 후 jobs_needing_score에서 빠지고 큐가 진행된다.
  expect(mocked.store.recordScoreFailure).toHaveBeenCalledTimes(1)
  expect(mocked.store.recordScoreFailure).toHaveBeenCalledWith(ids[19], expect.stringContaining('합계'))
})

test('jobId조차 못 읽는 항목은 rejected에만 담고 실패를 기록하지 않는다', async () => {
  const ok = randomUUID()
  const res = await POST(request([validItem(ok), { jobId: 'not-a-uuid', total: 70 }]))
  const body = await res.json()

  expect(body.accepted).toBe(1)
  expect(body.rejected).toHaveLength(1)
  expect(body.rejected[0].jobId).toBeNull()
  expect(mocked.store.recordScoreFailure).not.toHaveBeenCalled()
})

test('배열이 아니면 400으로 되돌려준다', async () => {
  const res = await POST(request({ jobId: randomUUID() }))
  expect(res.status).toBe(400)
  expect(mocked.store.saveScore).not.toHaveBeenCalled()
})

test('토큰이 틀리면 401이고 저장을 시도하지 않는다', async () => {
  const res = await POST(new Request('https://example.test/api/scoring/results', {
    method: 'POST',
    headers: { Authorization: 'Bearer wrong' },
    body: '[]',
  }))
  expect(res.status).toBe(401)
  expect(mocked.store.saveScore).not.toHaveBeenCalled()
})
