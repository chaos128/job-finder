import { expect, test } from 'vitest'
import { WantedHttpError, getJson } from '../src/index.js'

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
