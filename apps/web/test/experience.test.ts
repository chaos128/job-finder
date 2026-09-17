import { expect, test } from 'vitest'
import { formatExperience } from '@/app/jobs/_components/experience'

// 아래 일곱 줄은 운영 240건에서 뽑은 대표 조합을 실제 Wanted 공고 페이지의
// JobHeader span과 직접 대조해 받아 적은 것이다. 표기 규칙을 짐작으로 두면
// "경력 5~100년" 같은 문구가 조용히 화면에 나간다.
test.each([
  [3, 8, '경력 3-8년'],
  [12, 20, '경력 12-20년'],
  [5, 100, '경력 5년 이상'],
  [8, 8, '경력 8년'],
  [0, 10, '신입-경력 10년'],
  [0, 35, '신입-경력 35년'],
  [0, 100, '신입 이상'],
])('annual %i~%i → %s', (from, to, expected) => {
  expect(formatExperience(from, to)).toBe(expected)
})

// 0007 적용 전에 수집된 행과 상세 조회 전 행이 여기 해당한다. 화면은 null일 때
// 아무것도 그리지 않으므로, 빈 문자열이 아니라 null이어야 한다.
test('값이 없으면 null이다', () => {
  expect(formatExperience(null, null)).toBeNull()
  expect(formatExperience(5, null)).toBeNull()
  expect(formatExperience(null, 100)).toBeNull()
})
