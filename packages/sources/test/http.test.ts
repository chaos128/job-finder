import { expect, test } from 'vitest'
import { SourceHttpError, WantedHttpError } from '../src/index.js'

// 5xx·429·타임아웃(status 0)만 재시도 가치가 있다. 404/422는 영구 실패다.
test.each([
  [500, true], [503, true], [429, true], [0, true],
  [404, false], [422, false], [400, false],
])('status %i의 retryable은 %s다', (status, expected) => {
  expect(new SourceHttpError(status, 'x').retryable).toBe(expected)
})

// 노드는 베이스 타입으로만 검사한다 — 소스가 늘어도 노드를 안 고치기 위해서다.
test('WantedHttpError는 SourceHttpError로 잡힌다', () => {
  expect(new WantedHttpError(503, 'boom')).toBeInstanceOf(SourceHttpError)
})
