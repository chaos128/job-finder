import { MemoryStore, type Job } from '@job-finder/db'
import type { JobSource } from '@job-finder/sources'
import { expect, test } from 'vitest'
import { createRecheckNode } from '../src/index.js'

async function seedJob(store: MemoryStore): Promise<Job> {
  const [job] = await store.insertJobs([{
    source: 'wanted', externalId: '42', position: 'Frontend',
    companyName: 'ACME', companyId: 1,
    addressDistrict: '강남구', addressFull: '서울 강남구',
    url: 'https://www.wanted.co.kr/wd/42', dueTime: null,
  }])
  return job!
}

function source(overrides: Partial<JobSource> = {}): JobSource {
  return {
    id: 'wanted',
    parseSearchUrl: () => { throw new Error('unused') },
    async *listRefs() {},
    async fetchDetail(externalId) { return { externalId, payload: { ok: true } } },
    normalize: () => { throw new Error('unused') },
    parseOpenState: () => ({ closed: false, dueTime: null }),
    ...overrides,
  }
}

test('열린 공고는 닫히지 않은 것으로 기록한다', async () => {
  const store = new MemoryStore()
  const job = await seedJob(store)
  const node = createRecheckNode({ store, sources: { wanted: source() } })
  const result = await node.run(job, { runId: 'run_1' })

  expect(result).toMatchObject({ ok: true })
  expect(store.jobs.get(job.id)!.hidden).toBe(false)
})

test('닫힌 공고는 hidden으로 기록한다', async () => {
  const store = new MemoryStore()
  const job = await seedJob(store)
  const node = createRecheckNode({
    store, sources: { wanted: source({ parseOpenState: () => ({ closed: true, dueTime: null }) }) },
  })
  const result = await node.run(job, { runId: 'run_1' })

  expect(result).toMatchObject({ ok: true })
  expect(store.jobs.get(job.id)!.hidden).toBe(true)
})

test('레지스트리에 없는 소스는 UNKNOWN_SOURCE로 실패한다 (throw하지 않는다)', async () => {
  const store = new MemoryStore()
  const job = await seedJob(store)
  const node = createRecheckNode({ store, sources: {} })
  const result = await node.run(job, { runId: 'run_1' })

  expect(result).toMatchObject({ ok: false, retryable: false, error: { code: 'UNKNOWN_SOURCE' } })
})
