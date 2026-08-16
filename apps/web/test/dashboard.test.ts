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

test('분/시간/일 경계값에서 단위가 올라간다', () => {
  expect(formatRelativeTime('2026-08-15T23:00:00Z', NOW)).toBe('1시간 전')
  expect(formatRelativeTime('2026-08-15T00:00:00Z', NOW)).toBe('1일 전')
})

// started_at은 Postgres now(), ended_at은 Node Date라 시계가 어긋나면 미래 시각이 온다
// (실측: 8건 중 1건이 ended_at이 started_at보다 1442ms 빨랐다). 음수를 "-1분 전"으로 찍으면 안 된다.
test('시계 오차로 미래 시각이 와도 음수로 표기하지 않는다', () => {
  expect(formatRelativeTime('2026-08-16T00:00:01.442Z', NOW)).toBe('방금 전')
})

test('축 점수를 막대 비율로 바꾼다', () => {
  expect(axisPercent(20)).toBe(100)
  expect(axisPercent(10)).toBe(50)
  expect(axisPercent(0)).toBe(0)
})
