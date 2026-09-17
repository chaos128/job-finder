import { expect, test } from 'vitest'
import listFixture from './fixtures/remember-list.json' with { type: 'json' }
import detailFixture from './fixtures/remember-detail.json' with { type: 'json' }
import {
  normalizeRememberDetail, parseRememberListPage, parseRememberOpenState,
} from '../src/index.js'

test('목록에서 공고 참조를 뽑는다', () => {
  const { refs, page, totalPages } = parseRememberListPage(listFixture)
  expect(refs.length).toBeGreaterThan(0)
  expect(page).toBe(1)
  expect(totalPages).toBeGreaterThan(1)

  const first = refs[0]!
  const raw = (listFixture as any).data[0]
  expect(first.externalId).toBe(String(raw.id))
  expect(first.job.position).toBe(raw.title)
  expect(first.job.companyName).toBe(raw.organization.name)
  expect(first.job.companyId).toBe(raw.organization.company_id)
  expect(first.job.url).toBe(`https://career.rememberapp.co.kr/job/postings/${raw.id}`)
})

// 이 검사가 이 소스의 안전장치다. 서버가 해석한 필터가 메타로 그대로 돌아오는데,
// 우리가 보낸 값이 null로 돌아왔다면 이름이 틀려 필터가 통째로 무시된 것이다.
test('서버가 무시한 필터를 찾아낸다', () => {
  const ignored = parseRememberListPage({
    data: [],
    meta: {
      page: 1, total_pages: 1,
      logger_info: { query_meta_data: { search: {
        job_category_ids: [], organization_type: null, min_experience: null, addresses: null,
      } } },
    },
  }).ignoredFilters
  expect(ignored).toContain('organization_type')
  expect(ignored).toContain('min_experience')
})

test('정상 응답에서는 무시된 필터가 없다', () => {
  expect(parseRememberListPage(listFixture).ignoredFilters).toEqual([])
})

test('상세를 채점 입력 필드로 옮긴다', () => {
  const raw = { externalId: '1', payload: detailFixture }
  const fields = normalizeRememberDetail(raw)
  const j = (detailFixture as any).data
  expect(fields.mainTasks).toBe(j.job_description)
  expect(fields.requirements).toBe(j.qualifications)
  expect(fields.intro).toBe(j.introduction)
  expect(fields.preferredPoints).toBe(j.preferred_qualifications)
  expect(fields.benefits).toBe(j.additional_information)
  // Remember에는 기술 태그가 없다. job_categories는 직무 분류지 스택이 아니라
  // 채점 프롬프트에 넣지 않는다.
  expect(fields.skillTags).toEqual([])
  expect(fields.raw).toBe(detailFixture)
})

// 상한 없음을 null이 아니라 100으로 저장한다 — formatExperience의 "N년 이상"
// 분기가 그 센티널을 쓰기 때문이다. null로 두면 화면에 경력이 안 나온다.
test('경력 상한 없음은 100으로 맞춘다', () => {
  const fields = normalizeRememberDetail({
    externalId: '1',
    payload: { data: { id: 1, status: 'published', min_experience: 7, max_experience: null } },
  })
  expect(fields.annualFrom).toBe(7)
  expect(fields.annualTo).toBe(100)
})

test('경력 하한 없음은 0(신입 포함)으로 맞춘다', () => {
  const fields = normalizeRememberDetail({
    externalId: '1',
    payload: { data: { id: 1, status: 'published', min_experience: null, max_experience: 5 } },
  })
  expect(fields.annualFrom).toBe(0)
  expect(fields.annualTo).toBe(5)
})

// Wanted는 'close', Remember는 'closed'다.
test.each([
  ['published', false],
  ['closed', true],
  ['draft', false],      // 모르는 값은 열린 것으로 둔다
])('status %s의 closed는 %s다', (status, closed) => {
  const state = parseRememberOpenState({
    externalId: '1', payload: { data: { id: 1, status, ends_at: null } },
  })
  expect(state.closed).toBe(closed)
})

test('마감일은 date 컬럼에 맞게 앞 10자만 남긴다', () => {
  const state = parseRememberOpenState({
    externalId: '1',
    payload: { data: { id: 1, status: 'published', ends_at: '2024-11-19T23:59:59.000+09:00' } },
  })
  expect(state.dueTime).toBe('2024-11-19')
})
