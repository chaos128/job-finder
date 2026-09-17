import { expect, test } from 'vitest'
import type { RememberSearchParams } from '@job-finder/db'
import { createRememberSource } from '../src/index.js'

const PARAMS: RememberSearchParams = {
  source: 'remember',
  jobCategoryNames: [{ level1: 'SW개발', level2: '프론트엔드' }],
  addresses: [['서울특별시']],
  organizationType: 'without_headhunter',
  minExperience: 7,
}

function page(n: number, totalPages: number, ids: number[]) {
  return {
    data: ids.map((id) => ({
      id, title: `t${id}`, organization: { name: 'c', company_id: 1 },
      normalized_address: { level1: '서울', level2: '강남구' },
      addresses: [{ address_level1: '서울특별시', address_level2: '강남구' }],
      ends_at: null,
    })),
    meta: {
      page: n, total_pages: totalPages,
      logger_info: { query_meta_data: { search: {
        job_category_ids: [311], organization_type: 'without_headhunter',
        min_experience: 7, addresses: [['서울특별시']],
      } } },
    },
  }
}

test('total_pages까지 돌면서 모든 공고를 낸다', async () => {
  const pages = [page(1, 2, [1, 2]), page(2, 2, [3])]
  let calls = 0
  const fake: typeof fetch = async () =>
    new Response(JSON.stringify(pages[calls++]!), { status: 200 })

  const source = createRememberSource(fake)
  const ids: string[] = []
  for await (const ref of source.listRefs(PARAMS)) ids.push(ref.externalId)

  expect(ids).toEqual(['1', '2', '3'])
  expect(calls).toBe(2)
})

// 필터가 무시되면 전량(실측 12,894건)이 쏟아진다. 조용히 수집하면 안 된다.
test('서버가 필터를 무시하면 던진다', async () => {
  const broken = page(1, 400, [1])
  broken.meta.logger_info.query_meta_data.search.min_experience = null as never

  const fake: typeof fetch = async () => new Response(JSON.stringify(broken), { status: 200 })
  const source = createRememberSource(fake)

  await expect(async () => {
    for await (const _ of source.listRefs(PARAMS)) { /* 소비만 한다 */ }
  }).rejects.toThrow(/min_experience/)
})

// logger_info 자체가 없으면 "서버가 무시했다"가 아니라 "확인할 방법이 없었다"다 —
// 메시지가 이 둘을 구분하지 못하면 크론 로그를 보는 사람이 엉뚱한 필터 이름을
// 의심하게 된다. 이 경우도 수집은 멈춰야 하지만 이유는 달라야 한다.
test('필터 에코 자체가 없으면 확인 불가로 던진다', async () => {
  const broken = page(1, 400, [1]) as { meta: { logger_info?: unknown } }
  delete broken.meta.logger_info

  const fake: typeof fetch = async () => new Response(JSON.stringify(broken), { status: 200 })
  const source = createRememberSource(fake)

  await expect(async () => {
    for await (const _ of source.listRefs(PARAMS)) { /* 소비만 한다 */ }
  }).rejects.toThrow(/확인할 수 없습니다/)
})

test('상세 URL은 id로 만든다', async () => {
  let seen = ''
  const fake: typeof fetch = async (url) => {
    seen = String(url)
    return new Response(JSON.stringify({ data: { id: 7, status: 'published' } }), { status: 200 })
  }
  await createRememberSource(fake).fetchDetail('7')
  expect(seen).toBe('https://career-api.rememberapp.co.kr/job_postings/7')
})
