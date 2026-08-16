import { beforeEach, describe, expect, test } from 'vitest'
import type { DashboardCursor, DashboardPage, NewJob, Store } from '../src/index.js'

const job = (externalId: string): NewJob => ({
  source: 'wanted',
  externalId,
  position: `Position ${externalId}`,
  companyName: 'ACME',
  companyId: 1,
  addressDistrict: '강남구',
  addressFull: '서울 강남구',
  url: `https://www.wanted.co.kr/wd/${externalId}`,
  dueTime: null,
})

const seedScored = async (store: Store, specs: { ext: string; total: number }[]) => {
  const created = await store.insertJobs(specs.map((s) => job(s.ext)))
  for (const [i, spec] of specs.entries()) {
    await store.saveScore({
      jobId: created[i]!.id, total: spec.total,
      breakdown: { stack: spec.total, role: 0, domain: 0, growth: 0, conditions: 0 },
      reasoning: `r${spec.ext}`, scorer: 'routine', rubricVersion: 'v3',
    })
  }
  return created
}

export function describeStoreContract(
  name: string,
  makeStore: () => Promise<Store>,
  seedSearchId?: (store: Store) => Promise<string>,
) {
  describe(`Store contract: ${name}`, () => {
    let store: Store
    beforeEach(async () => { store = await makeStore() })

    test('insertJobs는 신규만 넣고 중복은 건너뛴다', async () => {
      const first = await store.insertJobs([job('1'), job('2')])
      expect(first).toHaveLength(2)
      const second = await store.insertJobs([job('2'), job('3')])
      expect(second.map((j) => j.externalId)).toEqual(['3'])
    })

    test('findJobIdsByExternalIds는 아는 공고만 id와 함께 돌려준다', async () => {
      const [created] = await store.insertJobs([job('1')])
      const known = await store.findJobIdsByExternalIds('wanted', ['1', '9'])
      expect([...known.keys()]).toEqual(['1'])
      expect(known.get('1')).toBe(created!.id)
    })

    test('새 job은 detail 대기 목록에 들어간다', async () => {
      await store.insertJobs([job('1')])
      const pending = await store.listJobsNeedingDetail(10)
      expect(pending.map((j) => j.externalId)).toEqual(['1'])
    })

    test('detail 저장 후에는 대기 목록에서 빠지고 채점 대기로 넘어간다', async () => {
      const [inserted] = await store.insertJobs([job('1')])
      await store.saveJobDetail(inserted!.id, {
        intro: null, requirements: 'React', mainTasks: null,
        preferredPoints: null, benefits: null, skillTags: ['React'], raw: {},
      })
      expect(await store.listJobsNeedingDetail(10)).toHaveLength(0)
      expect(await store.listJobsNeedingScore(10)).toHaveLength(1)
    })

    test('detail 3회 실패하면 대기 목록에서 영구히 빠진다', async () => {
      const [inserted] = await store.insertJobs([job('1')])
      for (let i = 0; i < 3; i++) {
        await store.recordDetailFailure(inserted!.id, 'boom')
      }
      expect(await store.listJobsNeedingDetail(10)).toHaveLength(0)
    })

    // 겹쳐 도는 실행(cron + 수동 /api/run)이 같은 job 집합을 받아, 한쪽이 상세를
    // 저장한 뒤 다른 쪽이 실패를 기록하는 순서가 실제로 가능하다.
    test('상세가 저장된 뒤 도착한 실패는 job을 다시 대기 상태로 되돌리지 못한다', async () => {
      const [inserted] = await store.insertJobs([job('1')])
      await store.saveJobDetail(inserted!.id, {
        intro: null, requirements: 'React', mainTasks: null,
        preferredPoints: null, benefits: null, skillTags: ['React'], raw: {},
      })
      await store.recordDetailFailure(inserted!.id, '뒤늦게 도착한 5xx')
      expect(await store.listJobsNeedingDetail(10)).toHaveLength(0)
      expect(await store.listJobsNeedingScore(10)).toHaveLength(1)
    })

    test('채점된 job은 채점 대기에서 빠지고 알림 후보가 된다', async () => {
      const [inserted] = await store.insertJobs([job('1')])
      await store.saveJobDetail(inserted!.id, {
        intro: null, requirements: null, mainTasks: null,
        preferredPoints: null, benefits: null, skillTags: [], raw: {},
      })
      await store.saveScore({
        jobId: inserted!.id, total: 80, breakdown: { stack: 20 },
        reasoning: '적합', scorer: 'routine', rubricVersion: 'v1',
      })
      expect(await store.listJobsNeedingScore(10)).toHaveLength(0)
      const candidates = await store.listNotifyCandidates()
      expect(candidates.map((c) => c.score.total)).toEqual([80])
    })

    // 후보 목록에 상한을 두어도 다이제스트 결과가 같으려면 정렬이 보장돼야 한다.
    test('알림 후보는 점수 내림차순으로 돌아온다', async () => {
      const inserted = await store.insertJobs([job('1'), job('2'), job('3')])
      for (const [i, total] of [70, 90, 80].entries()) {
        await store.saveJobDetail(inserted[i]!.id, {
          intro: null, requirements: null, mainTasks: null,
          preferredPoints: null, benefits: null, skillTags: [], raw: {},
        })
        await store.saveScore({
          jobId: inserted[i]!.id, total, breakdown: {},
          reasoning: '', scorer: 'routine', rubricVersion: 'v1',
        })
      }
      const candidates = await store.listNotifyCandidates()
      expect(candidates.map((c) => c.score.total)).toEqual([90, 80, 70])
    })

    test('발송 표시된 job은 알림 후보에서 빠진다', async () => {
      const [inserted] = await store.insertJobs([job('1')])
      await store.saveJobDetail(inserted!.id, {
        intro: null, requirements: null, mainTasks: null,
        preferredPoints: null, benefits: null, skillTags: [], raw: {},
      })
      await store.saveScore({
        jobId: inserted!.id, total: 80, breakdown: {},
        reasoning: '', scorer: 'routine', rubricVersion: 'v1',
      })
      const n = await store.createNotification([inserted!.id])
      await store.markNotificationSent(n.id)
      expect(await store.listNotifyCandidates()).toHaveLength(0)
      expect(await store.listPendingNotifications()).toHaveLength(0)
    })

    test('발송 실패한 알림은 pending으로 남아 재시도 대상이 된다', async () => {
      const [inserted] = await store.insertJobs([job('1')])
      const n = await store.createNotification([inserted!.id])
      await store.markNotificationFailed(n.id, 'smtp down')
      const pending = await store.listPendingNotifications()
      expect(pending.map((p) => p.id)).toEqual([n.id])
    })

    test('알림 발송이 3회 실패하면 재시도 대상에서 영구히 빠진다', async () => {
      const [inserted] = await store.insertJobs([job('1')])
      const n = await store.createNotification([inserted!.id])
      for (let i = 0; i < 3; i++) {
        await store.markNotificationFailed(n.id, 'Resend 422')
      }
      // 상한에 닿은 알림이 pending으로 남으면 새 다이제스트가 영원히 막힌다.
      expect(await store.listPendingNotifications()).toHaveLength(0)
    })

    test('재채점해도 이미 발송된 job의 notifiedAt은 보존된다', async () => {
      const [inserted] = await store.insertJobs([job('1')])
      await store.saveJobDetail(inserted!.id, {
        intro: null, requirements: null, mainTasks: null,
        preferredPoints: null, benefits: null, skillTags: [], raw: {},
      })
      await store.saveScore({
        jobId: inserted!.id, total: 80, breakdown: {},
        reasoning: '', scorer: 'routine', rubricVersion: 'v1',
      })
      const n = await store.createNotification([inserted!.id])
      await store.markNotificationSent(n.id)
      await store.saveScore({
        jobId: inserted!.id, total: 90, breakdown: {},
        reasoning: '재채점', scorer: 'routine', rubricVersion: 'v1',
      })
      expect(await store.listNotifyCandidates()).toHaveLength(0)
    })

    test('채점 실패 후 3회 미만이면 채점 대기로 돌아오고, 3회 실패하면 영구히 빠진다', async () => {
      const [inserted] = await store.insertJobs([job('1')])
      await store.saveJobDetail(inserted!.id, {
        intro: null, requirements: null, mainTasks: null,
        preferredPoints: null, benefits: null, skillTags: [], raw: {},
      })
      await store.recordScoreFailure(inserted!.id, 'timeout')
      expect(await store.listJobsNeedingScore(10)).toHaveLength(1)
      await store.recordScoreFailure(inserted!.id, 'timeout')
      await store.recordScoreFailure(inserted!.id, 'timeout')
      expect(await store.listJobsNeedingScore(10)).toHaveLength(0)
    })

    test('linkSearchHits는 같은 (searchId, jobId) 조합을 여러 번 호출해도 에러 없이 무시한다', async () => {
      const [inserted] = await store.insertJobs([job('1')])
      const searchId = seedSearchId ? await seedSearchId(store) : 'search-1'
      await store.linkSearchHits(searchId, [inserted!.id])
      await expect(store.linkSearchHits(searchId, [inserted!.id])).resolves.toBeUndefined()
    })

    test('listDashboardJobs는 점수 내림차순으로 자르고 커서를 준다', async () => {
      await seedScored(store, [
        { ext: '1', total: 90 }, { ext: '2', total: 70 }, { ext: '3', total: 80 },
      ])
      const page = await store.listDashboardJobs({ limit: 2 })
      expect(page.rows.map((r) => r.total)).toEqual([90, 80])
      expect(page.nextCursor).toEqual({ total: 80, jobId: page.rows[1]!.jobId })
    })

    // 동점이 페이지 경계에 걸리면 total 단독 커서는 행을 건너뛰거나 중복시킨다.
    test('동점 경계를 넘어가도 누락도 중복도 없다', async () => {
      await seedScored(store, [
        { ext: '1', total: 74 }, { ext: '2', total: 74 }, { ext: '3', total: 74 },
        { ext: '4', total: 74 }, { ext: '5', total: 60 },
      ])
      const seen: string[] = []
      let cursor: DashboardCursor | undefined
      for (let guard = 0; guard < 10; guard++) {
        const page: DashboardPage = await store.listDashboardJobs({ limit: 2, cursor })
        seen.push(...page.rows.map((r) => r.jobId))
        if (!page.nextCursor) break
        cursor = page.nextCursor
      }
      expect(seen).toHaveLength(5)
      expect(new Set(seen).size).toBe(5)
    })

    test('필터는 최소 점수·북마크·미발송을 각각 좁힌다', async () => {
      const created = await seedScored(store, [
        { ext: '1', total: 90 }, { ext: '2', total: 50 },
      ])
      expect((await store.listDashboardJobs({ limit: 10, minScore: 60 })).rows).toHaveLength(1)

      const ntf = await store.createNotification([created[0]!.id])
      await store.markNotificationSent(ntf.id)
      const unnotified = await store.listDashboardJobs({ limit: 10, unnotifiedOnly: true })
      expect(unnotified.rows.map((r) => r.total)).toEqual([50])
    })
  })
}
