import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { normalizeSearchTerm, toIlikePattern } from './search-term.js'
import type { Store } from './store.js'
import type {
  DashboardCursor, DashboardFilters, DashboardPage, DashboardStats,
  DedupCandidate, Job, JobDetailFields, NewJob, NodeRunEntry, Notification,
  CompanyRating, CompanyRatingResult, JobDetail, JobRecheck,
  NotifyPendingRow, NotifyRule, Profile, RunPipeline, RunTrigger, Score, ScoreInput, ScoredJob, Search,
  SearchParams, Source, UnscoredJobs, DuplicateJobs,
} from './types.js'

const MAX_ATTEMPTS = 3

/**
 * 알림 후보는 단조 증가한다 — minScore 미달로 영영 메일에 안 실리는 공고는
 * notified_at이 계속 NULL이라 매 실행마다 다시 조회된다. total desc 정렬이므로
 * 상위 200만 받아도 selectForDigest(topN 3)의 결과는 같다.
 */
const NOTIFY_CANDIDATE_LIMIT = 200

interface CompanyRatingRow {
  company_name: string; status: string
  rating: number | string | null; blind_name: string | null; blind_url: string | null
  fetched_at: string
}

/** 알림 대기 건수용 — 세는 데 필요한 두 칸만. */
const NOTIFY_PENDING_SELECT = 'total, jobs!inner(due_time)' as const

/**
 * 다이제스트가 쓰는 것만 가져온다 — JD 본문(intro/requirements/…)과
 * raw(Wanted 상세 응답 원본)는 메일에 한 글자도 안 쓰이면서 후보 수에 비례해
 * 페이로드를 키운다. 나머지 스칼라 컬럼은 Job 타입을 채우기 위한 것이고 작다.
 */
const NOTIFY_CANDIDATE_SELECT = `*, jobs(
  id, source, external_id, position, company_name, company_id,
  address_district, address_full, url, due_time, first_seen_at,
  detail_status, detail_attempts, detail_error, bookmarked, hidden, duplicate_of
)`

// raw와 JD 본문은 제외한다 — 목록에서 쓰지 않는데 가장 크다. reasoning도 뺐다 —
// 채점 근거 전문은 상세에서만 쓰고, 목록 요약은 채점 시 함께 받은 summary를 그대로 싣는다.
const DASHBOARD_SELECT =
  'total, breakdown, notified_at, summary, jobs!inner(id, company_name, position, url, due_time, bookmarked, hidden, source, duplicate_of, annual_from, annual_to, address_district)'

interface JobRow {
  id: string; source: string; external_id: string; position: string
  rechecked_at?: string | null
  annual_from: number | null; annual_to: number | null
  company_name: string; company_id: number | null
  address_district: string | null; address_full: string | null
  url: string; due_time: string | null
  intro: string | null; requirements: string | null; main_tasks: string | null
  preferred_points: string | null; benefits: string | null
  skill_tags: string[]; raw: unknown; first_seen_at: string
  detail_status: string; detail_attempts: number; detail_error: string | null
  bookmarked: boolean; hidden: boolean
  duplicate_of: string | null
}

interface SearchRow {
  id: string; source: Source; url: string; params: SearchParams; enabled: boolean
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
    source: Source; duplicate_of: string | null
    annual_from: number | null; annual_to: number | null
    address_district: string | null
  }
}

/** jobs_unscored 뷰(0005 마이그레이션)의 컬럼. jobs.*와 같은 모양이지만 이 목록에는
 *  네 컬럼만 있으면 된다. */
type UnscoredJobRow = {
  id: string; company_name: string; position: string; url: string
  due_time: string | null; first_seen_at: string
}

type DuplicateJobRow = UnscoredJobRow & { source: Source; duplicate_of: string }

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
    annualFrom: row.annual_from ?? null,
    annualTo: row.annual_to ?? null,
    firstSeenAt: row.first_seen_at,
    detailStatus: row.detail_status as Job['detailStatus'],
    detailAttempts: row.detail_attempts,
    detailError: row.detail_error,
    bookmarked: row.bookmarked,
    hidden: row.hidden,
    duplicateOf: row.duplicate_of,
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
  __seedSearchForTests(source?: Source): Promise<string>
}

