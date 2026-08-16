import { expect, test } from 'vitest'
import { axisPercent, formatRelativeTime, isScoringStale } from '@/lib/dashboard'

const NOW = new Date('2026-08-16T00:00:00Z')

// 채점이 멈춘 것을 눈에 띄게 하는 게 이 화면의 목적이다.
test('마지막 채점이 7일을 넘으면 정지로 본다', () => {
  expect(isScoringStale('2026-08-15T00:00:00Z', NOW)).toBe(false)
  expect(isScoringStale('2026-08-09T00:00:00Z', NOW)).toBe(false)
  expect(isScoringStale('2026-08-08T23:00:00Z', NOW)).toBe(true)
})

test('한 번도 채점되지 않았으면 정지로 본다', () => {
  expect(isScoringStale(null, NOW)).toBe(true)
})

test('상대 시각을 한국어로 표기한다', () => {
  expect(formatRelativeTime('2026-08-15T23:30:00Z', NOW)).toBe('30분 전')
  expect(formatRelativeTime('2026-08-15T21:00:00Z', NOW)).toBe('3시간 전')
  expect(formatRelativeTime('2026-08-13T00:00:00Z', NOW)).toBe('3일 전')
  expect(formatRelativeTime(null, NOW)).toBe('없음')
})

test('축 점수를 막대 비율로 바꾼다', () => {
  expect(axisPercent(20)).toBe(100)
  expect(axisPercent(10)).toBe(50)
  expect(axisPercent(0)).toBe(0)
})
