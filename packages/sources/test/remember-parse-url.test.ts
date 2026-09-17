import { expect, test } from 'vitest'
import { buildRememberSearchBody, parseRememberSearchUrl } from '../src/index.js'

// 실제 검색 페이지 URL이다. ?search=에 camelCase JSON이 통째로 들어간다.
const REAL_URL =
  'https://career.rememberapp.co.kr/job/postings?search=' +
  encodeURIComponent(JSON.stringify({
    jobCategoryNames: [{ level1: 'SW개발', level2: '프론트엔드' }],
    addresses: [['서울특별시'], ['경기도']],
    organizationType: 'without_headhunter',
    minExperience: 7,
  }))

test('search 파라미터의 JSON을 그대로 읽는다', () => {
  expect(parseRememberSearchUrl(REAL_URL)).toEqual({
    source: 'remember',
    jobCategoryNames: [{ level1: 'SW개발', level2: '프론트엔드' }],
    addresses: [['서울특별시'], ['경기도']],
    organizationType: 'without_headhunter',
    minExperience: 7,
  })
})

test('빠진 필드는 빈 값으로 채운다', () => {
  const url = 'https://career.rememberapp.co.kr/job/postings?search=' +
    encodeURIComponent(JSON.stringify({ minExperience: 3 }))
  expect(parseRememberSearchUrl(url)).toEqual({
    source: 'remember',
    jobCategoryNames: [],
    addresses: [],
    organizationType: null,
    minExperience: 3,
  })
})

test('search 파라미터가 없으면 던진다', () => {
  expect(() => parseRememberSearchUrl('https://career.rememberapp.co.kr/job/postings'))
    .toThrow(/search/)
})

// 이 변환표가 이 파일의 핵심이다. camelCase로 보내면 API가 400이 아니라
// 그 필터를 무시하고 200을 돌려준다(실측 122건 → 12,894건).
test('본문은 snake_case로 나간다', () => {
  const params = parseRememberSearchUrl(REAL_URL)
  expect(buildRememberSearchBody(params, { page: 2, per: 30 })).toEqual({
    search: {
      job_category_names: [{ level1: 'SW개발', level2: '프론트엔드' }],
      addresses: [['서울특별시'], ['경기도']],
      organization_type: 'without_headhunter',
      min_experience: 7,
    },
    page: 2,
    per: 30,
    sort: 'starts_at_desc',
  })
})
