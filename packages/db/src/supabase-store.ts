import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Store } from './store.js'
import type {
  DashboardCursor, DashboardFilters, DashboardPage, DashboardStats,
  Job, JobDetailFields, NewJob, NodeRunEntry, Notification,
  NotifyRule, Profile, RunPipeline, RunTrigger, Score, ScoreInput, ScoredJob, Search,
  SearchParams, Source, UnscoredJobs,
} from './types.js'

const MAX_ATTEMPTS = 3

/**
 * 알림 후보는 단조 증가한다 — minScore 미달로 영영 메일에 안 실리는 공고는
 * notified_at이 계속 NULL이라 매 실행마다 다시 조회된다. total desc 정렬이므로
 * 상위 200만 받아도 selectForDigest(topN 3)의 결과는 같다.
 */
const NOTIFY_CANDIDATE_LIMIT = 200

/**
 * 다이제스트가 쓰는 것만 가져온다 — JD 본문(intro/requirements/…)과
 * raw(Wanted 상세 응답 원본)는 메일에 한 글자도 안 쓰이면서 후보 수에 비례해
 * 페이로드를 키운다. 나머지 스칼라 컬럼은 Job 타입을 채우기 위한 것이고 작다.
 */
const NOTIFY_CANDIDATE_SELECT = `*, jobs(
  id, source, external_id, position, company_name, company_id,
  address_district, address_full, url, due_time, first_seen_at,
  detail_status, detail_attempts, detail_error, bookmarked, hidden
)`

// raw와 JD 본문은 제외한다 — 목록에서 쓰지 않는데 가장 크다. reasoning도 뺐다 —
// 채점 근거 전문은 상세에서만 쓰고, 목록 요약은 채점 시 함께 받은 summary를 그대로 싣는다.
const DASHBOARD_SELECT =
  'total, breakdown, notified_at, summary, jobs!inner(id, company_name, position, url, due_time, bookmarked, hidden)'

interface JobRow {
  id: string; source: string; external_id: string; position: string
  company_name: string; company_id: number | null
  address_district: string | null; address_full: string | null
  url: string; due_time: string | null
  intro: string | null; requirements: string | null; main_tasks: string | null
  preferred_points: string | null; benefits: string | null
  skill_tags: string[]; raw: unknown; first_seen_at: string
  detail_status: string; detail_attempts: number; detail_error: string | null
  bookmarked: boolean; hidden: boolean
}

interface SearchRow {
  id: string; url: string; params: SearchParams; enabled: boolean
}

interface ProfileRow {
  resume_text: string; rubric_version: string; notify_email: string; notify_rule: NotifyRule
}

interface ScoreRow {
  job_id: string; total: number; breakdown: Record<string, number>
  reasoning: string; summary: string; scorer: string; rubric_version: string
  status: string; attempts: number; error: string | null
  scored_at: string; notified_at: string | null
}

interface NotificationRow {
  id: string; status: string; job_ids: string[]
}

type DashboardJoinRow = {
  total: number; breakdown: Record<string, number>; notified_at: string | null
  summary: string
  jobs: {
    id: string; company_name: string; position: string; url: string
    due_time: string | null; bookmarked: boolean; hidden: boolean
  }
}

/** jobs_unscored 뷰(0005 마이그레이션)의 컬럼. jobs.*와 같은 모양이지만 이 목록에는
 *  네 컬럼만 있으면 된다. */
type UnscoredJobRow = {
  id: string; company_name: string; position: string; url: string
  due_time: string | null; first_seen_at: string
}

// scores.job_id is both primary key and FK -> jobs, so this is a 1:1
// relationship. PostgREST embeds 1:1 relations as a single nullable
// object even from the "one" side, not as an array. (This mattered for
// an earlier version of listJobsNeedingScore that embedded scores from
// jobs; that method now queries the jobs_needing_score view instead,
// but listNotifyCandidates still embeds jobs from scores below.)
type ScoreWithJobRow = ScoreRow & { jobs: DigestJobRow }

