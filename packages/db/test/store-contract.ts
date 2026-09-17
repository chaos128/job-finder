import { beforeEach, describe, expect, test } from 'vitest'
import { MemoryStore } from '../src/index.js'
import type {
  DashboardCursor, DashboardPage, NewJob, RunPipeline, RunTrigger, Search, SearchParams,
  Source, Store, SupabaseStore,
} from '../src/index.js'

const job = (externalId: string, over: Partial<NewJob> = {}): NewJob => ({
  source: 'wanted',
  externalId,
  position: `Position ${externalId}`,
  companyName: 'ACME',
  companyId: 1,
  addressDistrict: '강남구',
  addressFull: '서울 강남구',
  url: `https://www.wanted.co.kr/wd/${externalId}`,
  dueTime: null,
  ...over,
})

/**
 * Remember가 붙으면 params 모양만으로는 어느 소스인지 알 수 없다 — 행이 직접
 * source를 들고 나와야 한다. Store 인터페이스에는 검색을 만드는 메서드가
 * 없다(검색은 사람이 손으로 등록하는 전제)라, 구현마다 직접 심는다:
 * MemoryStore는 배열에 push하고 SupabaseStore는 테스트 전용 헬퍼로 insert한다.
 */
async function seedSearch(store: Store, source: Source): Promise<void> {
  if (store instanceof MemoryStore) {
    const params: SearchParams = source === 'wanted'
      ? {
        source: 'wanted', jobGroupId: '0', tagTypeIds: [], locations: [],
        yearsFrom: 0, yearsTo: 0, country: 'kr', sort: 'recommend',
      }
      : {
        source: 'remember', jobCategoryNames: [], addresses: [],
        organizationType: null, minExperience: null,
      }
    const search: Search = {
      id: `search_${source}`, source, url: 'https://example.com/search', params, enabled: true,
    }
    store.searches.push(search)
    return
  }
  await (store as SupabaseStore).__seedSearchForTests(source)
}

