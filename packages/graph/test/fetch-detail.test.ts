import { MemoryStore, type Job } from '@job-finder/db'
import { WantedHttpError, type JobSource } from '@job-finder/sources'
import { expect, test, vi } from 'vitest'
import { createFetchDetailNode } from '../src/index.js'

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
    normalize() {
      return {
        intro: '소개', requirements: 'React 8년',
        mainTasks: '개발', preferredPoints: 'TS', benefits: '복지',
        skillTags: ['React', 'TypeScript'], raw: { ok: true },
      }
    },
    ...overrides,
  }
}

test('JD를 저장하고 채점 대기로 넘긴다', async () => {
  const store = new MemoryStore()
  const job = await seedJob(store)
  const result = await createFetchDetailNode({ store, source: source() })
    .run(job, { runId: 'run_1' })

  expect(result).toMatchObject({ ok: true })
  if (!result.ok) throw new Error('unreachable')
  expect(result.value).toBe(job.id)

  expect(await store.listJobsNeedingDetail(10)).toHaveLength(0)
  const [needScore] = await store.listJobsNeedingScore(10)
  expect(needScore!.requirements).toBe('React 8년')
  expect(needScore!.skillTags).toEqual(['React', 'TypeScript'])
})

test('5xx는 retryable로 보고하고 시도 횟수를 올린다', async () => {
  const store = new MemoryStore()
  const job = await seedJob(store)
  const node = createFetchDetailNode({
    store,
    source: source({ async fetchDetail() { throw new WantedHttpError(500, 'boom') } }),
  })
  const result = await node.run(job, { runId: 'run_1' })

  expect(result).toMatchObject({ ok: false, retryable: true })
  expect(store.jobs.get(job.id)!.detailAttempts).toBe(1)
  expect(await store.listJobsNeedingDetail(10)).toHaveLength(1)
})

test('404는 영구 실패로 보고한다', async () => {
  const store = new MemoryStore()
  const job = await seedJob(store)
  const node = createFetchDetailNode({
    store,
    source: source({ async fetchDetail() { throw new WantedHttpError(404, 'gone') } }),
  })
  const result = await node.run(job, { runId: 'run_1' })
  expect(result).toMatchObject({ ok: false, retryable: false })
})

test('3회 실패하면 대기 목록에서 영구히 빠진다', async () => {
  const store = new MemoryStore()
  const job = await seedJob(store)
  const node = createFetchDetailNode({
    store,
    source: source({ async fetchDetail() { throw new WantedHttpError(500, 'boom') } }),
  })
  for (let i = 0; i < 3; i++) await node.run(job, { runId: `run_${i}` })
  expect(await store.listJobsNeedingDetail(10)).toHaveLength(0)
  expect(store.jobs.get(job.id)!.detailStatus).toBe('failed')
})

test('정규화 실패는 영구 실패다 (재시도해도 같은 응답)', async () => {
  const store = new MemoryStore()
  const job = await seedJob(store)
  const node = createFetchDetailNode({
    store,
    source: source({ normalize() { throw new Error('detail 필드 없음') } }),
  })
  const result = await node.run(job, { runId: 'run_1' })
  expect(result).toMatchObject({ ok: false, retryable: false })
  expect(store.jobs.get(job.id)!.detailAttempts).toBe(1)
})

test('store 실패(saveJobDetail)는 STORE_FAILED / retryable로 분류한다', async () => {
  const store = new MemoryStore()
  const job = await seedJob(store)
  vi.spyOn(store, 'saveJobDetail').mockRejectedValue(new Error('db down'))
  const node = createFetchDetailNode({ store, source: source() })
  const result = await node.run(job, { runId: 'run_1' })

  expect(result).toMatchObject({ ok: false, retryable: true })
  if (result.ok) throw new Error('unreachable')
  expect(result.error.code).toBe('STORE_FAILED')
  expect(store.jobs.get(job.id)!.detailAttempts).toBe(1)
})

test('recordDetailFailure마저 실패해도 원래 실패 사유를 그대로 보고한다', async () => {
  const store = new MemoryStore()
  const job = await seedJob(store)
  vi.spyOn(store, 'recordDetailFailure').mockRejectedValue(new Error('db down harder'))
  const node = createFetchDetailNode({
    store,
    source: source({ async fetchDetail() { throw new WantedHttpError(404, 'gone') } }),
  })

  await expect(node.run(job, { runId: 'run_1' })).resolves.toMatchObject({
    ok: false,
    retryable: false,
    error: { code: 'WANTED_HTTP' },
  })
})
