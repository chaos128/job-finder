import { MemoryStore } from '@job-finder/db'
import type { ExternalRef, JobSource } from '@job-finder/sources'
import { expect, test, vi } from 'vitest'
import { runCollect } from '../src/index.js'

const params = {
  jobGroupId: '518', tagTypeIds: ['669'], locations: [],
  yearsFrom: 8, yearsTo: 10, country: 'kr', sort: 'job.latest_order',
}

function ref(externalId: string): ExternalRef {
  return {
    externalId,
    job: {
      externalId, position: `Frontend ${externalId}`, companyName: 'ACME',
      companyId: 1, addressDistrict: '강남구', addressFull: '서울 강남구',
      url: `https://www.wanted.co.kr/wd/${externalId}`, dueTime: null,
    },
  }
}

function source(refs: ExternalRef[]): JobSource {
  return {
    id: 'wanted',
    parseSearchUrl: () => params,
    async *listRefs() { for (const r of refs) yield r },
    async fetchDetail(externalId) { return { externalId, payload: {} } },
    normalize() {
      return {
        intro: null, requirements: 'React', mainTasks: null,
        preferredPoints: null, benefits: null, skillTags: ['React'], raw: {},
      }
    },
  }
}

async function storeWithSearch() {
  const store = new MemoryStore()
  store.searches.push({
    id: 'search_1', url: 'https://www.wanted.co.kr/wdlist/518/669', params, enabled: true,
  })
  return store
}

test('검색부터 상세까지 한 번에 처리한다', async () => {
  const store = await storeWithSearch()
  const report = await runCollect({ store, source: source([ref('1'), ref('2')]) }, 'cron')

  expect(report).toMatchObject({ searches: 1, found: 2, created: 2, detailed: 2 })
  expect(report.failed).toHaveLength(0)
  expect(await store.listJobsNeedingScore(10)).toHaveLength(2)
})

test('두 번 돌려도 새로 생기는 것이 없다 (멱등)', async () => {
  const store = await storeWithSearch()
  const src = source([ref('1'), ref('2')])
  await runCollect({ store, source: src }, 'cron')
  const second = await runCollect({ store, source: src }, 'cron')

  expect(second).toMatchObject({ created: 0, detailed: 0 })
  expect(store.jobs.size).toBe(2)
})

test('비활성 검색은 건너뛴다', async () => {
  const store = await storeWithSearch()
  store.searches[0]!.enabled = false
  const report = await runCollect({ store, source: source([ref('1')]) }, 'cron')
  expect(report).toMatchObject({ searches: 0, found: 0, created: 0 })
})

test('run을 열고 닫으며 node_runs를 남긴다', async () => {
  const store = await storeWithSearch()
  const report = await runCollect({ store, source: source([ref('1')]) }, 'manual')
  expect(report.runId).toMatch(/^run_/)
  expect(store.nodeRuns.map((n) => n.node)).toEqual(['discover', 'fetchDetail'])
})

test('검색 실패와 상세 실패가 각각 origin이 태그된 채로 failed에 합쳐진다', async () => {
  const store = new MemoryStore()
  const badParams = { ...params, jobGroupId: '999' }
  store.searches.push(
    { id: 'search_good', url: 'https://www.wanted.co.kr/wdlist/518/669', params, enabled: true },
    { id: 'search_bad', url: 'https://www.wanted.co.kr/wdlist/999/669', params: badParams, enabled: true },
  )

  const src: JobSource = {
    id: 'wanted',
    parseSearchUrl: () => params,
    async *listRefs(searchParams) {
      if (searchParams.jobGroupId === '999') throw new Error('search boom')
      yield ref('1')
      yield ref('2')
    },
    async fetchDetail(externalId) {
      if (externalId === '1') throw new Error('detail boom')
      return { externalId, payload: {} }
    },
    normalize() {
      return {
        intro: null, requirements: 'React', mainTasks: null,
        preferredPoints: null, benefits: null, skillTags: ['React'], raw: {},
      }
    },
  }

  const report = await runCollect({ store, source: src }, 'cron')

  // 실패한 검색 옆의 정상 검색은 그대로 상세 단계까지 도달한다 (job '2'는 성공)
  expect(report.detailed).toBe(1)
  expect(report.failed).toHaveLength(2)

  const discoverFailure = report.failed.find((f) => f.node === 'discover')
  expect(discoverFailure).toMatchObject({ itemId: 'search_bad', node: 'discover' })

  const jobForExt1 = [...store.jobs.values()].find((j) => j.externalId === '1')
  const detailFailure = report.failed.find((f) => f.node === 'fetchDetail')
  expect(detailFailure).toMatchObject({ itemId: jobForExt1?.id, node: 'fetchDetail' })
  expect(detailFailure?.message).toContain('detail boom')
})

test('본문에서 에러가 나도 endRun은 호출된다', async () => {
  const store = await storeWithSearch()
  const endRunSpy = vi.spyOn(store, 'endRun')
  vi.spyOn(store, 'listEnabledSearches').mockRejectedValue(new Error('boom'))

  await expect(runCollect({ store, source: source([]) }, 'cron')).rejects.toThrow('boom')
  expect(endRunSpy).toHaveBeenCalledTimes(1)
})

test('detailLimit을 넘는 건은 다음 실행에서 처리되고, hitDetailLimit이 이를 알린다', async () => {
  const store = await storeWithSearch()
  const src = source([ref('1'), ref('2'), ref('3')])

  const first = await runCollect({ store, source: src }, 'cron', { detailLimit: 1 })
  expect(first).toMatchObject({ created: 3, detailed: 1, hitDetailLimit: true })

  const second = await runCollect({ store, source: src }, 'cron', { detailLimit: 1 })
  expect(second).toMatchObject({ created: 0, detailed: 1, hitDetailLimit: true })

  const okCount = [...store.jobs.values()].filter((j) => j.detailStatus === 'ok').length
  expect(okCount).toBe(2)
  expect([...store.jobs.values()].some((j) => j.detailStatus === 'pending')).toBe(true)
})