const seedScored = async (
  store: Store,
  specs: { ext: string; total: number; companyName?: string; position?: string }[],
) => {
  const created = await store.insertJobs(specs.map((s) => job(s.ext, {
    ...(s.companyName === undefined ? {} : { companyName: s.companyName }),
    ...(s.position === undefined ? {} : { position: s.position }),
  })))
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
        annualFrom: 5, annualTo: 100,
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
        annualFrom: 5, annualTo: 100,
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
        annualFrom: 5, annualTo: 100,
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
          annualFrom: 5, annualTo: 100,
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

    // 대시보드의 "알림 대기" 건수를 이걸로 센다 — 후보 목록과 대상이 어긋나면
    // 실제로는 발송되지 않을 건수를 보여주게 된다. 컬럼만 다르고 대상은 같아야 한다.
    test('알림 대기 축약 목록은 후보 목록과 같은 대상·같은 순서다', async () => {
      // dueTime은 호출자가 만료를 판정하는 유일한 재료다 — 값이 그대로 실려야 한다.
      const inserted = await store.insertJobs([
        { ...job('1'), dueTime: '2026-09-01' }, job('2'), { ...job('3'), dueTime: '2026-08-20' },
      ])
      for (const [i, total] of [70, 90, 80].entries()) {
        await store.saveJobDetail(inserted[i]!.id, {
          annualFrom: 5, annualTo: 100,
          intro: null, requirements: null, mainTasks: null,
          preferredPoints: null, benefits: null, skillTags: [], raw: {},
        })
        await store.saveScore({
          jobId: inserted[i]!.id, total, breakdown: {},
          reasoning: '', summary: '', scorer: 'routine', rubricVersion: 'v1',
        })
      }
      // 제외된 공고는 발송되지 않으므로 양쪽 모두에서 빠져야 한다.
      await store.setJobHidden(inserted[1]!.id, true)

      const candidates = await store.listNotifyCandidates()
      const pending = await store.listNotifyPending()
      expect(pending.map((p) => p.total)).toEqual(candidates.map((c) => c.score.total))
      expect(pending.map((p) => p.total)).toEqual([80, 70])
      expect(pending.map((p) => p.dueTime)).toEqual(['2026-08-20', '2026-09-01'])
      expect(pending.map((p) => p.dueTime)).toEqual(candidates.map((c) => c.job.dueTime))
    })

    test('발송 표시된 job은 알림 후보에서 빠진다', async () => {
      const [inserted] = await store.insertJobs([job('1')])
      await store.saveJobDetail(inserted!.id, {
        annualFrom: 5, annualTo: 100,
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
        annualFrom: 5, annualTo: 100,
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
        annualFrom: 5, annualTo: 100,
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

    test('검색은 자기 source를 들고 나온다', async () => {
      await seedSearch(store, 'remember')
      const [search] = await store.listEnabledSearches()
      expect(search!.source).toBe('remember')
    })

    test('listDashboardJobs는 점수 내림차순으로 자르고 커서를 준다', async () => {
      await seedScored(store, [
        { ext: '1', total: 90 }, { ext: '2', total: 70 }, { ext: '3', total: 80 },
      ])
      const page = await store.listDashboardJobs({ limit: 2 })
      expect(page.rows.map((r) => r.total)).toEqual([90, 80])
      expect(page.nextCursor).toEqual(
        { hidden: false, duplicates: false, total: 80, jobId: page.rows[1]!.jobId },
      )
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

    // 정렬이 hidden asc, total desc, jobId desc(3단)로 바뀌면서 새로 생긴 경계 —
    // 제외 안 된 공고와 제외된 공고 사이. total 단독 커서가 동점 경계를 놓쳤던 것과
    // 같은 이유로, hidden을 커서에 안 넣으면 이 경계에서 행이 누락되거나 중복된다.
    // limit=2로 5행(동점 4 + 별도 1행, 그중 2행 제외)을 페이징해 경계가 페이지
    // 중간에 걸리게 만든다.
    // 목록이 제외 여부로 갈리므로, 페이징 중에 반대편 공고가 섞여 들어오면 안 된다.
    test('기본 목록은 제외된 공고를 한 건도 주지 않는다', async () => {
      const created = await seedScored(store, [
        { ext: '1', total: 74 }, { ext: '2', total: 74 }, { ext: '3', total: 74 },
        { ext: '4', total: 74 }, { ext: '5', total: 60 },
      ])
      await store.setJobHidden(created[0]!.id, true)
      await store.setJobHidden(created[4]!.id, true)

      const seen: string[] = []
      let cursor: DashboardCursor | undefined
      for (let guard = 0; guard < 10; guard++) {
        const page: DashboardPage = await store.listDashboardJobs({ limit: 2, cursor })
        seen.push(...page.rows.map((r) => r.jobId))
        if (!page.nextCursor) break
        cursor = page.nextCursor
      }
      expect(seen).toHaveLength(3)
      expect(new Set(seen).size).toBe(3)
      expect(seen).not.toContain(created[0]!.id)
      expect(seen).not.toContain(created[4]!.id)
    })

    test('hiddenOnly면 제외된 공고만 준다', async () => {
      const created = await seedScored(store, [
        { ext: '1', total: 90 }, { ext: '2', total: 70 }, { ext: '3', total: 60 },
      ])
      await store.setJobHidden(created[0]!.id, true)
      await store.setJobHidden(created[2]!.id, true)

      const page = await store.listDashboardJobs({ limit: 10, hiddenOnly: true })
      // 제외된 것만, 그 안에서도 점수 내림차순이다.
      expect(page.rows.map((r) => r.jobId)).toEqual([created[0]!.id, created[2]!.id])
      expect(page.rows.every((r) => r.hidden)).toBe(true)
    })

    // 토글을 바꾸면 이전 목록의 커서가 남는다. 그 커서로 반대편 목록을 태우면
    // 두 질의 결과가 한 목록에 이어붙어 첫 페이지가 통째로 사라진다.
    test('반대편 목록의 커서는 무시하고 처음부터 준다', async () => {
      const created = await seedScored(store, [
        { ext: '1', total: 90 }, { ext: '2', total: 70 },
      ])
      await store.setJobHidden(created[0]!.id, true)

      const stale: DashboardCursor = { hidden: false, duplicates: false, total: 80, jobId: created[1]!.id }
      const page = await store.listDashboardJobs({ limit: 10, hiddenOnly: true, cursor: stale })
      expect(page.rows.map((r) => r.jobId)).toEqual([created[0]!.id])
    })

    // duplicatesOnly는 hiddenOnly와 같은 배타 버킷이라 같은 문제가 생긴다 — 여기서는
    // 손으로 만든 낡은 커서 대신, 비중복 버킷에서 실제로 받은 nextCursor를 그대로
    // 중복 버킷 질의에 재사용한다. 비중복 버킷의 유일한 행(total 50)보다 두 중복 행
    // (90, 70)이 더 높은 점수라, duplicates 축 비교가 빠지면 total 커서 필터가 두
    // 행을 전부 "커서보다 앞선 행"으로 오인해 걸러낸다 — 중복 목록에서 가장 점수
    // 높은 행이 조용히 사라지는, finding이 지적한 바로 그 증상이다.
    test('중복 목록은 비중복 목록의 커서를 무시하고 처음부터 준다', async () => {
      const created = await seedScored(store, [
        { ext: '1', total: 50 }, { ext: '2', total: 90 }, { ext: '3', total: 70 },
      ])
      await store.markDuplicates([
        { jobId: created[1]!.id, duplicateOf: created[0]!.id },
        { jobId: created[2]!.id, duplicateOf: created[0]!.id },
      ])

      // 비중복 버킷의 유일한 행이 꽉 찬 페이지(limit 1)라 nextCursor가 나온다.
      const firstPage = await store.listDashboardJobs({ limit: 1 })
      expect(firstPage.rows.map((r) => r.jobId)).toEqual([created[0]!.id])
      const staleCursor = firstPage.nextCursor!

      const dupPage = await store.listDashboardJobs({
        limit: 10, duplicatesOnly: true, cursor: staleCursor,
      })
      // 스킵되지 않고 처음부터, 점수 내림차순으로 온다.
      expect(dupPage.rows.map((r) => r.jobId)).toEqual([created[1]!.id, created[2]!.id])
      // 카드가 원본으로 가는 링크를 만들려면 행이 직접 duplicateOf를 들고 나와야 한다.
      expect(dupPage.rows.map((r) => r.duplicateOf)).toEqual([created[0]!.id, created[0]!.id])
      expect(dupPage.rows.every((r) => r.source === 'wanted')).toBe(true)
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

    test('search는 회사명과 포지션 어느 쪽에 걸려도 잡고, 대소문자를 무시한다', async () => {
      await seedScored(store, [
        { ext: '1', total: 90, companyName: '카카오페이', position: 'Backend Engineer' },
        { ext: '2', total: 80, companyName: 'ACME', position: 'Frontend Engineer' },
        { ext: '3', total: 70, companyName: 'Toss', position: 'Designer' },
      ])
      const byCompany = await store.listDashboardJobs({ limit: 10, search: '카카오' })
      expect(byCompany.rows.map((r) => r.companyName)).toEqual(['카카오페이'])

      // 포지션에만 있는 말도 같은 검색어 하나로 걸려야 한다(두 컬럼 or).
      const byPosition = await store.listDashboardJobs({ limit: 10, search: 'engineer' })
      expect(byPosition.rows.map((r) => r.total)).toEqual([90, 80])

      // 공백뿐인 검색어는 필터가 없는 것과 같다 — 빈 목록이 아니라 전건이다.
      expect((await store.listDashboardJobs({ limit: 10, search: '   ' })).rows).toHaveLength(3)
    })

    // 회사명에 괄호가 흔하고("이베이재팬(eBay)") 쉼표도 쳐볼 수 있다. PostgREST 필터
    // 문자열에서 이 둘은 각각 로직 트리 구분자라, 그대로 흘려보내면 괄호는 조용히
    // 0건이 되고 쉼표는 400으로 페이지 전체를 죽인다(운영 DB 실측).
    test('search에 괄호·쉼표가 들어가도 필터가 깨지지 않는다', async () => {
      await seedScored(store, [
        { ext: '1', total: 90, companyName: '이베이재팬(eBay)' },
        { ext: '2', total: 80, companyName: 'ACME' },
      ])
      const paren = await store.listDashboardJobs({ limit: 10, search: '이베이재팬(eBay)' })
      expect(paren.rows.map((r) => r.companyName)).toEqual(['이베이재팬(eBay)'])

      // 아무것도 안 걸리는 게 정답이다 — 던지지도, 전건을 주지도 않아야 한다.
      const comma = await store.listDashboardJobs({ limit: 10, search: 'a,b' })
      expect(comma.rows).toEqual([])
    })

    test('total은 limit에 잘리기 전 전체 건수이고, 이어보기 페이지에서는 null이다', async () => {
      await seedScored(store, [
        { ext: '1', total: 90 }, { ext: '2', total: 80 }, { ext: '3', total: 70 },
      ])
      // rows.length(2)를 총량으로 쓰면 화면이 거짓말을 한다 — 3이어야 한다.
      const first = await store.listDashboardJobs({ limit: 2 })
      expect(first.rows).toHaveLength(2)
      expect(first.total).toBe(3)

      // 총량은 필터에만 걸린다 — 커서를 태운 요청에서는 다시 세지 않는다.
      const next = await store.listDashboardJobs({ limit: 2, cursor: first.nextCursor! })
      expect(next.total).toBeNull()

      // 필터가 좁히면 총량도 같이 좁아진다.
      expect((await store.listDashboardJobs({ limit: 2, minScore: 80 })).total).toBe(2)
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

    test('setJobHidden은 값을 뒤집고, 켜지면 기본 목록에서 빠진다', async () => {
      const created = await seedScored(store, [
        { ext: '1', total: 90 }, { ext: '2', total: 70 },
      ])
      await store.setJobHidden(created[0]!.id, true)
      const page = await store.listDashboardJobs({ limit: 10 })
      expect(page.rows.map((r) => r.jobId)).toEqual([created[1]!.id])

      await store.setJobHidden(created[0]!.id, false)
      const restored = await store.listDashboardJobs({ limit: 10 })
      expect(restored.rows.map((r) => r.jobId)).toEqual([created[0]!.id, created[1]!.id])
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

    // 중복은 채점 큐에서 빠져 영원히 채점되지 않는다. 그러니 "아직 점수가 없다"는
    // 조건에는 영원히 걸리고, 거르지 않으면 미채점 목록에 영구 거주한다 — 운영에서
    // 미채점 21건이 전부 중복 행이고 진짜 미채점은 0건인 상태가 실제로 나왔다.
    // hidden으로는 안 걸러진다: 중복은 일부러 별도 컬럼으로 표시하기 때문이다.
    test('중복으로 표시된 공고는 미채점 목록에 안 나온다', async () => {
      const created = await store.insertJobs([job('1'), job('2')])
      await store.markDuplicates([{ jobId: created[1]!.id, duplicateOf: created[0]!.id }])
      const { rows, total } = await store.listUnscoredJobs(10)
      expect(rows.map((r) => r.jobId)).toEqual([created[0]!.id])
      expect(total).toBe(1)
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

    describe('마감 재확인', () => {
      const withDetail = async (ext: string) => {
        const [created] = await store.insertJobs([job(ext)])
        await store.saveJobDetail(created!.id, {
          annualFrom: 5, annualTo: 100,
          intro: null, requirements: null, mainTasks: null,
          preferredPoints: null, benefits: null, skillTags: [], raw: {},
        })
        return created!
      }

      test('대상은 제외되지 않고 상세를 받은 공고다', async () => {
        const a = await withDetail('1')
        const b = await withDetail('2')
        // 상세 전이라 아직 확인할 게 없다.
        await store.insertJobs([job('3')])
        await store.setJobHidden(b.id, true)

        // 방금 상세를 받아 확인 시각이 찍혔으므로 staleDays=0으로 전부 낡게 만든다.
        const targets = await store.listJobsNeedingRecheck(10, 0)
        expect(targets.map((j) => j.id)).toEqual([a.id])
      })

      // 상세를 받는 것 자체가 모집 상태를 확인한 것이다. 이걸 안 남기면 방금 수집한
      // 공고가 같은 실행의 재확인 노드에 잡혀 같은 API를 한 번 더 부른다.
      test('방금 상세를 받은 공고는 곧바로 재확인 대상이 되지 않는다', async () => {
        await withDetail('1')
        expect(await store.listJobsNeedingRecheck(10, 7)).toEqual([])
      })

      test('한 번 확인한 공고는 staleDays 전까지 다시 집지 않는다', async () => {
        const a = await withDetail('1')
        await store.recordJobRecheck(a.id, { closed: false, dueTime: '2026-12-31' })
        expect(await store.listJobsNeedingRecheck(10, 7)).toEqual([])
        // staleDays=0이면 방금 확인한 것도 낡은 것으로 친다 — 시계를 조작하지 않고
        // 경계를 확인하는 방법이다(회사 별점과 같은 규약).
        expect((await store.listJobsNeedingRecheck(10, 0)).map((j) => j.id)).toEqual([a.id])
      })

      test('closed면 제외되고 기본 목록에서 빠진다', async () => {
        const created = await seedScored(store, [{ ext: '1', total: 80 }])
        await store.saveJobDetail(created[0]!.id, {
          annualFrom: 5, annualTo: 100,
          intro: null, requirements: null, mainTasks: null,
          preferredPoints: null, benefits: null, skillTags: [], raw: {},
        })
        await store.recordJobRecheck(created[0]!.id, { closed: true, dueTime: '2026-01-01' })

        expect((await store.listDashboardJobs({ limit: 10 })).rows).toEqual([])
        const onlyHidden = await store.listDashboardJobs({ limit: 10, hiddenOnly: true })
        expect(onlyHidden.rows.map((r) => r.jobId)).toEqual([created[0]!.id])
      })

      // 저장된 마감일이 연장되는 경우가 실제로 있다(실측: 09-10 → 09-27).
      // 갱신하지 않으면 카드가 지난 날짜를 계속 보여준다.
      test('열려 있으면 마감일만 최신값으로 덮는다', async () => {
        const created = await seedScored(store, [{ ext: '1', total: 80 }])
        await store.saveJobDetail(created[0]!.id, {
          annualFrom: 5, annualTo: 100,
          intro: null, requirements: null, mainTasks: null,
          preferredPoints: null, benefits: null, skillTags: [], raw: {},
        })
        await store.recordJobRecheck(created[0]!.id, { closed: false, dueTime: '2026-09-27' })

        const page = await store.listDashboardJobs({ limit: 10 })
        expect(page.rows.map((r) => r.dueTime)).toEqual(['2026-09-27'])
      })

      // 자동화가 사람의 결정을 덮어쓰면 안 된다 — 손으로 제외해 둔 공고가
      // 재확인 한 번에 되살아나서는 곤란하다.
      test('열려 있어도 이미 제외된 공고를 되살리지 않는다', async () => {
        const created = await seedScored(store, [{ ext: '1', total: 80 }])
        await store.setJobHidden(created[0]!.id, true)
        await store.recordJobRecheck(created[0]!.id, { closed: false, dueTime: null })

        expect((await store.listDashboardJobs({ limit: 10 })).rows).toEqual([])
      })
    })

    describe('회사 별점 (Blind)', () => {
      test('조회 대상은 별점 행이 없는 회사다 — 확정된 회사는 다시 집지 않는다', async () => {
        await store.insertJobs([
          { ...job('1'), companyName: 'ACME' },
          { ...job('2'), companyName: 'ACME' },
          { ...job('3'), companyName: '보노보노' },
        ])
        // 같은 회사가 공고 두 건이어도 한 번만 나와야 한다.
        expect((await store.listCompaniesNeedingRating(10, 30)).sort()).toEqual(['ACME', '보노보노'])

        await store.saveCompanyRating({
          companyName: 'ACME', status: 'ok', rating: 3.4,
          blindName: 'ACME', blindUrl: 'https://www.teamblind.com/kr/company/ACME/',
        })
        expect(await store.listCompaniesNeedingRating(10, 30)).toEqual(['보노보노'])
      })

      // 미등록도 확정된 답이다. 실패로 다루면 실측 4곳 중 1곳을 매 실행이 다시 조회한다.
      test('Blind 미등록으로 확정한 회사도 다시 집지 않는다', async () => {
        await store.insertJobs([{ ...job('1'), companyName: '없는회사' }])
        await store.saveCompanyRating({ companyName: '없는회사', status: 'not_found' })
        expect(await store.listCompaniesNeedingRating(10, 30)).toEqual([])
      })

      test('staleDays가 지나면 다시 조회 대상이 된다', async () => {
        await store.insertJobs([{ ...job('1'), companyName: 'ACME' }])
        await store.saveCompanyRating({
          companyName: 'ACME', status: 'ok', rating: 3.4,
          blindName: 'ACME', blindUrl: 'https://www.teamblind.com/kr/company/ACME/',
        })
        // staleDays=0이면 방금 저장한 것도 낡은 것으로 친다 — 시계를 조작하지 않고
        // 경계를 확인하는 방법이다.
        expect(await store.listCompaniesNeedingRating(10, 0)).toEqual(['ACME'])
      })

      test('별점은 목록과 상세 양쪽에 같은 값으로 실린다', async () => {
        const [created] = await store.insertJobs([{ ...job('1'), companyName: 'ACME' }])
        await store.saveJobDetail(created!.id, {
          annualFrom: 5, annualTo: 100,
          intro: null, requirements: null, mainTasks: null,
          preferredPoints: null, benefits: null, skillTags: [], raw: {},
        })
        await store.saveScore({
          jobId: created!.id, total: 80, breakdown: {},
          reasoning: '', summary: '', scorer: 'routine', rubricVersion: 'v1',
        })
        await store.saveCompanyRating({
          companyName: 'ACME', status: 'ok', rating: 3.4,
          blindName: 'ACME Inc.', blindUrl: 'https://www.teamblind.com/kr/company/ACME/',
        })

        const { rows } = await store.listDashboardJobs({ limit: 10 })
        expect(rows[0]!.blind).toEqual({
          rating: 3.4, blindName: 'ACME Inc.',
          blindUrl: 'https://www.teamblind.com/kr/company/ACME/',
        })
        const detail = await store.getJobDetail(created!.id)
        expect(detail!.blind).toEqual(rows[0]!.blind)
      })

      // 미등록 회사는 화면에 아무것도 그리지 않는다 — 그 판단의 근거가 null이다.
      test('미등록 회사의 별점은 null이다', async () => {
        const [created] = await store.insertJobs([{ ...job('1'), companyName: '없는회사' }])
        await store.saveJobDetail(created!.id, {
          annualFrom: 5, annualTo: 100,
          intro: null, requirements: null, mainTasks: null,
          preferredPoints: null, benefits: null, skillTags: [], raw: {},
        })
        await store.saveScore({
          jobId: created!.id, total: 80, breakdown: {},
          reasoning: '', summary: '', scorer: 'routine', rubricVersion: 'v1',
        })
        await store.saveCompanyRating({ companyName: '없는회사', status: 'not_found' })

        const { rows } = await store.listDashboardJobs({ limit: 10 })
        expect(rows[0]!.blind).toBeNull()
        expect((await store.getJobDetail(created!.id))!.blind).toBeNull()
      })

      // 네트워크 한 번 튄 것이 멀쩡한 별점을 지우면 안 된다.
      test('조회 실패는 이미 확정된 별점을 덮지 않는다', async () => {
        await store.insertJobs([{ ...job('1'), companyName: 'ACME' }])
        await store.saveCompanyRating({
          companyName: 'ACME', status: 'ok', rating: 3.4,
          blindName: 'ACME', blindUrl: 'https://www.teamblind.com/kr/company/ACME/',
        })
        await store.recordCompanyRatingFailure('ACME', 'boom')

        const { rows } = await store.listDashboardJobs({ limit: 10 })
        // 점수가 없어 목록에는 안 뜨므로 조회 대상 목록으로 확인한다.
        void rows
        expect(await store.listCompaniesNeedingRating(10, 30)).toEqual([])
      })
    })

    describe('교차 중복', () => {
      // 정렬을 두 축 모두 검증한다: 별도 insertJobs 호출(a)이 뒤 배치(c/d/e)보다
      // firstSeenAt이 앞서야 하고, 같은 배치 안(d, e)에서는 firstSeenAt이 동률이라
      // id 오름차순이 유일한 승자를 정한다 — Task 8이 이 순서의 첫 행을 원본으로
      // 취급하므로, 남는 행이 하나뿐인 테스트로는 정렬 자체를 증명하지 못한다.
      test('중복 인덱스는 중복 아니고 제외 안 된 행만, 오래된 순으로 준다', async () => {
        const [a, b] = await store.insertJobs([
          { ...job('a'), companyName: '루닛', position: 'FE' },
          { ...job('b'), source: 'remember', companyName: '루닛', position: 'FE' },
        ])
        const [c, d, e] = await store.insertJobs([
          { ...job('c'), companyName: '토스', position: 'BE' },
          { ...job('d'), companyName: '카카오', position: 'BE' },
          { ...job('e'), companyName: '네이버', position: 'BE' },
        ])
        await store.setJobHidden(c!.id, true)
        await store.markDuplicates([{ jobId: b!.id, duplicateOf: a!.id }])

        const index = await store.listDedupIndex()
        expect(index.map((r) => r.id)).toEqual([a!.id, d!.id, e!.id])
      })

      // 마감돼 숨겨진 옛 행이 후보로 남으면, 새 external_id로 다시 올라온 공고가
      // 그 옛 행의 중복으로 찍혀 영원히 채점되지 않는다. recheck가 세운 보장이 깨진다.
      test('중복으로 표시된 공고는 채점 대기에서 빠진다', async () => {
        const [a, b] = await store.insertJobs([
          job('a'),
          { ...job('b'), source: 'remember' },
        ])
        await store.saveJobDetail(a!.id, {
          annualFrom: 5, annualTo: 100,
          intro: null, requirements: null, mainTasks: null,
          preferredPoints: null, benefits: null, skillTags: [], raw: {},
        })
        await store.saveJobDetail(b!.id, {
          annualFrom: 5, annualTo: 100,
          intro: null, requirements: null, mainTasks: null,
          preferredPoints: null, benefits: null, skillTags: [], raw: {},
        })
        await store.markDuplicates([{ jobId: b!.id, duplicateOf: a!.id }])

        const needing = await store.listJobsNeedingScore(10)
        expect(needing.map((j) => j.id)).toEqual([a!.id])
      })
    })
  })
}
