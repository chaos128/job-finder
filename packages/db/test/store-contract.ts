import { beforeEach, describe, expect, test } from 'vitest'
import type {
  DashboardCursor, DashboardPage, NewJob, RunPipeline, RunTrigger, Store,
} from '../src/index.js'

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
      reasoning: `r${spec.ext}`, summary: `s${spec.ext}`, scorer: 'routine', rubricVersion: 'v3',
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
        reasoning: '적합', summary: '요약', scorer: 'routine', rubricVersion: 'v1',
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
          reasoning: '', summary: '', scorer: 'routine', rubricVersion: 'v1',
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
        reasoning: '', summary: '', scorer: 'routine', rubricVersion: 'v1',
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
        reasoning: '', summary: '', scorer: 'routine', rubricVersion: 'v1',
      })
      const n = await store.createNotification([inserted!.id])
      await store.markNotificationSent(n.id)
      await store.saveScore({
        jobId: inserted!.id, total: 90, breakdown: {},
        reasoning: '재채점', summary: '재요약', scorer: 'routine', rubricVersion: 'v1',
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

      await store.setJobBookmarked(created[1]!.id, true)
      const bookmarked = await store.listDashboardJobs({ limit: 10, bookmarkedOnly: true })
      expect(bookmarked.rows.map((r) => r.jobId)).toEqual([created[1]!.id])

      const ntf = await store.createNotification([created[0]!.id])
      await store.markNotificationSent(ntf.id)
      const unnotified = await store.listDashboardJobs({ limit: 10, unnotifiedOnly: true })
      expect(unnotified.rows.map((r) => r.total)).toEqual([50])
    })

    test('getJobDetail은 공고 전문과 점수를 함께 준다', async () => {
      const [created] = await seedScored(store, [{ ext: '1', total: 88 }])
      const detail = await store.getJobDetail(created!.id)
      expect(detail?.job.companyName).toBe('ACME')
      expect(detail?.score.total).toBe(88)
      expect(detail?.score.reasoning).toBe('r1')
      expect(await store.getJobDetail('없는-id')).toBeNull()
    })

    test('getJobDetail은 채점되지 않은 job에는 null을 준다', async () => {
      const [inserted] = await store.insertJobs([job('1')])
      expect(await store.getJobDetail(inserted!.id)).toBeNull()
    })

    test('setJobBookmarked는 값을 뒤집고 목록에 반영된다', async () => {
      const [created] = await seedScored(store, [{ ext: '1', total: 70 }])
      await store.setJobBookmarked(created!.id, true)
      expect((await store.listDashboardJobs({ limit: 10 })).rows[0]!.bookmarked).toBe(true)
      await store.setJobBookmarked(created!.id, false)
      expect((await store.listDashboardJobs({ limit: 10 })).rows[0]!.bookmarked).toBe(false)
    })

    test('getDashboardStats는 건수와 마지막 채점, 루브릭 분포를 준다', async () => {
      await seedScored(store, [{ ext: '1', total: 70 }, { ext: '2', total: 80 }])
      await store.insertJobs([job('3')])
      const stats = await store.getDashboardStats()
      expect(stats.totalJobs).toBe(3)
      expect(stats.scoredJobs).toBe(2)
      expect(stats.rubricVersions).toEqual({ v3: 2 })
      expect(stats.lastScoredAt).not.toBeNull()
    })

    // status 필터를 통째로 빼도 위 테스트는 그대로 통과한다 — seedScored는
    // saveScore만 호출해서 실패 케이스가 섞이지 않기 때문이다. recordScoreFailure가
    // 남기는 자리표시자(rubricVersion 'v1', scoredAt 기본값)가 건수·분포를
    // 오염시키지 않는지 별도로 확인해야 한다.
    test('getDashboardStats는 실패한 채점을 건수와 루브릭 분포에서 제외한다', async () => {
      const [scored] = await seedScored(store, [{ ext: '1', total: 70 }])
      const expectedScoredAt = (await store.getJobDetail(scored!.id))!.score.scoredAt
      const [failed] = await store.insertJobs([job('2')])
      await store.recordScoreFailure(failed!.id, 'boom')
      const stats = await store.getDashboardStats()
      expect(stats.scoredJobs).toBe(1)
      expect(stats.rubricVersions).toEqual({ v3: 1 })
      expect(stats.lastScoredAt).toBe(expectedScoredAt)
    })

    test('startRun은 pipeline을 기록하고 getDashboardStats가 되돌려준다', async () => {
      await store.startRun('collect', 'cron')
      await store.startRun('notify', 'manual')
      const stats = await store.getDashboardStats()
      const pipelines = stats.recentRuns.map((r) => r.pipeline)
      expect(pipelines).toContain('collect')
      expect(pipelines).toContain('notify')
    })

    // 커서/필터 조합과 마찬가지로 recentRuns도 "5건 상한"과 "최근 것이 먼저"라는
    // 두 성질을 동시에 지켜야 한다. total 커서 테스트처럼 toContain만 확인하면
    // 순서가 뒤집히거나 상한이 빠져도 통과해 버린다. MemoryStore는 타임스탬프를
    // epoch로 고정해 시각으로는 순서를 검증할 수 없으므로, pipeline·trigger
    // 조합(2×3=6가지, 모두 겹치지 않게 구성 가능)으로 삽입 순서를 추적한다.
    test('getDashboardStats의 recentRuns는 최근 5건만 최신순으로 준다', async () => {
      const specs: [RunPipeline, RunTrigger][] = [
        ['collect', 'cron'], ['collect', 'manual'], ['collect', 'cli'],
        ['notify', 'cron'], ['notify', 'manual'], ['notify', 'cli'],
      ]
      for (const [pipeline, trigger] of specs) await store.startRun(pipeline, trigger)
      const stats = await store.getDashboardStats()
      expect(stats.recentRuns).toHaveLength(5)
      const seen = stats.recentRuns.map((r) => `${r.pipeline}:${r.trigger}`)
      // 가장 먼저 시작한 실행(collect:cron)은 상한에 밀려 빠지고, 나머지는
      // 나중에 시작한 순서대로(최신 우선) 나와야 한다.
      const expected = [...specs].reverse().slice(0, 5).map(([p, t]) => `${p}:${t}`)
      expect(seen).toEqual(expected)
    })

    // status 필터를 빠뜨려도 위 테스트들은 다 통과한다 — 실패한 채점은 애초에
    // total을 남기지 않아서다. 채점 실패 job이 total 0짜리 가짜 행으로
    // 새어 나오지 않는지는 별도로 확인해야 한다.
    test('점수 저장에 실패한 job은 목록에 나타나지 않는다', async () => {
      const [scored] = await seedScored(store, [{ ext: '1', total: 90 }])
      const [failed] = await store.insertJobs([job('2')])
      await store.recordScoreFailure(failed!.id, 'boom')
      const page = await store.listDashboardJobs({ limit: 10 })
      expect(page.rows.map((r) => r.jobId)).toEqual([scored!.id])
    })

    test('목록 요약은 채점 시 받은 값을 그대로 싣는다', async () => {
      const [created] = await store.insertJobs([job('1')])
      await store.saveScore({
        jobId: created!.id, total: 80,
        breakdown: { stack: 16, role: 16, domain: 16, growth: 16, conditions: 16 },
        reasoning: '축별 근거는 여기에 적는다.',
        summary: '핀테크 스타트업에서 결제 웹 프론트엔드를 맡는 자리다.',
        scorer: 'routine', rubricVersion: 'v4',
      })
      const page = await store.listDashboardJobs({ limit: 10 })
      expect(page.rows[0]!.summary).toBe('핀테크 스타트업에서 결제 웹 프론트엔드를 맡는 자리다.')
    })

    test('미채점 목록은 아직 채점되지 않은 공고만 준다', async () => {
      const created = await store.insertJobs([job('1'), job('2'), job('3')])
      await store.saveScore({
        jobId: created[0]!.id, total: 70,
        breakdown: { stack: 14, role: 14, domain: 14, growth: 14, conditions: 14 },
        reasoning: 'r', summary: 's', scorer: 'routine', rubricVersion: 'v5',
      })
      const { rows, total } = await store.listUnscoredJobs(10)
      expect(rows).toHaveLength(2)
      expect(total).toBe(2)
      expect(rows.map((r) => r.jobId)).not.toContain(created[0]!.id)
    })

    // 채점에 실패한 공고도 "아직 점수가 없는" 상태다 — 목록에서는 빠지지만
    // 대기 목록에는 보여야 소유자가 왜 안 올라오는지 알 수 있다.
    test('채점 실패한 공고도 미채점 목록에 남는다', async () => {
      const [created] = await store.insertJobs([job('1')])
      await store.recordScoreFailure(created!.id, 'schema mismatch')
      const { rows } = await store.listUnscoredJobs(10)
      expect(rows.map((r) => r.jobId)).toEqual([created!.id])
    })

    // "오래된 것부터"가 실제로 뜻할 수 있는 것은 **배치 사이의 순서**뿐이다.
    // first_seen_at은 `default now()`이고 insertJobs는 한 문장이라 한 배치 안의
    // 행들은 시각이 전부 같다(운영 168행의 distinct first_seen_at = 1). 배치 안의
    // 순서를 단언하는 테스트는 실 스토어에 없는 보장을 증명하는 셈이 된다.
    test('미채점 목록은 나중에 수집된 배치를 뒤로 보낸다', async () => {
      const older = await store.insertJobs([job('1'), job('2')])
      const newer = await store.insertJobs([job('3')])
      const { rows } = await store.listUnscoredJobs(10)
      expect(rows).toHaveLength(3)
      expect(rows[2]!.jobId).toBe(newer[0]!.id)
      expect(new Set(rows.slice(0, 2).map((r) => r.jobId)))
        .toEqual(new Set(older.map((j) => j.id)))
    })

    // 정렬 키가 동률이면 limit N은 임의의 부분집합을 고른다 — 운영에서 limit=5와
    // limit=100이 실제로 다른 앞부분을 냈다. 2차 정렬 키(id)가 그걸 막는지,
    // 즉 상한을 줄여도 같은 앞부분이 나오는지 본다.
    test('상한이 달라져도 같은 앞부분이 온다', async () => {
      await store.insertJobs([job('1'), job('2'), job('3'), job('4')])
      const all = await store.listUnscoredJobs(10)
      const head = await store.listUnscoredJobs(2)
      expect(head.rows.map((r) => r.jobId)).toEqual(all.rows.slice(0, 2).map((r) => r.jobId))
    })

    // 상한에서 잘린 건수를 백로그 총량으로 보여주면 화면이 정확히 상한값에서
    // 거짓말을 한다 — total은 limit과 무관해야 한다.
    test('미채점 총량은 상한과 무관하게 전체 건수를 준다', async () => {
      await store.insertJobs([job('1'), job('2'), job('3')])
      const { rows, total } = await store.listUnscoredJobs(2)
      expect(rows).toHaveLength(2)
      expect(total).toBe(3)
    })
  })
}
