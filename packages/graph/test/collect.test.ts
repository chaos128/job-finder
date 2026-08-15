import { MemoryStore } from '@job-finder/db'
import type { ExternalRef, JobSource } from '@job-finder/sources'
import { expect, test } from 'vitest'
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
