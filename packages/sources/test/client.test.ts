import { expect, test } from 'vitest'
import { WantedHttpError, getJson } from '../src/index.js'

// 타임아웃이 없으면 블랙홀 응답에서 Vercel 함수가 먼저 죽고, recordDetailFailure에
// 도달하지 못해 detail_attempts가 영원히 안 오른다 — 3회 상한이 무력해진다.
test('요청에 타임아웃 시그널을 걸고, 끊긴 요청은 재시도 가능한 실패로 분류한다', async () => {
  let signal: AbortSignal | null | undefined
  const fetchImpl: typeof fetch = async (_url, init) => {
    signal = init?.signal
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  }

  const thrown = await getJson('https://www.wanted.co.kr/api/v4/jobs/1', fetchImpl)
    .catch((err: unknown) => err)

  expect(signal).toBeInstanceOf(AbortSignal)
  expect(thrown).toBeInstanceOf(WantedHttpError)
  if (thrown instanceof WantedHttpError) {
    expect(thrown.status).toBe(0)
    expect(thrown.retryable).toBe(true)
  }
})

test('2xx인데 JSON이 아닌 본문(봇 차단 인터스티셜 등)은 재시도 가능한 WantedHttpError를 던진다', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response('<html><body>차단되었습니다</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })

  let thrown: unknown
  try {
    await getJson('https://www.wanted.co.kr/api/v4/jobs/1', fetchImpl)
  } catch (err) {
    thrown = err
  }

  expect(thrown).toBeInstanceOf(WantedHttpError)
  if (thrown instanceof WantedHttpError) {
    expect(thrown.retryable).toBe(true)
  }
})
