import { expect, test } from 'vitest'
import { MemoryStore } from '../src/index.js'
import { describeStoreContract } from './store-contract.js'

describeStoreContract('MemoryStore', async () => new MemoryStore())

// 상한 자체는 계약 테스트에 넣지 않았다 — 201건을 실 DB에 넣는 비용이 크다.
// SupabaseStore 쪽은 같은 값을 질의의 .limit()으로 건다.
test('알림 후보는 상위 200건까지만 돌려준다', async () => {
  const store = new MemoryStore()
  const rows = await store.insertJobs(
    Array.from({ length: 201 }, (_, i) => ({
      source: 'wanted' as const, externalId: String(i), position: 'FE',
      companyName: 'ACME', companyId: 1, addressDistrict: null, addressFull: null,
      url: `https://www.wanted.co.kr/wd/${i}`, dueTime: null,
    })),
  )
  for (const [i, row] of rows.entries()) {
    await store.saveJobDetail(row.id, {
      intro: null, requirements: null, mainTasks: null,
      preferredPoints: null, benefits: null, skillTags: [], raw: {},
    })
    await store.saveScore({
      jobId: row.id, total: i, breakdown: {},
      reasoning: '', scorer: 'routine', rubricVersion: 'v1',
    })
  }

  const candidates = await store.listNotifyCandidates()
  expect(candidates).toHaveLength(200)
  expect(candidates[0]!.score.total).toBe(200) // 잘리는 쪽은 항상 하위 점수다
})