type DetailColumns =
  'intro' | 'requirements' | 'main_tasks' | 'preferred_points' | 'benefits' | 'skill_tags' | 'raw'
type DigestJobRow = Omit<JobRow, DetailColumns>

/** 다이제스트 경로는 상세 컬럼을 select하지 않으므로 없는 행도 받는다. */
function toJob(row: DigestJobRow & Partial<Pick<JobRow, DetailColumns>>): Job {
  return {
    id: row.id,
    source: row.source as Source,
    externalId: row.external_id,
    position: row.position,
    companyName: row.company_name,
    companyId: row.company_id,
    addressDistrict: row.address_district,
    addressFull: row.address_full,
    url: row.url,
    dueTime: row.due_time,
    intro: row.intro ?? null,
    requirements: row.requirements ?? null,
    mainTasks: row.main_tasks ?? null,
    preferredPoints: row.preferred_points ?? null,
    benefits: row.benefits ?? null,
    skillTags: row.skill_tags ?? [],
    raw: row.raw ?? null,
    firstSeenAt: row.first_seen_at,
    detailStatus: row.detail_status as Job['detailStatus'],
    detailAttempts: row.detail_attempts,
    detailError: row.detail_error,
    bookmarked: row.bookmarked,
    hidden: row.hidden,
  }
}

/** listNotifyCandidates와 getJobDetail이 같은 scores 행 매핑을 공유한다. */
function toScore(row: ScoreRow): Score {
  return {
    jobId: row.job_id, total: row.total, breakdown: row.breakdown,
    reasoning: row.reasoning, summary: row.summary, scorer: row.scorer as ScoreInput['scorer'],
    rubricVersion: row.rubric_version, status: row.status as Score['status'],
    attempts: row.attempts, error: row.error,
    scoredAt: row.scored_at, notifiedAt: row.notified_at,
  }
}

