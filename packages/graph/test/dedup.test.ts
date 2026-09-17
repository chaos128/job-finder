import { expect, test } from 'vitest'
import type { DedupCandidate } from '@job-finder/db'
import { findDuplicate, normalizeCompany, normalizePosition } from '../src/index.js'

const c = (
  id: string, source: 'wanted' | 'remember', companyName: string, position: string,
): DedupCandidate => ({ id, source, companyName, position })

test('법인격 표기를 벗긴다', () => {
  expect(normalizeCompany('(주)루닛')).toBe('루닛')
  expect(normalizeCompany('주식회사 노써치')).toBe('노써치')
  expect(normalizeCompany('㈜토스')).toBe('토스')
  expect(normalizeCompany('Lunit Inc.')).toBe('lunit')
  expect(normalizeCompany('Coupang Corp')).toBe('coupang')
  expect(normalizeCompany('Coupang')).toBe('coupang')
  expect(normalizeCompany('Cocone Corporation')).toBe('cocone')
})

// 괄호 블록은 법인격뿐 아니라 브랜드 병기('힐링페이퍼(강남언니)')도 걷어낸다 —
// BRACKET_BLOCK 하나가 두 역할을 겸한다.
test('괄호 안 브랜드 병기와 법인격을 함께 벗긴다', () => {
  expect(normalizeCompany('힐링페이퍼(강남언니)')).toBe('힐링페이퍼')
  expect(normalizeCompany('(주)힐링페이퍼')).toBe('힐링페이퍼')
})

// 이름을 공유하는 별개 법인 — findDuplicate가 회사명을 포함 관계가 아니라
// 완전 일치로만 비교한다는 것을 보증한다. 포함 관계로 열면 이 쌍들이 뭉친다.
test('이름을 공유하는 다른 법인은 회사가 같다고 보지 않는다', () => {
  const tossIndex = [c('a', 'wanted', '토스', 'Senior Backend Engineer')]
  expect(findDuplicate(c('b', 'remember', '토스페이먼츠', 'Senior Backend Engineer'), tossIndex))
    .toBeNull()

  const kakaoIndex = [c('a', 'wanted', '카카오', 'Senior Backend Engineer')]
  expect(findDuplicate(c('b', 'remember', '카카오뱅크', 'Senior Backend Engineer'), kakaoIndex))
    .toBeNull()
})

// 회사명이 '(주)'뿐인 불량 데이터 — 통째로 지워지면 빈 문자열로 다른 불량
// 회사명과 전부 뭉친다. 지우기 전 이름으로 물러서는 폴백을 확인한다.
test('회사명이 통째로 지워지면 원래 이름으로 물러선다', () => {
  expect(normalizeCompany('(주)')).toBe('(주)')
})

test('직무명에서 대괄호 블록과 공백을 지운다', () => {
  expect(normalizePosition('[루닛]Senior Full Stack Engineer · AI Platform'))
    .toBe('seniorfullstackengineer·aiplatform')
  expect(normalizePosition('Senior Full Stack Engineer')).toBe('seniorfullstackengineer')
})

// Remember는 제목에 [회사명] 접두와 · 팀명 접미를 붙이는 경우가 많다.
// 완전 일치를 요구하면 이 실측 케이스를 놓친다.
test('접두·접미가 붙은 같은 공고를 찾아낸다', () => {
  const index = [c('a', 'wanted', '루닛', 'Senior Full Stack Engineer')]
  const found = findDuplicate(
    c('b', 'remember', '(주)루닛', '[루닛]Senior Full Stack Engineer · AI Platform'),
    index,
  )
  expect(found?.id).toBe('a')
})

// 짧은 제목은 아무거나 빨아들인다 — 정규화 후 8자 미만이면 판정하지 않는다.
test('짧은 직무명은 중복으로 보지 않는다', () => {
  const index = [c('a', 'wanted', '토스', '개발자')]
  expect(findDuplicate(c('b', 'remember', '토스', '프론트엔드 개발자'), index)).toBeNull()
})

// 같은 소스끼리는 포함 관계만으로 중복 처리하지 않는다 — 이 기능은 교차 중복
// 전용이다(같은 소스 재등록은 새 external_id로 들어오고, 재확인이 옛 행을 hidden
// 처리해 인덱스에서 빠진다). 이 가드가 없으면 'Frontend Engineer'와
// 'Frontend Engineer (MLOps, Vision AI Platform)'처럼 같은 회사의 서로 다른 공고가
// 뭉친다 — normalizePosition은 대괄호만 벗기고 괄호는 남기므로 포함 관계가 성립한다.
test('같은 소스끼리는 직무가 포함 관계여도 중복으로 보지 않는다', () => {
  const index = [c('a', 'wanted', '루닛', 'Frontend Engineer')]
  expect(findDuplicate(
    c('b', 'wanted', '루닛', 'Frontend Engineer (MLOps, Vision AI Platform)'), index,
  )).toBeNull()
})

test('회사가 다르면 직무가 같아도 중복이 아니다', () => {
  const index = [c('a', 'wanted', '루닛', 'Senior Full Stack Engineer')]
  expect(findDuplicate(c('b', 'remember', '토스', 'Senior Full Stack Engineer'), index)).toBeNull()
})

// 인덱스는 first_seen_at 오름차순으로 들어온다 — 앞에 있는 것이 원본이다.
// 실행 순서나 소스 순서로 결과가 흔들리면 안 된다.
test('후보가 여럿이면 먼저 수집된 쪽을 원본으로 삼는다', () => {
  const index = [
    c('old', 'wanted', '루닛', 'Senior Full Stack Engineer'),
    c('new', 'wanted', '루닛', 'Senior Full Stack Engineer · Platform'),
  ]
  expect(findDuplicate(c('x', 'remember', '루닛', 'Senior Full Stack Engineer'), index)?.id)
    .toBe('old')
})
