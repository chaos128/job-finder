import { MemoryStore, type Search } from '@job-finder/db'
import { WantedHttpError, type ExternalRef, type JobSource } from '@job-finder/sources'
import { expect, test, vi } from 'vitest'
import { createDiscoverNode, runNode } from '../src/index.js'

const search: Search = {
  id: 'search_1',
  url: 'https://www.wanted.co.kr/wdlist/518/669',
  params: {
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
        intro: null, requirements: null, mainTasks: null,
        preferredPoints: null, benefits: null, skillTags: [], raw: {},
      }
    },
  }
}

test('신규 공고를 저장하고 검색과 연결한다', async () => {
  const store = new MemoryStore()
  const node = createDiscoverNode({ store, source: fakeSource([ref('1'), ref('2')]) })
  const result = await node.run(search, { runId: 'run_1' })

  expect(result).toMatchObject({ ok: true })
  if (!result.ok) throw new Error('unreachable')
  expect(result.value).toEqual({ searchId: 'search_1', found: 2, created: 2 })
  expect(await store.listJobsNeedingDetail(10)).toHaveLength(2)
  expect(store.hits.size).toBe(2)
})

test('두 번 돌려도 중복이 생기지 않는다 (멱등)', async () => {
  const store = new MemoryStore()
  const node = createDiscoverNode({ store, source: fakeSource([ref('1'), ref('2')]) })
  await node.run(search, { runId: 'run_1' })
  const second = await node.run(search, { runId: 'run_2' })

  if (!second.ok) throw new Error('unreachable')
  expect(second.value).toEqual({ searchId: 'search_1', found: 2, created: 0 })
  expect(store.jobs.size).toBe(2)
  expect(store.hits.size).toBe(2)
})

test('이미 있는 공고도 새 검색에는 연결한다', async () => {
  const store = new MemoryStore()
  const source = fakeSource([ref('1')])
  await createDiscoverNode({ store, source }).run(search, { runId: 'run_1' })

  const otherSearch: Search = { ...search, id: 'search_2' }
  const result = await createDiscoverNode({ store, source }).run(otherSearch, { runId: 'run_2' })

  if (!result.ok) throw new Error('unreachable')
  expect(result.value.created).toBe(0)
  expect(store.hits.has(`search_2:${[...store.jobs.keys()][0]}`)).toBe(true)
})

test('Wanted 5xx는 retryable로 보고한다', async () => {
  const store = new MemoryStore()
  const node = createDiscoverNode({
    store,
    source: fakeSource([], () => { throw new WantedHttpError(503, 'boom') }),
  })
  const result = await node.run(search, { runId: 'run_1' })
  expect(result).toMatchObject({ ok: false, retryable: true })
})

test('Wanted 422는 영구 실패로 보고한다', async () => {
  const store = new MemoryStore()
  const node = createDiscoverNode({
    store,
    source: fakeSource([], () => { throw new WantedHttpError(422, 'bad years') }),
  })
  const result = await node.run(search, { runId: 'run_1' })
  expect(result).toMatchObject({ ok: false, retryable: false })
})

test('한 페이징 안의 중복 externalId는 한 번만 저장한다', async () => {
  const store = new MemoryStore()
  const node = createDiscoverNode({ store, source: fakeSource([ref('1'), ref('1')]) })
  const result = await node.run(search, { runId: 'run_1' })

  if (!result.ok) throw new Error('unreachable')
  expect(result.value).toEqual({ searchId: 'search_1', found: 2, created: 1 })
  expect(store.jobs.size).toBe(1)
})

test('공고가 없는 검색도 크래시 없이 빈 결과를 낸다', async () => {
  const store = new MemoryStore()
  const node = createDiscoverNode({ store, source: fakeSource([]) })
  const result = await node.run(search, { runId: 'run_1' })

  if (!result.ok) throw new Error('unreachable')
  expect(result.value).toEqual({ searchId: 'search_1', found: 0, created: 0 })
  expect(store.jobs.size).toBe(0)
  expect(store.hits.size).toBe(0)
})

test('store 실패는 STORE_FAILED / retryable로 분류한다', async () => {
  const store = new MemoryStore()
  vi.spyOn(store, 'insertJobs').mockRejectedValue(new Error('db down'))
  const node = createDiscoverNode({ store, source: fakeSource([ref('1')]) })
  const result = await node.run(search, { runId: 'run_1' })

  expect(result).toMatchObject({ ok: false, retryable: true })
  if (result.ok) throw new Error('unreachable')
  expect(result.error.code).toBe('STORE_FAILED')
})

test('runner를 통해 여러 검색을 처리한다', async () => {
  const store = new MemoryStore()
  const runId = await store.startRun('cron')
  const node = createDiscoverNode({ store, source: fakeSource([ref('1')]) })
  const summary = await runNode(
    node,
    [search, { ...search, id: 'search_2' }],
    (s) => s.id,
    { runId, store },
  )
  expect(summary.failed).toHaveLength(0)
  expect(store.jobs.size).toBe(1)
})
