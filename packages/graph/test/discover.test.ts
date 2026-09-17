import { MemoryStore, type Search } from '@job-finder/db'
import { WantedHttpError, type ExternalRef, type JobSource } from '@job-finder/sources'
import { expect, test, vi } from 'vitest'
import { createDiscoverNode, runNode } from '../src/index.js'

const search: Search = {
  id: 'search_1',
  source: 'wanted',
  url: 'https://www.wanted.co.kr/wdlist/518/669',
  params: {
    source: 'wanted',
    jobGroupId: '518', tagTypeIds: ['669'], locations: [],
    yearsFrom: 8, yearsTo: 10, country: 'kr', sort: 'job.latest_order',
  },
  enabled: true,
}

function ref(externalId: string): ExternalRef {
  return {
    externalId,
    job: {
      externalId,
      position: `Frontend ${externalId}`,
      companyName: 'ACME',
      companyId: 1,
      addressDistrict: '강남구',
      addressFull: '서울 강남구',
      url: `https://www.wanted.co.kr/wd/${externalId}`,
      dueTime: null,
    },
  }
}

function fakeSource(refs: ExternalRef[], onList?: () => never): JobSource {
  return {
    id: 'wanted',
    parseSearchUrl: () => search.params,
    async *listRefs() {
      if (onList) onList()
      for (const r of refs) yield r
    },
    async fetchDetail(externalId) { return { externalId, payload: {} } },
    normalize() {
      return {
        annualFrom: 5, annualTo: 100,
        intro: null, requirements: null, mainTasks: null,
        preferredPoints: null, benefits: null, skillTags: [], raw: {},
      }
    },
    parseOpenState: () => ({ closed: false, dueTime: null }),
  }
}

test('신규 공고를 저장하고 검색과 연결한다', async () => {
  const store = new MemoryStore()
  const node = createDiscoverNode({ store, sources: { wanted: fakeSource([ref('1'), ref('2')]) } })
  const result = await node.run(search, { runId: 'run_1' })

  expect(result).toMatchObject({ ok: true })
  if (!result.ok) throw new Error('unreachable')
  expect(result.value).toEqual({ searchId: 'search_1', found: 2, created: 2, duplicates: 0 })
  expect(await store.listJobsNeedingDetail(10)).toHaveLength(2)
  expect(store.hits.size).toBe(2)
})

test('두 번 돌려도 중복이 생기지 않는다 (멱등)', async () => {
  const store = new MemoryStore()
  const node = createDiscoverNode({ store, sources: { wanted: fakeSource([ref('1'), ref('2')]) } })
  await node.run(search, { runId: 'run_1' })
  const second = await node.run(search, { runId: 'run_2' })

  if (!second.ok) throw new Error('unreachable')
  expect(second.value).toEqual({ searchId: 'search_1', found: 2, created: 0, duplicates: 0 })
  expect(store.jobs.size).toBe(2)
  expect(store.hits.size).toBe(2)
})

test('이미 있는 공고도 새 검색에는 연결한다', async () => {
  const store = new MemoryStore()
  const source = fakeSource([ref('1')])
  await createDiscoverNode({ store, sources: { wanted: source } }).run(search, { runId: 'run_1' })

  const otherSearch: Search = { ...search, id: 'search_2' }
  const result = await createDiscoverNode({ store, sources: { wanted: source } }).run(otherSearch, { runId: 'run_2' })

  if (!result.ok) throw new Error('unreachable')
  expect(result.value.created).toBe(0)
  expect(store.hits.has(`search_2:${[...store.jobs.keys()][0]}`)).toBe(true)
})

test('Wanted 5xx는 retryable로 보고한다', async () => {
  const store = new MemoryStore()
  const node = createDiscoverNode({
    store,
    sources: { wanted: fakeSource([], () => { throw new WantedHttpError(503, 'boom') }) },
  })
  const result = await node.run(search, { runId: 'run_1' })
  expect(result).toMatchObject({ ok: false, retryable: true })
})

test('Wanted 422는 영구 실패로 보고한다', async () => {
  const store = new MemoryStore()
  const node = createDiscoverNode({
    store,
    sources: { wanted: fakeSource([], () => { throw new WantedHttpError(422, 'bad years') }) },
  })
  const result = await node.run(search, { runId: 'run_1' })
  expect(result).toMatchObject({ ok: false, retryable: false })
})

test('한 페이징 안의 중복 externalId는 한 번만 저장한다', async () => {
  const store = new MemoryStore()
  const node = createDiscoverNode({ store, sources: { wanted: fakeSource([ref('1'), ref('1')]) } })
  const result = await node.run(search, { runId: 'run_1' })

  if (!result.ok) throw new Error('unreachable')
  expect(result.value).toEqual({ searchId: 'search_1', found: 2, created: 1, duplicates: 0 })
  expect(store.jobs.size).toBe(1)
})

