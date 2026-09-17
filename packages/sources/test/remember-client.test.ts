import { expect, test } from 'vitest'
import { RememberHttpError, postJson } from '../src/index.js'

test('POST 본문을 JSON으로 싣고 결과를 돌려준다', async () => {
  let seen: RequestInit | undefined
  const fake: typeof fetch = async (_url, init) => {
    seen = init
    return new Response(JSON.stringify({ ok: 1 }), { status: 200 })
  }
  expect(await postJson('https://x/y', { a: 1 }, fake)).toEqual({ ok: 1 })
  expect(seen!.method).toBe('POST')
  expect(JSON.parse(seen!.body as string)).toEqual({ a: 1 })
})

test('5xx는 retryable이다', async () => {
  const fake: typeof fetch = async () => new Response('', { status: 503 })
  // toSatisfy의 제네릭은 .rejects를 거치면 unknown으로 무너진다(vitest의
  // Promisify<Assertion<T>> 매핑 타입이 제네릭 메서드 시그니처를 못 지킨다) —
  // instanceof로 좁혀서 타입체크를 통과시킨다.
  await expect(postJson('https://x/y', {}, fake)).rejects.toSatisfy(
    (e: unknown) => e instanceof RememberHttpError && e.status === 503 && e.retryable,
  )
})

test('404는 retryable이 아니다', async () => {
  const fake: typeof fetch = async () => new Response('', { status: 404 })
  await expect(postJson('https://x/y', {}, fake)).rejects.toSatisfy(
    (e: unknown) => e instanceof RememberHttpError && e.status === 404 && !e.retryable,
  )
})

// 2xx인데 JSON이 아닌 본문(봇 차단 인터스티셜 등)은 영구 실패보다 일시적 차단일
// 가능성이 높다 — Wanted 클라이언트와 같은 판단이다.
test('2xx인데 JSON이 아니면 502로 분류한다', async () => {
  const fake: typeof fetch = async () => new Response('<html>', { status: 200 })
  await expect(postJson('https://x/y', {}, fake)).rejects.toSatisfy(
    (e: unknown) => e instanceof RememberHttpError && e.status === 502 && e.retryable,
  )
})
