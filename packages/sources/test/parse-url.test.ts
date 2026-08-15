import { expect, test } from 'vitest'
import { buildWantedListUrl, MAX_YEARS, parseWantedSearchUrl } from '../src/index.js'

const REAL_URL =
  'https://www.wanted.co.kr/wdlist/518/669?country=kr&job_sort=job.latest_order' +
  '&years=8&years=20' +
  '&locations=seoul.gangnam-gu&locations=seoul.gangdong-gu&locations=gyeonggi.seongnam-si'

test('경로에서 직군/직무 id를 뽑는다', () => {
  const params = parseWantedSearchUrl(REAL_URL)
  expect(params.jobGroupId).toBe('518')
  expect(params.tagTypeIds).toEqual(['669'])
})

test('years 상한을 10으로 클램프한다', () => {
  const params = parseWantedSearchUrl(REAL_URL)
  expect(params.yearsFrom).toBe(8)
  expect(params.yearsTo).toBe(MAX_YEARS)
})

test('locations를 모두 보존한다', () => {
  const params = parseWantedSearchUrl(REAL_URL)
  expect(params.locations).toEqual([
    'seoul.gangnam-gu', 'seoul.gangdong-gu', 'gyeonggi.seongnam-si',
  ])
})

test('country와 정렬 기본값을 채운다', () => {
  const params = parseWantedSearchUrl('https://www.wanted.co.kr/wdlist/518/669')
  expect(params.country).toBe('kr')
  expect(params.sort).toBe('job.latest_order')
  expect(params.yearsFrom).toBe(0)
  expect(params.yearsTo).toBe(MAX_YEARS)
})

test('yearsFrom이 yearsTo보다 크면 뒤집는다', () => {
  const params = parseWantedSearchUrl('https://www.wanted.co.kr/wdlist/518/669?years=10&years=3')
  expect(params.yearsFrom).toBe(3)
  expect(params.yearsTo).toBe(10)
})

test('wdlist 경로가 아니면 거부한다', () => {
  expect(() => parseWantedSearchUrl('https://www.wanted.co.kr/jobs')).toThrow(/wdlist/)
})

test('API URL을 만든다 — years는 반복 파라미터', () => {
  const params = parseWantedSearchUrl(REAL_URL)
  const url = new URL(buildWantedListUrl(params, { limit: 100, offset: 0 }))
  expect(url.pathname).toBe('/api/v4/jobs')
  expect(url.searchParams.getAll('years')).toEqual(['8', '10'])
  expect(url.searchParams.getAll('tag_type_ids')).toEqual(['669'])
  expect(url.searchParams.getAll('locations')).toHaveLength(3)
  expect(url.searchParams.get('limit')).toBe('100')
  expect(url.searchParams.get('offset')).toBe('0')
})