export function createSupabaseStore(url: string, serviceKey: string): SupabaseStore {
  const db: SupabaseClient = createClient(url, serviceKey, {
    auth: { persistSession: false },
  })

  /**
   * 회사명 → 별점. company_ratings를 jobs에 embed하지 않고 따로 물어 JS에서 잇는 이유:
   * PostgREST의 embed는 FK 관계를 요구하는데, 여기 조인 키는 FK가 아닌 company_name
   * 텍스트다. jobs에 FK를 걸려면 모든 회사가 company_ratings에 먼저 있어야 해서
   * 순서가 뒤집힌다. 함수는 icn1, DB도 서울이라 왕복 하나가 15ms 남짓이다.
   */
  async function fetchRatings(companyNames: string[]): Promise<Map<string, CompanyRating>> {
    const uniq = [...new Set(companyNames)]
    if (uniq.length === 0) return new Map()
    const res = await db.from('company_ratings')
      .select('company_name, status, rating, blind_name, blind_url, fetched_at')
      .in('company_name', uniq).eq('status', 'ok')
    if (res.error) {
      // 여기서 throw하면 별점 표가 없다는 이유로 목록 전체가 500이 된다.
      // 마이그레이션은 사람이 손으로 적용하는데 배포는 push하면 자동이라, 표가 아직
      // 없는 구간이 실제로 생긴다(0006). 별점은 장식이고 목록이 제품이므로 그 구간에는
      // 별점만 빠진 채로 뜨게 둔다 — 노드가 처음 도는 순간부터 자연히 채워진다.
      return new Map()
    }
    const rows = res.data ?? []
    const out = new Map<string, CompanyRating>()
    for (const r of rows) {
      // numeric은 postgrest-js가 문자열로 줄 수 있다(정밀도 손실 방지). 숫자로 고정한다.
      const rating = Number(r.rating)
      if (!Number.isFinite(rating)) continue
      out.set(r.company_name, {
        rating, blindName: r.blind_name ?? '', blindUrl: r.blind_url ?? '',
      })
    }
    return out
  }

  return {
    async listEnabledSearches(): Promise<Search[]> {
      const rows = unwrap<SearchRow[]>(
        await db.from('searches').select('*').eq('enabled', true),
      )
      return rows.map((r) => ({
        id: r.id, source: r.source, url: r.url, params: r.params, enabled: r.enabled,
      }))
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
        // 상세를 받은 것 자체가 모집 상태를 확인한 것이다. 여기서 안 남기면 방금
        // 수집한 공고가 같은 실행의 재확인 노드에 잡혀 같은 API를 한 번 더 부른다.
        rechecked_at: new Date().toISOString(),
        annual_from: fields.annualFrom, annual_to: fields.annualTo,
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
          .eq('status', 'ok').is('notified_at', null).is('jobs.duplicate_of', null)
          .order('total', { ascending: false }).limit(NOTIFY_CANDIDATE_LIMIT),
      )

      // jobs는 !inner가 아닌 평범한 embed라, duplicate_of 필터에 안 맞는 행은
      // embed가 null로 돌아올 뿐 부모(score) 행 자체가 빠지지는 않는다 —
      // r.jobs 존재 확인이 그 불일치를 걸러낸다. hidden은 이 쿼리에 필터를
      // 걸지 않았으므로 아래 !r.jobs.hidden이 제외의 유일한 수단이다 — 지우면
      // 제외된 공고가 다이제스트로 샌다. duplicate_of를 JS에서 한 번 더
      // 확인하는 것은 이 스토어가 실 Supabase로 테스트되지 않는 환경이라
      // 붙인 방어선이다(중복이 새어 나가면 다이제스트 슬롯을 뺏는다).
      return rows
        .filter((r) => r.jobs && !r.jobs.hidden && r.jobs.duplicate_of === null)
        .map((r) => ({ job: toJob(r.jobs), score: toScore(r) }))
    },

    async listNotifyPending(): Promise<NotifyPendingRow[]> {
      // listNotifyCandidates와 같은 대상·같은 상한. 다른 건 컬럼뿐이다 — 저쪽은
      // 다이제스트 본문을 만들어야 해서 공고를 통째로 받는데(실측 134건 320ms),
      // 여기는 건수만 세면 되므로 두 칸만 받는다. hidden 제외는 `!inner` embed에
      // 건 평범한 필터라 부모까지 걸러진다(`!left`와 다르다 — listUnscoredJobs 주석 참고).
      // select에 `*`가 없어 postgrest-js가 1:1 embed를 배열로 추론한다 —
      // DASHBOARD_SELECT와 같은 이유로 결과 타입을 직접 지정해 우회한다.
      type Row = { total: number; jobs: { due_time: string | null } }
      const rows = unwrap<Row[]>(
        await db.from('scores').select<typeof NOTIFY_PENDING_SELECT, Row>(NOTIFY_PENDING_SELECT)
          .eq('status', 'ok').is('notified_at', null).eq('jobs.hidden', false)
          .is('jobs.duplicate_of', null)
          .order('total', { ascending: false }).limit(NOTIFY_CANDIDATE_LIMIT),
      )
      return rows.map((r) => ({ total: r.total, dueTime: r.jobs.due_time }))
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
      // 목록은 제외 여부로 갈린다 — 기본은 제외되지 않은 것만, hiddenOnly면 제외된
      // 것만 준다. 한 페이지에 두 값이 섞이지 않으므로 질의도 하나면 된다.
      // (예전에는 "전체를 주되 제외분을 뒤로" 정렬하느라 버킷 두 개를 이어붙였다.
      //  PostgREST의 or()/and() 로직 트리 파서가 임베드 컬럼 참조를 못 받아
      //  `jobs.hidden`을 커서에 섞을 수 없었기 때문인데, 이제 필요가 없어졌다.)
      const hidden = params.hiddenOnly === true
      // 중복 여부도 같은 방식의 배타 버킷이다 — 기본은 중복 아닌 것만, true면 중복만.

      // `!inner` + 명시적 컬럼 목록이라 select 문자열에 `*`가 없다 — postgrest-js는
      // Database 제네릭 없이는 1:1 embed의 카디널리티를 알 수 없어 jobs를 배열로
      // 추론한다(런타임 값은 실제로는 객체). 결과 타입을 직접 지정해 우회한다.
      const search = normalizeSearchTerm(params.search)
      // 총량은 필터가 바뀔 때만 달라진다 — 커서가 있는 이어보기 요청에서는 세지
      // 않는다. count는 필터에만 걸리고 limit·range와 무관하므로(실측: Range 0-4에
      // 105 반환), 첫 페이지에서 한 번 세면 그 필터 조합의 전체 건수가 된다.
      const counting = params.cursor === undefined
      let q = db.from('scores')
        .select<typeof DASHBOARD_SELECT, DashboardJoinRow>(
          DASHBOARD_SELECT, counting ? { count: 'exact' } : {},
        )
        .eq('status', 'ok').eq('jobs.hidden', hidden)
        .order('total', { ascending: false })
        .order('job_id', { ascending: false })
        .limit(params.limit)
      // 중복은 이 목록에 아예 오지 않는다. 별도 조회(listDuplicateJobs)가 낸다 —
      // 이 질의는 scores에서 출발해서 점수 없는 행을 표현할 수 없다.
      q = q.is('jobs.duplicate_of', null)
      if (params.minScore !== undefined) q = q.gte('total', params.minScore)
      if (params.bookmarkedOnly) q = q.eq('jobs.bookmarked', true)
      if (params.unnotifiedOnly) q = q.is('notified_at', null)
      // 임베드 컬럼 둘을 or로 묶는다. CLAUDE.md가 경고하는 함정(로직 트리가 임베드
      // 컬럼 참조를 못 받는다)은 **최상위** or에 `jobs.x`를 섞을 때의 이야기다 —
      // referencedTable로 트리 자체를 jobs에 붙이면(`jobs.or=(...)`) 통과하고,
      // `!inner`라 부모 행까지 제대로 걸러진다(실측 확인).
      if (search) {
        const pattern = toIlikePattern(search)
        q = q.or(`company_name.ilike.${pattern},position.ilike.${pattern}`, {
          referencedTable: 'jobs',
        })
      }
      // 필터를 바꾸면 이전 목록의 커서가 남아 있을 수 있다. 그 커서로 새 목록을
      // 태우면 두 질의의 결과가 한 목록에 이어붙는다 — 소속이 다르면 버린다.
      // duplicates 축도 hidden과 같은 이유로 같이 비교한다: 이 축만 바뀐 낡은
      // 커서를 통과시키면 새 버킷의 첫 페이지가 이전 버킷 커서 이후부터 시작해
      // 상위 점수 행이 조용히 건너뛰어진다.
      const cursor = params.cursor
        && params.cursor.hidden === hidden
        ? params.cursor : undefined
      if (cursor) {
        // 커서 이전 행만: total이 더 작거나, total이 같으면 job_id가 더 작은 행.
        // uuid가 아닌 jobId는 어떤 행과도 동점 비교가 성립하지 않는다 — 캐스팅
        // 400으로 페이지 전체를 죽이는 대신 동점 항만 뺀다(loadMoreJobs는 검증
        // 없는 공개 Server Action이라 임의 커서가 들어올 수 있다).
        q = q.or(isUuid(cursor.jobId)
          ? `total.lt.${cursor.total},and(total.eq.${cursor.total},job_id.lt.${cursor.jobId})`
          : `total.lt.${cursor.total}`)
      }
      // count를 함께 받아야 해서 unwrap을 쓰지 않는다 — 응답 객체 자체가 필요하다.
      const res = await q
      if (res.error) throw new Error(res.error.message)
      const rows = (res.data ?? []).map((r) => ({
        jobId: r.jobs.id, companyName: r.jobs.company_name, position: r.jobs.position,
        url: r.jobs.url, dueTime: r.jobs.due_time, bookmarked: r.jobs.bookmarked, hidden,
        source: r.jobs.source, duplicateOf: r.jobs.duplicate_of,
        total: r.total, breakdown: r.breakdown, notifiedAt: r.notified_at,
        summary: r.summary,
        annualFrom: r.jobs.annual_from ?? null, annualTo: r.jobs.annual_to ?? null,
        addressDistrict: r.jobs.address_district,
      }))

      // 페이지가 확정된 뒤에 별점을 붙인다 — 버킷별로 물으면 왕복이 두 번 난다.
      const ratings = await fetchRatings(rows.map((r) => r.companyName))
      const withBlind = rows.map((r) => ({ ...r, blind: ratings.get(r.companyName) ?? null }))

      const last = withBlind[withBlind.length - 1]
      return {
        rows: withBlind,
        nextCursor: withBlind.length === params.limit && last
          ? { hidden: last.hidden, total: last.total, jobId: last.jobId }
          : null,
        // count를 요청하지 않은 이어보기 응답에서는 null이다(PostgREST도 null을 준다).
        total: counting ? res.count ?? null : null,
      }
    },

    async getJobDetail(jobId: string): Promise<JobDetail | null> {
      if (!isUuid(jobId)) return null
      const rows = unwrap<(ScoreRow & { jobs: JobRow })[]>(
        await db.from('scores').select('*, jobs(*)').eq('job_id', jobId).limit(1),
      )
      const row = rows[0]
      if (!row) return null
      const job = toJob(row.jobs)
      const blind = (await fetchRatings([job.companyName])).get(job.companyName) ?? null
      return { job, score: toScore(row), blind }
    },

    async setJobBookmarked(jobId: string, bookmarked: boolean) {
      if (!isUuid(jobId)) return
      const { error } = await db.from('jobs').update({ bookmarked }).eq('id', jobId)
      if (error) throw new Error(error.message)
    },

    async setJobHidden(jobId: string, hidden: boolean) {
      if (!isUuid(jobId)) return
      const { error } = await db.from('jobs').update({ hidden }).eq('id', jobId)
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

    async listDuplicateJobs(limit: number): Promise<DuplicateJobs> {
      // jobs에서 바로 고른다 — listDashboardJobs처럼 scores에서 출발하면 언제나
      // 0건이다(중복은 채점 큐에서 빠져 점수 행이 안 생긴다). 뷰가 필요하지 않은
      // 것은 조건이 컬럼 하나이기 때문이다.
      //
      // 정렬·count 규약은 listUnscoredJobs와 같다: first_seen_at은 배치 전체가
      // 같은 값이라 id를 2차 키로 써야 상한이 달라져도 같은 앞부분이 나오고,
      // count는 같은 요청에 붙여 두 값이 다른 시점을 보지 않게 한다.
      const res = await db.from('jobs')
        .select('id, source, company_name, position, url, due_time, first_seen_at, duplicate_of',
          { count: 'exact' })
        .not('duplicate_of', 'is', null)
        .order('first_seen_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit)
      const rows = unwrap<DuplicateJobRow[]>(res)
      return {
        rows: rows.map((r) => ({
          jobId: r.id, companyName: r.company_name, position: r.position,
          url: r.url, dueTime: r.due_time, firstSeenAt: r.first_seen_at,
          source: r.source, duplicateOf: r.duplicate_of,
        })),
        total: res.count ?? rows.length,
      }
    },

    async getDashboardStats(): Promise<DashboardStats> {
      const [jobCount, scoreRows, runRows] = await Promise.all([
        // 중복은 채점 큐에서 빠져 영원히 채점되지 않는다 — 분모에 넣으면
        // "채점 진행"이 100%에 영원히 못 닿는다(실측 348/369에서 멈췄다).
        db.from('jobs').select('*', { count: 'exact', head: true }).is('duplicate_of', null),
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

    async listJobsNeedingRecheck(limit: number, staleDays: number): Promise<Job[]> {
      // 한 번도 확인 안 한 행(rechecked_at is null)이 먼저 와야 한다. PostgREST의
      // order는 nullsFirst를 지원하므로 그 한 질의로 끝난다.
      const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString()
      const rows = unwrap<JobRow[]>(
        await db.from('jobs').select('*')
          // 중복은 재확인하지 않는다 — 채점·발송·기본 목록 어디에도 안 나오므로
          // 답을 읽는 화면이 없는데, 재확인은 staleDays마다 영구 반복된다.
          // (jobs_recheck_idx의 부분 인덱스 조건보다 좁으므로 인덱스는 그대로 쓰인다.)
          .eq('hidden', false).is('duplicate_of', null).eq('detail_status', 'ok')
          .or(`rechecked_at.is.null,rechecked_at.lte.${cutoff}`)
          .order('rechecked_at', { ascending: true, nullsFirst: true })
          .limit(limit),
      )
      return rows.map(toJob)
    },

    async recordJobRecheck(jobId: string, result: JobRecheck) {
      if (!isUuid(jobId)) return
      const { error } = await db.from('jobs').update({
        rechecked_at: new Date().toISOString(),
        due_time: result.dueTime,
        // 닫혔을 때만 켠다. 열려 있다고 끄는 문장을 넣으면 손으로 제외해 둔 공고가
        // 재확인 한 번에 되살아난다.
        ...(result.closed ? { hidden: true } : {}),
      }).eq('id', jobId)
      if (error) throw new Error(error.message)
    },

    async listCompaniesNeedingRating(limit: number, staleDays: number): Promise<string[]> {
      // 두 질의로 나눈다. jobs와 company_ratings 사이에 FK가 없어 PostgREST가
      // anti-join(= 별점 행이 없는 회사)을 표현하지 못하기 때문이다. 회사 수가
      // 수백 규모(운영 187곳)라 전량을 받아 JS에서 빼도 페이로드가 작다.
      const jobRows = unwrap<Array<{ company_name: string }>>(
        await db.from('jobs').select('company_name'),
      )
      const ratingRows = unwrap<Array<{ company_name: string; fetched_at: string }>>(
        await db.from('company_ratings').select('company_name, fetched_at'),
      )
      const fetchedAt = new Map(ratingRows.map((r) => [r.company_name, r.fetched_at]))
      const cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000

      return [...new Set(jobRows.map((r) => r.company_name))]
        .filter((n) => {
          const at = fetchedAt.get(n)
          return at === undefined || Date.parse(at) <= cutoff
        })
        // 아직 조회한 적 없는 회사가 먼저, 그다음 오래된 순. MemoryStore와 같은 순서다.
        .sort((a, b) => {
          const ta = fetchedAt.get(a)
          const tb = fetchedAt.get(b)
          if (ta === tb) return 0
          if (ta === undefined) return -1
          if (tb === undefined) return 1
          return ta < tb ? -1 : 1
        })
        .slice(0, limit)
    },

    async saveCompanyRating(result: CompanyRatingResult) {
      // 두 분기의 모양을 하나로 고정한다 — 유니온으로 두면 postgrest-js의
      // upsert 오버로드가 첫 분기 모양만 받아들여 타입 에러가 난다.
      const row: {
        company_name: string; status: string; rating: number | null
        blind_name: string | null; blind_url: string | null
        error: string | null; fetched_at: string
      } = result.status === 'ok'
        ? {
          company_name: result.companyName, status: 'ok', rating: result.rating,
          blind_name: result.blindName, blind_url: result.blindUrl,
          error: null, fetched_at: new Date().toISOString(),
        }
        : {
          company_name: result.companyName, status: 'not_found', rating: null,
          blind_name: null, blind_url: null, error: null, fetched_at: new Date().toISOString(),
        }
      // attempts는 일부러 빼서 upsert가 기존 값을 보존하게 둔다(merge-duplicates는
      // 생략한 컬럼을 건드리지 않는다). 성공했다고 실패 이력까지 지울 이유는 없다.
      const { error } = await db.from('company_ratings')
        .upsert(row, { onConflict: 'company_name' })
      if (error) throw new Error(error.message)
    },

    async recordCompanyRatingFailure(companyName: string, message: string) {
      const rows = unwrap<Array<{ attempts: number }>>(
        await db.from('company_ratings').select('attempts').eq('company_name', companyName).limit(1),
      )
      // status와 fetched_at은 기존 행에 손대지 않는다. status를 건드리면 일시적
      // 네트워크 실패 한 번이 멀쩡한 'ok' 별점을 'not_found'로 덮고, fetched_at을
      // 올리면 staleDays 동안 재시도가 막힌다. 행이 없을 때만 두 값을 새로 넣되
      // fetched_at은 과거 시각으로 둬 다음 실행이 곧바로 다시 집게 한다.
      const { error } = await db.from('company_ratings').upsert({
        company_name: companyName,
        attempts: (rows[0]?.attempts ?? 0) + 1,
        error: message,
        ...(rows[0] ? {} : { status: 'not_found', fetched_at: new Date(0).toISOString() }),
      }, { onConflict: 'company_name' })
      if (error) throw new Error(error.message)
    },

    async listDedupIndex(): Promise<DedupCandidate[]> {
      // 전량을 받아 JS에서 맞춘다. listCompaniesNeedingRating과 같은 방식으로,
      // 수백 행 규모라 페이로드가 작고 정규화 규칙이 SQL로 새어 나가지 않는다.
      const rows = unwrap<Array<{
        id: string; source: Source; company_name: string; position: string
      }>>(
        await db.from('jobs').select('id, source, company_name, position')
          .is('duplicate_of', null).eq('hidden', false)
          .order('first_seen_at', { ascending: true }).order('id', { ascending: true }),
      )
      return rows.map((r) => ({
        id: r.id, source: r.source, companyName: r.company_name, position: r.position,
      }))
    },

    async markDuplicates(pairs: Array<{ jobId: string; duplicateOf: string }>) {
      // 건별 update다. 한 실행에서 나오는 중복은 많아야 몇 건이고,
      // PostgREST의 배치 update는 같은 값으로만 가능해 쌍마다 다른 값을 못 싣는다.
      for (const { jobId, duplicateOf } of pairs) {
        if (!isUuid(jobId) || !isUuid(duplicateOf)) continue
        const { error } = await db.from('jobs')
          .update({ duplicate_of: duplicateOf }).eq('id', jobId)
        if (error) throw new Error(error.message)
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
        // company_ratings는 FK가 없어 순서는 상관없지만, 빠뜨리면 테스트 사이에
        // 별점이 남아 다음 테스트의 listCompaniesNeedingRating이 빈 목록을 본다.
        // 키가 텍스트라 아래 uuid 리터럴과는 어차피 전부 다르다.
        ['company_ratings', 'company_name'],
      ] as const
      for (const [table, key] of tables) {
        const { error } = await db.from(table).delete().neq(key, '00000000-0000-0000-0000-000000000000')
        if (error) throw new Error(`${table}: ${error.message}`)
      }
    },

    async __seedSearchForTests(source: Source = 'wanted') {
      const params: SearchParams = source === 'wanted'
        ? {
          source: 'wanted', jobGroupId: '0', tagTypeIds: [], locations: [],
          yearsFrom: 0, yearsTo: 0, country: 'kr', sort: 'recommend',
        }
        : {
          source: 'remember', jobCategoryNames: [], addresses: [],
          organizationType: null, minExperience: null,
        }
      const row = unwrap<{ id: string }>(
        await db.from('searches')
          .insert({ source, url: 'https://www.wanted.co.kr/search?query=test', params })
          .select('id').single(),
      )
      return row.id
    },
  }
}
