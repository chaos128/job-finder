import { expect, test } from 'vitest'
import { normalizeDueTime } from '../src/index.js'

test('ISO 문자열에서 날짜 앞부분만 남긴다', () => {
  expect(normalizeDueTime('2026-09-17T12:00:00.000+09:00')).toBe('2026-09-17')
})

// 모양만 맞는 정규식은 2026-02-30을 통과시키고, Postgres가 date 컬럼에서
// 22007로 배치 insert 전체를 죽인다. Date 왕복으로 실재하는 날짜인지 확인한다.
test('달력에 없는 날짜는 null이다', () => {
  expect(normalizeDueTime('2026-02-30')).toBeNull()
  expect(normalizeDueTime('2026-13-01')).toBeNull()
})

test('빈 값은 null이다', () => {
  expect(normalizeDueTime(null)).toBeNull()
  expect(normalizeDueTime(undefined)).toBeNull()
  expect(normalizeDueTime('')).toBeNull()
  expect(normalizeDueTime('상시채용')).toBeNull()
})