test('공고가 없는 검색도 크래시 없이 빈 결과를 낸다', async () => {
  const store = new MemoryStore()
  const node = createDiscoverNode({ store, sources: { wanted: fakeSource([]) } })
  const result = await node.run(search, { runId: 'run_1' })

  if (!result.ok) throw new Error('unreachable')
  expect(result.value).toEqual({ searchId: 'search_1', found: 0, created: 0, duplicates: 0 })
  expect(store.jobs.size).toBe(0)
  expect(store.hits.size).toBe(0)
})

test('store 실패는 STORE_FAILED / retryable로 분류한다', async () => {
  const store = new MemoryStore()
  vi.spyOn(store, 'insertJobs').mockRejectedValue(new Error('db down'))
  const node = createDiscoverNode({ store, sources: { wanted: fakeSource([ref('1')]) } })
  const result = await node.run(search, { runId: 'run_1' })

  expect(result).toMatchObject({ ok: false, retryable: true })
  if (result.ok) throw new Error('unreachable')
  expect(result.error.code).toBe('STORE_FAILED')
})

const rememberParams = {
  source: 'remember' as const,
  jobCategoryNames: [], addresses: [], organizationType: null, minExperience: null,
}

test('레지스트리에 없는 소스는 UNKNOWN_SOURCE로 실패한다 (throw하지 않는다)', async () => {
  const store = new MemoryStore()
  const rememberSearch: Search = {
    id: 'search_2', source: 'remember', url: 'https://www.remember.co.kr/list', params: rememberParams, enabled: true,
  }
  const node = createDiscoverNode({ store, sources: { wanted: fakeSource([ref('1')]) } })
  const result = await node.run(rememberSearch, { runId: 'run_1' })

  expect(result).toMatchObject({ ok: false, retryable: false, error: { code: 'UNKNOWN_SOURCE' } })
})

test('search.source와 search.params.source가 어긋나면 SOURCE_MISMATCH로 실패한다', async () => {
  const store = new MemoryStore()
  const mismatched: Search = { ...search, params: rememberParams }
  const node = createDiscoverNode({ store, sources: { wanted: fakeSource([ref('1')]) } })
  const result = await node.run(mismatched, { runId: 'run_1' })

  expect(result).toMatchObject({ ok: false, retryable: false, error: { code: 'SOURCE_MISMATCH' } })
})

test('search.params가 null이어도 throw하지 않고 SOURCE_MISMATCH로 실패한다', async () => {
  // params는 DB에서 not null이지만 'null'::jsonb(=JS null)까지는 막지 못하고,
  // 검색 행은 사람이 SQL Editor로 손수 넣는다 — 그 경우를 흉내낸다.
  const store = new MemoryStore()
  const nullParams: Search = { ...search, params: null as unknown as Search['params'] }
  const node = createDiscoverNode({ store, sources: { wanted: fakeSource([ref('1')]) } })
  const result = await node.run(nullParams, { runId: 'run_1' })

  expect(result).toMatchObject({ ok: false, retryable: false, error: { code: 'SOURCE_MISMATCH' } })
})

test('runner를 통해 여러 검색을 처리한다', async () => {
  const store = new MemoryStore()
  const runId = await store.startRun('collect', 'cron')
  const node = createDiscoverNode({ store, sources: { wanted: fakeSource([ref('1')]) } })
  const summary = await runNode(
    node,
    [search, { ...search, id: 'search_2' }],
    (s) => s.id,
    { runId, store },
  )
  expect(summary.failed).toHaveLength(0)
  expect(store.jobs.size).toBe(1)
})

// listDedupIndex를 insertJobs **뒤에** 읽으면 이 배치에서 방금 만든 행끼리
// 서로를 중복으로 지목한다 — 인덱스를 insert 전에 읽어야 하는 이유를 검증한다.
test('같은 배치 안의 새 행끼리는 중복으로 지목하지 않는다', async () => {
  const store = new MemoryStore()
  const refs: ExternalRef[] = ['1', '2'].map((id) => ({
    externalId: id,
    job: {
      externalId: id, position: 'Senior Frontend Engineer', companyName: '루닛',
      companyId: 1, addressDistrict: '강남구', addressFull: '서울 강남구',
      url: `https://www.wanted.co.kr/wd/${id}`, dueTime: null,
    },
  }))
  const node = createDiscoverNode({ store, sources: { wanted: fakeSource(refs) } })
  const result = await node.run(search, { runId: 'run_1' })

  if (!result.ok) throw new Error('unreachable')
  expect(result.value.duplicates).toBe(0)
  expect(store.jobs.size).toBe(2)
})
