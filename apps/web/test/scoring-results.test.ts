import { randomUUID } from 'node:crypto'
import type { Store } from '@job-finder/db'
import { beforeEach, expect, test, vi } from 'vitest'

// getStore()는 실제 Supabase 클라이언트를 만든다 — 라우트가 부르기 전에 갈아끼운다.
const mocked = vi.hoisted(() => ({
  store: {} as {
    saveScore: ReturnType<typeof vi.fn>
    recordScoreFailure: ReturnType<typeof vi.fn>
    setJobHidden: ReturnType<typeof vi.fn>
  },
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
    summary: 'ACME에서 결제 웹 프론트엔드를 맡는 자리다.',
  }
}

beforeEach(() => {
  process.env.SCORING_TOKEN = TOKEN
  mocked.store = {
    saveScore: vi.fn(async () => {}),
    recordScoreFailure: vi.fn(async () => {}),
    setJobHidden: vi.fn(async () => {}),
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

/** 총점을 다섯 축에 나눠 담는다 — 축 하나는 0~20 정수라 total을 한 축에 몰 수 없다. */
function breakdownFor(total: number) {
  const axes = ['stack', 'role', 'domain', 'growth', 'conditions'] as const
  const out: Record<string, number> = {}
  let left = total
  for (const a of axes) { out[a] = Math.min(20, left); left -= out[a]! }
  return out
}

// 50점 이하 자동 제외. "50점 이하"라 경계값 50은 포함이고 51은 아니다 —
// 운영 240건 중 정확히 50점이 10건이라 이 한 칸이 실제로 갈린다.
test.each([
  [30, true], [49, true], [50, true], [51, false], [70, false],
])('%i점이면 자동 제외 호출 = %s', async (total, shouldHide) => {
  const id = randomUUID()
  const res = await POST(request([{ ...validItem(id), total, breakdown: breakdownFor(total) }]))

  expect((await res.json()).accepted).toBe(1)
  if (shouldHide) expect(mocked.store.setJobHidden).toHaveBeenCalledWith(id, true)
  else expect(mocked.store.setJobHidden).not.toHaveBeenCalled()
})

// 제외 처리는 점수 저장의 후속 편의다. 이게 실패했다고 recordScoreFailure가 불리면
// 방금 저장된 멀쩡한 점수가 status='failed'로 덮여 큐에서 영구 이탈할 수 있다.
test('자동 제외가 실패해도 점수는 저장된 것으로 남고 실패로 기록되지 않는다', async () => {
  const id = randomUUID()
  mocked.store.setJobHidden = vi.fn(async () => { throw new Error('boom') })
  const res = await POST(request([{ ...validItem(id), total: 30, breakdown: breakdownFor(30) }]))
  const body = await res.json()

  expect(res.status).toBe(200)
  expect(body.accepted).toBe(1)
  expect(body.rejected).toEqual([])
  expect(mocked.store.recordScoreFailure).not.toHaveBeenCalled()
})

// 자동화가 사람의 결정을 덮어쓰면 안 된다 — 손으로 제외해 둔 공고가 재채점 때
// 되살아나는 일이 없도록, 높은 점수에서도 hidden=false로 되돌리지 않는다.
test('51점 이상이어도 제외를 풀지 않는다', async () => {
  const id = randomUUID()
  await POST(request([validItem(id)]))
  expect(mocked.store.setJobHidden).not.toHaveBeenCalled()
})
