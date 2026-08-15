import { expect, test } from 'vitest'
import listFixture from './fixtures/wanted-list.json' with { type: 'json' }
import detailFixture from './fixtures/wanted-detail.json' with { type: 'json' }
import { normalizeWantedDetail, parseListPage } from '../src/index.js'

test('목록 응답에서 ref를 뽑는다', () => {
  const { refs } = parseListPage(listFixture)
  expect(refs.length).toBeGreaterThan(0)
  const first = refs[0]!
  expect(first.externalId).toMatch(/^\d+$/)
  expect(first.job.position).toBeTruthy()
  expect(first.job.companyName).toBeTruthy()
  expect(first.job.url).toBe(`https://www.wanted.co.kr/wd/${first.externalId}`)
})

test('목록 응답에서 다음 페이지 경로를 뽑는다', () => {
  const { nextPath } = parseListPage(listFixture)
  expect(nextPath).toMatch(/^\/api\/v4\/jobs\?/)
})

test('마지막 페이지면 nextPath는 null', () => {
  const { nextPath } = parseListPage({ data: [], links: { next: null } })
  expect(nextPath).toBeNull()
})

test('상세 응답에서 JD 5개 필드와 스킬 태그를 정규화한다', () => {
  const externalId = String(detailFixture.job.id)
  const fields = normalizeWantedDetail({ externalId, payload: detailFixture })
  expect(fields.requirements).toBeTruthy()
  expect(fields.mainTasks).toBeTruthy()
  expect(Array.isArray(fields.skillTags)).toBe(true)
  expect(fields.raw).toBe(detailFixture)
})

test('detail 필드가 비어 있어도 null로 견딘다', () => {
  const fields = normalizeWantedDetail({
    externalId: '1',
    payload: { job: { id: 1, detail: {}, skill_tags: [] } },
  })
  expect(fields.requirements).toBeNull()
  expect(fields.skillTags).toEqual([])
})

test('모양이 다른 응답은 던진다', () => {
  // payload에 job 자체가 없으므로 zod 에러 경로는 최상위 필드인 "job"을 가리킨다.
  expect(() => normalizeWantedDetail({ externalId: '1', payload: { nope: true } }))
    .toThrow(/job/)
})

test('due_time이 YYYY-MM-DD 형식이면 그대로 통과한다', () => {
  const { refs } = parseListPage({
    data: [
      {
        id: 1,
        position: 'p',
        company: { id: 1, name: 'c' },
        address: null,
        due_time: '2026-09-30',
      },
    ],
    links: { next: null },
  })
  expect(refs[0]!.job.dueTime).toBe('2026-09-30')
})

test('due_time이 날짜 형식이 아니면 null로 정규화한다', () => {
  const { refs } = parseListPage({
    data: [
      {
        id: 1,
        position: 'p',
        company: { id: 1, name: 'c' },
        address: null,
        due_time: '상시채용',
      },
    ],
    links: { next: null },
  })
  expect(refs[0]!.job.dueTime).toBeNull()
})
