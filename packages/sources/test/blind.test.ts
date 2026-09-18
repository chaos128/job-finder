import { expect, test } from 'vitest'
import { parseSearchCandidatesFixture } from './fixtures/blind.js'
import { parseSearchPage, searchCandidates } from '../src/index.js'

// 실제 teamblind.com/kr/search 응답에서 회사 카드 부분만 잘라온 것이다.
// 마크업이 바뀌면 이 테스트가 먼저 깨져야 한다 — 안 그러면 운영에서 전 회사가
// 조용히 '미등록'이 된다(파싱 실패와 미등록을 구분하지 않기 때문).
const REAL_BLOCK = parseSearchCandidatesFixture

test('검색 결과에서 회사명·별점·링크를 뽑는다', () => {
  expect(parseSearchPage(REAL_BLOCK)).toEqual({
    name: '와이즈버즈',
    rating: 3.4,
    url: 'https://www.teamblind.com/kr/company/%EC%99%80%EC%9D%B4%EC%A6%88%EB%B2%84%EC%A6%88/',
  })
})

test('회사 카드가 없는 검색 결과는 null이다', () => {
  expect(parseSearchPage('<div class="srch_result"><h1>검색결과</h1></div>')).toBeNull()
})

// 리뷰가 없는 회사는 star 스팬이 빈 값으로 붙는다. 0점짜리 별점은 존재하지 않으므로
// 미등록과 같게 다룬다 — 화면에 ★0.0을 그리면 "평가가 나쁜 회사"로 읽힌다.
test('별점이 비어 있으면 null이다', () => {
  const html = '<a href="/kr/company/x/" class="name"> X </a>'
    + ' <span class="star"><i class="blind">Rating Score</i></span>'
  expect(parseSearchPage(html)).toBeNull()
})

test('괄호가 붙은 회사명은 원문 → 앞부분 → 괄호 안 순으로 시도한다', () => {
  expect(searchCandidates('힐링페이퍼(강남언니)')).toEqual(['힐링페이퍼(강남언니)', '힐링페이퍼', '강남언니'])
  expect(searchCandidates('이베이재팬(eBay)')).toEqual(['이베이재팬(eBay)', '이베이재팬', 'eBay'])
})

test('괄호가 없으면 후보는 하나뿐이다', () => {
  expect(searchCandidates('와이즈버즈')).toEqual(['와이즈버즈'])
})

test('법인 접두·접미어는 떼고 찾는다', () => {
  expect(searchCandidates('주식회사 노써치')).toEqual(['노써치'])
})

// 접두어를 뗀 뒤 같아지는 후보로 같은 질의를 두 번 내보내면 요청만 두 배가 된다.
// 원문은 그대로 남는다 — Blind에 괄호까지 포함된 이름으로 등록돼 있을 수 있어
// 정확한 표기를 가장 먼저 시도하는 것이 맞다.
test('접두어를 뗀 뒤 겹치는 후보는 합친다', () => {
  expect(searchCandidates('노써치(주식회사 노써치)')).toEqual(['노써치(주식회사 노써치)', '노써치'])
})

// 운영 실측: 미등록으로 확정된 174곳 중 82곳(47%)이 `(주)`로 시작했고, `(주)`가
// 붙은 회사 중 별점이 잡힌 곳은 0곳이었다. 한 글자 `㈜`만 떼고 괄호 형태는 그대로
// 내보내고 있었다 — Blind는 `(주)씨디알아이`를 못 찾고 `씨디알아이`는 찾는다.
test('괄호 형태의 법인 접두어도 뗀다', () => {
  expect(searchCandidates('(주)씨디알아이')).toEqual(['씨디알아이'])
  expect(searchCandidates('(주)카카오스타일')).toEqual(['카카오스타일'])
  expect(searchCandidates('（주）무신사')).toEqual(['무신사'])
  expect(searchCandidates('노써치(주)')).toEqual(['노써치'])
})

// 접두어를 뗀 뒤에도 괄호 별칭 분해는 그대로 살아 있어야 한다.
test('법인 접두어와 괄호 별칭이 함께 있어도 둘 다 처리한다', () => {
  expect(searchCandidates('(주)힐링페이퍼(강남언니)'))
    .toEqual(['힐링페이퍼(강남언니)', '힐링페이퍼', '강남언니'])
})