/**
 * `jobs.id`·`scores.job_id`는 uuid 컬럼이라, PostgREST가 uuid로 캐스팅하지 못하는
 * 문자열을 받으면 400(22P02)을 내고 unwrap이 throw한다. 대시보드는 인증 없는 공개
 * 페이지라 오타 URL·크롤러·끊긴 링크가 임의 문자열을 들고 온다 — MemoryStore가
 * "그런 id는 없다"로 다루는 것과 같게(계약: store-contract.ts의 getJobDetail),
 * 질의를 보내기 전에 걸러 500 대신 404가 되게 한다.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  if (res.data === null) throw new Error('unexpected empty response')
  return res.data
}

export interface SupabaseStore extends Store {
  __truncateAllForTests(): Promise<void>
  __seedSearchForTests(): Promise<string>
}

export function createSupabaseStore(url: string, serviceKey: string): SupabaseStore {
  const db: SupabaseClient = createClient(url, serviceKey, {
    auth: { persistSession: false },
  })

  return {
    async listEnabledSearches(): Promise<Search[]> {
      const rows = unwrap<SearchRow[]>(
        await db.from('searches').select('*').eq('enabled', true),
      )
      return rows.map((r) => ({ id: r.id, url: r.url, params: r.params, enabled: r.enabled }))
    },

    async findJobIdsByExternalIds(source: Source, externalIds: string[]) {
      if (externalIds.length === 0) return new Map<string, string>()
      const rows = unwrap<Array<{ id: string; external_id: string }>>(
        await db.from('jobs').select('id, external_id')
          .eq('source', source).in('external_id', externalIds),
      )
      return new Map(rows.map((r) => [r.external_id, r.id]))
    },

    async insertJobs(rows: NewJob[]) {
      if (rows.length === 0) return []
      const payload = rows.map((r) => ({
        source: r.source, external_id: r.externalId, position: r.position,
        company_name: r.companyName, company_id: r.companyId,
        address_district: r.addressDistrict, address_full: r.addressFull,
        url: r.url, due_time: r.dueTime,
      }))
      const inserted = unwrap<JobRow[]>(
        await db.from('jobs').upsert(payload, {
          onConflict: 'source,external_id', ignoreDuplicates: true,
        }).select('*'),
      )
      return inserted.map(toJob)
    },

    async linkSearchHits(searchId: string, jobIds: string[]) {
      if (jobIds.length === 0) return
      const payload = jobIds.map((jobId) => ({ search_id: searchId, job_id: jobId }))
      const { error } = await db.from('search_hits')
        .upsert(payload, { onConflict: 'search_id,job_id', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    },

    async listJobsNeedingDetail(limit: number) {
      const rows = unwrap<JobRow[]>(
        await db.from('jobs').select('*')
          .eq('detail_status', 'pending').lt('detail_attempts', MAX_ATTEMPTS)
          .order('first_seen_at', { ascending: true }).limit(limit),
      )
      return rows.map(toJob)
    },

    async saveJobDetail(jobId: string, fields: JobDetailFields) {
      const { error } = await db.from('jobs').update({
        intro: fields.intro, requirements: fields.requirements,
        main_tasks: fields.mainTasks, preferred_points: fields.preferredPoints,
        benefits: fields.benefits, skill_tags: fields.skillTags, raw: fields.raw,
        detail_status: 'ok', detail_error: null,
      }).eq('id', jobId)
      if (error) throw new Error(error.message)
    },

    async recordDetailFailure(jobId: string, message: string) {
      const row = unwrap<{ detail_attempts: number }>(
        await db.from('jobs').select('detail_attempts').eq('id', jobId).single(),
      )
      const attempts = row.detail_attempts + 1
      const { error } = await db.from('jobs').update({
        detail_attempts: attempts,
        detail_error: message,
        detail_status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
      })
        // 이미 'ok'인 job은 건드리지 않는다 — cron과 /api/run이 겹쳐 돌면 한쪽이
        // 상세를 저장한 뒤 다른 쪽의 뒤늦은 실패가 'ok'를 'pending'으로 되돌려
        // 그 공고가 jobs_needing_score에서 빠진다.
        .eq('id', jobId).eq('detail_status', 'pending')
      if (error) throw new Error(error.message)
    },

    async listJobsNeedingScore(limit: number) {
      // jobs_needing_score (see migration) already applies the
      // detail_status/score-retry predicate in SQL, so limit() here is
      // a real limit instead of an over-fetch-then-filter guess.
      const rows = unwrap<JobRow[]>(
        await db.from('jobs_needing_score').select('*')
          .order('first_seen_at', { ascending: true }).limit(limit),
      )
      return rows.map(toJob)
    },

    async saveScore(input: ScoreInput) {
      const { error } = await db.from('scores').upsert({
        job_id: input.jobId, total: input.total, breakdown: input.breakdown,
        reasoning: input.reasoning, summary: input.summary, scorer: input.scorer,
        rubric_version: input.rubricVersion,
        status: 'ok', error: null, scored_at: new Date().toISOString(),
      }, { onConflict: 'job_id' })
      if (error) throw new Error(error.message)
    },

    async recordScoreFailure(jobId: string, message: string) {
      const { data: existing, error: selectError } = await db.from('scores')
        .select('attempts').eq('job_id', jobId).maybeSingle<{ attempts: number }>()
      if (selectError) throw new Error(selectError.message)
      const { error } = await db.from('scores').upsert({
        job_id: jobId,
        status: 'failed',
        attempts: (existing?.attempts ?? 0) + 1,
        error: message,
      }, { onConflict: 'job_id' })
      if (error) throw new Error(error.message)
    },

    async getProfile(): Promise<Profile> {
      const row = unwrap<ProfileRow>(
        await db.from('profile').select('*').eq('id', 1).single(),
      )
      return {
        resumeText: row.resume_text,
        rubricVersion: row.rubric_version,
        notifyEmail: row.notify_email,
        notifyRule: row.notify_rule,
      }
    },

    async listNotifyCandidates(): Promise<ScoredJob[]> {
      const rows = unwrap<ScoreWithJobRow[]>(
        await db.from('scores').select(NOTIFY_CANDIDATE_SELECT)
          .eq('status', 'ok').is('notified_at', null)
          .order('total', { ascending: false }).limit(NOTIFY_CANDIDATE_LIMIT),
      )

      return rows
        .filter((r) => r.jobs && !r.jobs.hidden)
        .map((r) => ({ job: toJob(r.jobs), score: toScore(r) }))
    },

    async createNotification(jobIds: string[]): Promise<Notification> {
      const row = unwrap<{ id: string }>(
        await db.from('notifications')
          .insert({ status: 'pending', job_ids: jobIds }).select('*').single(),
      )
      return { id: row.id, status: 'pending', jobIds }
    },

    async listPendingNotifications(): Promise<Notification[]> {
      const rows = unwrap<NotificationRow[]>(
        await db.from('notifications').select('*')
          .eq('status', 'pending').order('created_at', { ascending: true }),
      )
      return rows.map((r) => ({ id: r.id, status: 'pending' as const, jobIds: r.job_ids }))
    },

    async markNotificationSent(notificationId: string) {
      const row = unwrap<{ job_ids: string[] }>(
        await db.from('notifications').select('job_ids').eq('id', notificationId).single(),
      )
      const now = new Date().toISOString()
      const updateScores = await db.from('scores')
        .update({ notified_at: now }).in('job_id', row.job_ids)
      if (updateScores.error) throw new Error(updateScores.error.message)
      const { error } = await db.from('notifications')
        .update({ status: 'sent', sent_at: now }).eq('id', notificationId)
      if (error) throw new Error(error.message)
    },

    async markNotificationFailed(notificationId: string, message: string) {
      const row = unwrap<{ attempts: number }>(
        await db.from('notifications').select('attempts').eq('id', notificationId).single(),
      )
      const attempts = row.attempts + 1
      const { error } = await db.from('notifications').update({
        attempts,
        error: message,
        // 상한에 닿으면 pending으로 되돌리지 않는다 — 영구 실패 한 건이 계속
        // pending으로 남으면 retry-first 게이트가 새 다이제스트를 영원히 막는다.
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
      }).eq('id', notificationId)
      if (error) throw new Error(error.message)
    },

    async listDashboardJobs(
      params: DashboardFilters & { cursor?: DashboardCursor; limit: number },
    ): Promise<DashboardPage> {
      // `!inner` + 명시적 컬럼 목록이라 select 문자열에 `*`가 없다 — postgrest-js는
      // Database 제네릭 없이는 1:1 embed의 카디널리티를 알 수 없어 jobs를 배열로
      // 추론한다(런타임 값은 실제로는 객체). NewResultOne을 직접 지정해 우회한다.
      let q = db.from('scores').select<typeof DASHBOARD_SELECT, DashboardJoinRow>(DASHBOARD_SELECT)
        .eq('status', 'ok').eq('jobs.hidden', false)
        .order('total', { ascending: false })
        .order('job_id', { ascending: false })
        .limit(params.limit)
      if (params.minScore !== undefined) q = q.gte('total', params.minScore)
      if (params.bookmarkedOnly) q = q.eq('jobs.bookmarked', true)
      if (params.unnotifiedOnly) q = q.is('notified_at', null)
      if (params.cursor) {
        // 커서 이전 행만: total이 더 작거나, total이 같으면 job_id가 더 작은 행.
        // uuid가 아닌 jobId는 어떤 행과도 동점 비교가 성립하지 않는다 — 캐스팅
        // 400으로 페이지 전체를 죽이는 대신 동점 항만 뺀다(loadMoreJobs는 검증
        // 없는 공개 Server Action이라 임의 커서가 들어올 수 있다).
        q = q.or(isUuid(params.cursor.jobId)
          ? `total.lt.${params.cursor.total},and(total.eq.${params.cursor.total},job_id.lt.${params.cursor.jobId})`
          : `total.lt.${params.cursor.total}`)
      }
      const raw = unwrap<DashboardJoinRow[]>(await q)
      const rows = raw.map((r) => ({
        jobId: r.jobs.id, companyName: r.jobs.company_name, position: r.jobs.position,
        url: r.jobs.url, dueTime: r.jobs.due_time, bookmarked: r.jobs.bookmarked,
        total: r.total, breakdown: r.breakdown, notifiedAt: r.notified_at,
        summary: r.summary,
      }))
      const last = rows[rows.length - 1]
      return {
        rows,
        nextCursor: rows.length === params.limit && last
          ? { total: last.total, jobId: last.jobId } : null,
      }
    },

    async getJobDetail(jobId: string): Promise<ScoredJob | null> {
      if (!isUuid(jobId)) return null
      const rows = unwrap<(ScoreRow & { jobs: JobRow })[]>(
        await db.from('scores').select('*, jobs(*)').eq('job_id', jobId).limit(1),
      )
      const row = rows[0]
      return row ? { job: toJob(row.jobs), score: toScore(row) } : null
    },

    async setJobBookmarked(jobId: string, bookmarked: boolean) {
      if (!isUuid(jobId)) return
      const { error } = await db.from('jobs').update({ bookmarked }).eq('id', jobId)
      if (error) throw new Error(error.message)
    },

    async listUnscoredJobs(limit: number): Promise<UnscoredJobs> {
      // PostgREST의 `!left` embed에 건 필터는 자식(scores)만 걸러내고 부모(jobs)는
      // 제외하지 않는다 — 조건에 안 맞는 자식이 있어도 부모 행은 scores: null을
      // 단 채 그대로 돌아온다. 운영 DB(168/168 채점 완료 상태)에 직접
      // `jobs!left(scores).or('status.is.null,status.neq.ok', {referencedTable:'scores'})`를
      // 날려 확인했다 — 기대와 달리 0행이 아니라 (limit만큼) 행이 돌아왔고, 전부
      // scores: null이었다(실제로는 모든 job에 status='ok' 행이 있는데도).
      //
      // 처음엔 이걸 "넉넉히 받아 JS에서 필터 후 자르기"로 우회했지만, 그러면
      // first_seen_at 오름차순으로 서버 limit을 걸어야 해서 jobs가 그 상한을
      // 넘어가면 "가장 오래된 N건" 안에서만 골라내는 꼴이 된다 — 이 기능이 정작
      // 보여줘야 할, 방금 수집돼 아직 채점 안 된 *최신* 행이 상한 밖으로 밀려
      // 조용히 빠진다(0건인데 실제로는 대기 중인 상태). jobs_needing_score
      // (0001_init.sql)가 이미 같은 문제를 SQL 조건절로 풀어놓은 전례를 따라
      // jobs_unscored 뷰(0005 마이그레이션)를 만들어 SQL에서 판정하게 했다 — 그
      // 뷰가 이미 "미채점" 조건을 걸러 놓으므로 limit()이 진짜 상한이다.
      //
      // id 2차 정렬 키가 필요한 이유: first_seen_at은 `default now()`이고 insertJobs는
      // 한 문장으로 배치 insert한다 — 배치 전체가 같은 값을 받는다(운영 168행의
      // distinct first_seen_at은 1이다). 정렬 키가 완전히 동률이면 Postgres는 순서를
      // 약속하지 않으므로 limit N이 임의의 부분집합을 고른다. 실제로 운영에
      // limit=5와 limit=100을 날려보니 서로 다른 앞부분이 나왔다. 2차 키가 있어야
      // "상한을 넘으면 잘리는 쪽은 항상 최신 수집분"이라는 말이 성립한다.
      //
      // count는 같은 요청에 `count: 'exact'`로 붙인다 — head 질의를 따로 두면
      // 왕복이 하나 늘고 두 값이 서로 다른 시점을 보게 된다.
      const res = await db.from('jobs_unscored')
        .select('id, company_name, position, url, due_time, first_seen_at', { count: 'exact' })
        .order('first_seen_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit)
      const rows = unwrap<UnscoredJobRow[]>(res)
      return {
        rows: rows.map((r) => ({
          jobId: r.id, companyName: r.company_name, position: r.position,
          url: r.url, dueTime: r.due_time, firstSeenAt: r.first_seen_at,
        })),
        total: res.count ?? rows.length,
      }
    },

    async getDashboardStats(): Promise<DashboardStats> {
      const [jobCount, scoreRows, runRows] = await Promise.all([
        db.from('jobs').select('*', { count: 'exact', head: true }),
        db.from('scores').select('rubric_version, scored_at').eq('status', 'ok'),
        db.from('runs').select('id, pipeline, trigger, started_at, ended_at')
          .order('started_at', { ascending: false }).limit(5),
      ])
      const scores = unwrap<{ rubric_version: string; scored_at: string }[]>(scoreRows)
      const rubricVersions: Record<string, number> = {}
      for (const s of scores) rubricVersions[s.rubric_version] = (rubricVersions[s.rubric_version] ?? 0) + 1
      const scoredAt = scores.map((s) => s.scored_at).sort()
      return {
        totalJobs: jobCount.count ?? 0,
        scoredJobs: scores.length,
        lastScoredAt: scoredAt[scoredAt.length - 1] ?? null,
        rubricVersions,
        recentRuns: unwrap<{
          id: string; pipeline: RunPipeline | null; trigger: RunTrigger
          started_at: string; ended_at: string | null
        }[]>(runRows).map((r) => ({
          id: r.id, pipeline: r.pipeline, trigger: r.trigger,
          startedAt: r.started_at, endedAt: r.ended_at,
        })),
      }
    },

    async startRun(pipeline: RunPipeline, trigger: RunTrigger) {
      const row = unwrap<{ id: string }>(
        await db.from('runs').insert({ pipeline, trigger }).select('id').single(),
      )
      return row.id
    },

    async endRun(runId: string) {
      const { error } = await db.from('runs')
        .update({ ended_at: new Date().toISOString() }).eq('id', runId)
      if (error) throw new Error(error.message)
    },

    async recordNodeRun(entry: NodeRunEntry) {
      const { error } = await db.from('node_runs').insert({
        run_id: entry.runId, node: entry.node, item_id: entry.itemId,
        status: entry.status, duration_ms: entry.durationMs, error: entry.error,
      })
      if (error) throw new Error(error.message)
    },

    async __truncateAllForTests() {
      // children before parents (FKs); each table paired with a key
      // column that actually exists on it — scores' PK is job_id and
      // search_hits has no single-column PK at all.
      const tables = [
        ['node_runs', 'id'], ['runs', 'id'], ['notifications', 'id'],
        ['scores', 'job_id'], ['search_hits', 'search_id'], ['jobs', 'id'], ['searches', 'id'],
      ] as const
      for (const [table, key] of tables) {
        const { error } = await db.from(table).delete().neq(key, '00000000-0000-0000-0000-000000000000')
        if (error) throw new Error(`${table}: ${error.message}`)
      }
    },

    async __seedSearchForTests() {
      const params: SearchParams = {
        jobGroupId: '0', tagTypeIds: [], locations: [],
        yearsFrom: 0, yearsTo: 0, country: 'kr', sort: 'recommend',
      }
      const row = unwrap<{ id: string }>(
        await db.from('searches')
          .insert({ url: 'https://www.wanted.co.kr/search?query=test', params })
          .select('id').single(),
      )
      return row.id
    },
  }
}
