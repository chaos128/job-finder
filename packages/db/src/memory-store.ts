import { compareDashboardOrder } from './dashboard-order.js'
import { matchesSearchTerm, normalizeSearchTerm } from './search-term.js'
import type { Store } from './store.js'
import type {
  DashboardCursor, DashboardFilters, DashboardPage, DashboardStats,
  CompanyRating, CompanyRatingResult, DashboardRow, DedupCandidate,
  Job, JobDetail, JobDetailFields, JobRecheck, NewJob, NodeRunEntry, Notification,
  NotifyPendingRow,
  DuplicateJobs,
  Profile, RunPipeline, RunSummary, RunTrigger, Score, ScoreInput, ScoredJob, Search, Source,
  UnscoredJobs,
} from './types.js'

const MAX_ATTEMPTS = 3
/** SupabaseStore의 listNotifyCandidates와 같은 상한 — 두 구현이 같은 계약을 지켜야 한다. */
const NOTIFY_CANDIDATE_LIMIT = 200

export class MemoryStore implements Store {
  private seq = 0
  /** insertJobs 호출(=실 스토어의 한 배치) 단위로만 증가하는 수집 시각. */
  private batchSeq = 0
  readonly searches: Search[] = []
  readonly jobs = new Map<string, Job>()
  readonly hits = new Set<string>()
  readonly scores = new Map<string, Score>()
  readonly notifications = new Map<string, Notification>()
  /** notifications.attempts 컬럼에 대응. Notification 타입에는 노출하지 않는다. */
  private readonly notificationAttempts = new Map<string, number>()
  readonly nodeRuns: NodeRunEntry[] = []
  /** company_ratings 표에 대응. 키는 jobs.company_name 원문. */
  readonly companyRatings = new Map<string, {
    status: 'ok' | 'not_found'
    rating?: number; blindName?: string; blindUrl?: string
    attempts: number; fetchedAt: string
  }>()
  /** jobs.rechecked_at 컬럼에 대응. Job 타입에는 노출하지 않는다(조회 순서에만 쓴다). */
  private readonly recheckedAt = new Map<string, string>()
  readonly runs: RunSummary[] = []
  profile: Profile = {
    resumeText: 'resume',
    rubricVersion: 'v1',
    notifyEmail: 'me@example.com',
    notifyRule: { topN: 3, minScore: 60 },
  }

  private nextId(prefix: string) { return `${prefix}_${++this.seq}` }

  async listEnabledSearches() { return this.searches.filter((s) => s.enabled) }

  async findJobIdsByExternalIds(source: Source, externalIds: string[]) {
    const known = new Map<string, string>()
    for (const job of this.jobs.values()) {
      if (job.source === source && externalIds.includes(job.externalId)) {
        known.set(job.externalId, job.id)
      }
    }
    return known
  }

  async insertJobs(rows: NewJob[]) {
    const created: Job[] = []
    // 실 스토어의 first_seen_at은 `default now()`이고 insertJobs는 한 문장으로
    // 배치 insert한다 — now()는 트랜잭션 시각이라 **배치 전체가 같은 값**을 받는다
    // (운영 168행의 distinct first_seen_at이 1인 이유). 행마다 증가시키면 실 스토어에
    // 없는 순서 보장이 생겨, 계약 테스트가 없는 보장을 증명하게 된다. 호출(=배치)이
    // 바뀔 때만 증가시켜 실 스토어와 같은 모양을 만든다.
    const firstSeenAt = new Date(++this.batchSeq * 1000).toISOString()
    for (const row of rows) {
      const exists = [...this.jobs.values()].some(
        (j) => j.source === row.source && j.externalId === row.externalId,
      )
      if (exists) continue
      const id = this.nextId('job')
      const job: Job = {
        ...row,
        id,
        firstSeenAt,
        detailStatus: 'pending',
        detailAttempts: 0,
        detailError: null,
        bookmarked: false,
        hidden: false,
        duplicateOf: null,
      }
      this.jobs.set(job.id, job)
      created.push(job)
    }
    return created
  }

  async linkSearchHits(searchId: string, jobIds: string[]) {
    for (const jobId of jobIds) this.hits.add(`${searchId}:${jobId}`)
  }

  async listJobsNeedingDetail(limit: number) {
    return [...this.jobs.values()]
      .filter((j) => j.detailStatus === 'pending' && j.detailAttempts < MAX_ATTEMPTS)
      .slice(0, limit)
  }

  async saveJobDetail(jobId: string, fields: JobDetailFields) {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error(`unknown job ${jobId}`)
    // SupabaseStore와 같은 규약: 상세를 받은 것 자체가 모집 상태를 확인한 것이다.
    this.recheckedAt.set(jobId, new Date().toISOString())
    this.jobs.set(jobId, { ...job, ...fields, detailStatus: 'ok', detailError: null })
  }

  async recordDetailFailure(jobId: string, message: string) {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error(`unknown job ${jobId}`)
    // SupabaseStore와 같은 가드 — 이미 상세를 받은 job을 되돌리지 않는다.
    if (job.detailStatus !== 'pending') return
    const attempts = job.detailAttempts + 1
    this.jobs.set(jobId, {
      ...job,
      detailAttempts: attempts,
      detailError: message,
      detailStatus: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
    })
  }

  async listJobsNeedingScore(limit: number) {
    return [...this.jobs.values()]
      .filter((j) => {
        if (j.detailStatus !== 'ok') return false
        if (j.duplicateOf !== null) return false
        const score = this.scores.get(j.id)
        if (!score) return true
        return score.status === 'failed' && score.attempts < MAX_ATTEMPTS
      })
      .slice(0, limit)
  }

  async saveScore(input: ScoreInput) {
    const prev = this.scores.get(input.jobId)
    this.scores.set(input.jobId, {
      ...input,
      status: 'ok',
      attempts: prev?.attempts ?? 0,
      error: null,
      scoredAt: new Date(0).toISOString(),
      notifiedAt: prev?.notifiedAt ?? null,
    })
  }

  async recordScoreFailure(jobId: string, message: string) {
    const prev = this.scores.get(jobId)
    this.scores.set(jobId, {
      jobId,
      total: prev?.total ?? 0,
      breakdown: prev?.breakdown ?? {},
      reasoning: prev?.reasoning ?? '',
      summary: prev?.summary ?? '',
      scorer: prev?.scorer ?? 'routine',
      rubricVersion: prev?.rubricVersion ?? 'v1',
      status: 'failed',
      attempts: (prev?.attempts ?? 0) + 1,
      error: message,
      scoredAt: new Date(0).toISOString(),
      notifiedAt: prev?.notifiedAt ?? null,
    })
  }

  async getProfile() { return this.profile }

  async listNotifyCandidates(): Promise<ScoredJob[]> {
    const out: ScoredJob[] = []
    for (const score of this.scores.values()) {
      if (score.status !== 'ok' || score.notifiedAt !== null) continue
      const job = this.jobs.get(score.jobId)
      if (job && !job.hidden && job.duplicateOf === null) out.push({ job, score })
    }
    return out
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, NOTIFY_CANDIDATE_LIMIT)
  }

  async listNotifyPending(): Promise<NotifyPendingRow[]> {
    // listNotifyCandidates와 같은 대상·같은 상한이어야 한다. 컬럼만 줄인다.
    return (await this.listNotifyCandidates())
      .map(({ job, score }) => ({ total: score.total, dueTime: job.dueTime }))
  }

  async createNotification(jobIds: string[]) {
    const notification: Notification = { id: this.nextId('ntf'), status: 'pending', jobIds }
    this.notifications.set(notification.id, notification)
    return notification
  }

  async listPendingNotifications() {
    return [...this.notifications.values()].filter((n) => n.status === 'pending')
  }

  async markNotificationSent(notificationId: string) {
    const notification = this.notifications.get(notificationId)
    if (!notification) throw new Error(`unknown notification ${notificationId}`)
    this.notifications.set(notificationId, { ...notification, status: 'sent' })
    for (const jobId of notification.jobIds) {
      const score = this.scores.get(jobId)
      if (score) this.scores.set(jobId, { ...score, notifiedAt: new Date(0).toISOString() })
    }
  }

  async markNotificationFailed(notificationId: string, _message: string) {
    const notification = this.notifications.get(notificationId)
    if (!notification) throw new Error(`unknown notification ${notificationId}`)
    const attempts = (this.notificationAttempts.get(notificationId) ?? 0) + 1
    this.notificationAttempts.set(notificationId, attempts)
    // 상한에 닿으면 pending으로 되돌리지 않는다 — 영구 실패 한 건이 계속
    // pending으로 남으면 retry-first 게이트가 새 다이제스트를 영원히 막는다.
    this.notifications.set(notificationId, {
      ...notification,
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
    })
  }

  async listDashboardJobs(
    params: DashboardFilters & { cursor?: DashboardCursor; limit: number },
  ): Promise<DashboardPage> {
    // SupabaseStore와 같은 규칙: 목록은 제외 여부로 갈리고 한 페이지에 두 값이
    // 섞이지 않는다.
    const hidden = params.hiddenOnly === true
    // 중복 여부도 같은 방식의 배타 버킷이다 — 기본은 중복 아닌 것만, true면 중복만.
    // 필터를 바꾸면 이전 목록의 커서가 남아 있을 수 있다 — 소속이 다르면 버린다.
    // duplicates 축도 hidden과 같은 이유로 같이 비교한다: 이 축만 바뀐 낡은
    // 커서를 통과시키면 새 버킷의 첫 페이지가 이전 버킷 커서 이후부터 시작해
    // 상위 점수 행이 조용히 건너뛰어진다.
    const cursor = params.cursor
      && params.cursor.hidden === hidden
      ? params.cursor : undefined
    const search = normalizeSearchTerm(params.search)
    // 커서·limit을 적용하기 전 단계. 여기서 센 것이 DashboardPage.total이 된다.
    const matched = [...this.scores.values()]
      .map((score) => ({ score, job: this.jobs.get(score.jobId)! }))
      .filter(({ job, score }) =>
        job && score.status === 'ok'
        && job.hidden === hidden
        && job.duplicateOf === null
        && (params.minScore === undefined || score.total >= params.minScore)
        && (!params.bookmarkedOnly || job.bookmarked)
        && (!params.unnotifiedOnly || score.notifiedAt === null)
        // SupabaseStore의 ilike 부분 일치와 같은 뜻이어야 한다 — 두 컬럼 중 하나라도.
        && (!search || matchesSearchTerm(search, job.companyName, job.position)))
    const rows = matched
      // SupabaseStore와 같은 순서여야 한다 — 동점은 jobId 내림차순으로 가른다.
      .sort((a, b) => compareDashboardOrder(
        { hidden: a.job.hidden, total: a.score.total, jobId: a.job.id },
        { hidden: b.job.hidden, total: b.score.total, jobId: b.job.id },
      ))
      .filter(({ job, score }) => !cursor || compareDashboardOrder(
        { hidden: job.hidden, total: score.total, jobId: job.id }, cursor,
      ) > 0)
      .slice(0, params.limit)
      .map(({ job, score }) => ({
        jobId: job.id, companyName: job.companyName, position: job.position,
        url: job.url, dueTime: job.dueTime, bookmarked: job.bookmarked, hidden: job.hidden,
        source: job.source, duplicateOf: job.duplicateOf,
        total: score.total, breakdown: score.breakdown, notifiedAt: score.notifiedAt,
        summary: score.summary, blind: this.blindOf(job.companyName),
        annualFrom: job.annualFrom ?? null, annualTo: job.annualTo ?? null,
        addressDistrict: job.addressDistrict,
      }))
    const last = rows[rows.length - 1]
    return {
      rows,
      // SupabaseStore와 같은 규약: 커서를 준 요청에서는 세지 않는다.
      total: params.cursor === undefined ? matched.length : null,
      nextCursor: rows.length === params.limit && last
        ? { hidden: last.hidden, total: last.total, jobId: last.jobId }
        : null,
    }
  }

  async getJobDetail(jobId: string): Promise<JobDetail | null> {
    const job = this.jobs.get(jobId)
    const score = this.scores.get(jobId)
    return job && score ? { job, score, blind: this.blindOf(job.companyName) } : null
  }

  /** SupabaseStore와 같은 규칙: status='ok'인 행만 별점으로 노출한다. */
  private blindOf(companyName: string): CompanyRating | null {
    const r = this.companyRatings.get(companyName)
    if (!r || r.status !== 'ok' || r.rating === undefined) return null
    return { rating: r.rating, blindName: r.blindName ?? '', blindUrl: r.blindUrl ?? '' }
  }

  async setJobBookmarked(jobId: string, bookmarked: boolean) {
    const job = this.jobs.get(jobId)
    if (job) this.jobs.set(jobId, { ...job, bookmarked })
  }

  async setJobHidden(jobId: string, hidden: boolean) {
    const job = this.jobs.get(jobId)
    if (job) this.jobs.set(jobId, { ...job, hidden })
  }

  async listUnscoredJobs(limit: number): Promise<UnscoredJobs> {
    const matched = [...this.jobs.values()]
      // duplicate_of를 함께 거르는 이유(jobs_unscored 뷰·0013과 같은 조건이어야 한다):
      // 중복은 채점 큐에서 빠져 영원히 채점되지 않으므로 "점수가 없다"는 조건에
      // 영원히 걸린다 — 안 거르면 미채점 목록에 영구 거주한다.
      .filter((job) => !job.hidden && !job.duplicateOf && this.scores.get(job.id)?.status !== 'ok')
      // SupabaseStore와 같은 정렬 규칙 — 한 배치는 first_seen_at이 전부 같으므로
      // id를 2차 키로 써야 limit이 달라져도 같은 앞부분이 나온다.
      .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id))
    return {
      rows: matched.slice(0, limit).map((job) => ({
        jobId: job.id, companyName: job.companyName, position: job.position,
        url: job.url, dueTime: job.dueTime, firstSeenAt: job.firstSeenAt,
      })),
      total: matched.length,
    }
  }

  async listDuplicateJobs(limit: number): Promise<DuplicateJobs> {
    const matched = [...this.jobs.values()]
      .filter((job) => job.duplicateOf !== null)
      // listUnscoredJobs와 같은 정렬 규칙 — 한 배치는 firstSeenAt이 전부 같으므로
      // id를 2차 키로 써야 limit이 달라져도 같은 앞부분이 나온다.
      .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id))
    return {
      rows: matched.slice(0, limit).map((job) => ({
        jobId: job.id, companyName: job.companyName, position: job.position,
        url: job.url, dueTime: job.dueTime, firstSeenAt: job.firstSeenAt,
        source: job.source, duplicateOf: job.duplicateOf!,
      })),
      total: matched.length,
    }
  }

  async getDashboardStats(): Promise<DashboardStats> {
    // SupabaseStore와 같은 필터 — 실패한 채점(status: 'failed')이 남긴 자리표시자
    // 값(rubricVersion 'v1', scoredAt 0)이 분포와 최종 채점 시각을 오염시키면 안 된다.
    const scores = [...this.scores.values()].filter((s) => s.status === 'ok')
    const rubricVersions: Record<string, number> = {}
    for (const s of scores) rubricVersions[s.rubricVersion] = (rubricVersions[s.rubricVersion] ?? 0) + 1
    const scoredAt = scores.map((s) => s.scoredAt).sort()
    return {
      // SupabaseStore와 같은 조건 — 중복은 채점 큐에서 빠져 영원히 채점되지 않으므로
      // 분모에 넣으면 "채점 진행"이 100%에 영원히 못 닿는다(실측 348/369에서 멈췄다).
      totalJobs: [...this.jobs.values()].filter((j) => j.duplicateOf === null).length,
      scoredJobs: scores.length,
      lastScoredAt: scoredAt[scoredAt.length - 1] ?? null,
      rubricVersions,
      recentRuns: [...this.runs].reverse().slice(0, 5).map((r) => ({ ...r })),
    }
  }

  async listJobsNeedingRecheck(limit: number, staleDays: number): Promise<Job[]> {
    const cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000
    return [...this.jobs.values()]
      // 중복을 빼는 이유(SupabaseStore와 같은 조건): 중복은 채점·발송·기본 목록
      // 어디에도 안 나오므로 아직 열려 있는지 확인해봐야 그 답을 읽는 화면이 없다.
      // 상세 조회와 달리 재확인은 staleDays마다 영구 반복이라 비용 구조가 다르다.
      .filter((j) => !j.hidden && j.duplicateOf === null && j.detailStatus === 'ok')
      .filter((j) => {
        const at = this.recheckedAt.get(j.id)
        return at === undefined || Date.parse(at) <= cutoff
      })
      // 한 번도 확인 안 한 것이 먼저, 그다음 오래된 순(SupabaseStore와 같은 순서).
      .sort((a, b) => {
        const ta = this.recheckedAt.get(a.id)
        const tb = this.recheckedAt.get(b.id)
        if (ta === tb) return 0
        if (ta === undefined) return -1
        if (tb === undefined) return 1
        return ta < tb ? -1 : 1
      })
      .slice(0, limit)
  }

  async recordJobRecheck(jobId: string, result: JobRecheck) {
    const job = this.jobs.get(jobId)
    if (!job) return
    this.recheckedAt.set(jobId, new Date().toISOString())
    this.jobs.set(jobId, {
      ...job,
      dueTime: result.dueTime,
      // 닫혔을 때만 켠다. 열려 있다고 끄지 않는다 — 손으로 제외해 둔 공고가 되살아난다.
      hidden: result.closed ? true : job.hidden,
    })
  }

  async listCompaniesNeedingRating(limit: number, staleDays: number): Promise<string[]> {
    const cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000
    const names = [...new Set([...this.jobs.values()].map((j) => j.companyName))]
    return names
      .filter((n) => {
        const r = this.companyRatings.get(n)
        return !r || Date.parse(r.fetchedAt) <= cutoff
      })
      // 오래된 것부터. 아직 행이 없는 회사가 가장 먼저다(SupabaseStore와 같은 순서).
      .sort((a, b) => {
        const ta = this.companyRatings.get(a)?.fetchedAt
        const tb = this.companyRatings.get(b)?.fetchedAt
        if (ta === tb) return 0
        if (ta === undefined) return -1
        if (tb === undefined) return 1
        return ta < tb ? -1 : 1
      })
      .slice(0, limit)
  }

  async saveCompanyRating(result: CompanyRatingResult) {
    const prev = this.companyRatings.get(result.companyName)
    this.companyRatings.set(result.companyName, result.status === 'ok'
      ? {
        status: 'ok', rating: result.rating, blindName: result.blindName, blindUrl: result.blindUrl,
        attempts: prev?.attempts ?? 0, fetchedAt: new Date().toISOString(),
      }
      : { status: 'not_found', attempts: prev?.attempts ?? 0, fetchedAt: new Date().toISOString() })
  }

  async recordCompanyRatingFailure(companyName: string, message: string) {
    const prev = this.companyRatings.get(companyName)
    // 실패는 fetchedAt을 올리지 않는다 — 올리면 staleDays 동안 재시도가 막힌다.
    // 다음 실행이 곧바로 다시 집도록 두고 attempts만 센다.
    this.companyRatings.set(companyName, {
      status: prev?.status ?? 'not_found',
      rating: prev?.rating, blindName: prev?.blindName, blindUrl: prev?.blindUrl,
      attempts: (prev?.attempts ?? 0) + 1,
      fetchedAt: prev?.fetchedAt ?? new Date(0).toISOString(),
    })
    void message
  }

  async startRun(pipeline: RunPipeline, trigger: RunTrigger) {
    const id = this.nextId('run')
    this.runs.push({ id, pipeline, trigger, startedAt: new Date(0).toISOString(), endedAt: null })
    return id
  }

  async endRun(runId: string) {
    const run = this.runs.find((r) => r.id === runId)
    if (run) run.endedAt = new Date(0).toISOString()
  }
  async recordNodeRun(entry: NodeRunEntry) { this.nodeRuns.push(entry) }

  async listDedupIndex(): Promise<DedupCandidate[]> {
    return [...this.jobs.values()]
      .filter((j) => j.duplicateOf === null && !j.hidden)
      // insertJobs가 이미 (firstSeenAt, id) 순으로 행을 내놓으므로(id가 배치 순서로
      // 매겨지는 단조 카운터고 Map은 삽입 순서를 유지한다) 이 구현에서는 사실 no-op이다.
      // 그래도 지우면 안 된다 — SupabaseStore가 `.order()`로 강제하는 것과 같은 정렬
      // 계약을 이 구현도 명시적으로 선언해 두는 것이고, 계약 테스트는 이 줄이 사라져도
      // 잡아내지 못한다(두 구현의 자연스러운 순서가 우연히 같기 때문).
      .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id))
      .map((j) => ({ id: j.id, source: j.source, companyName: j.companyName, position: j.position }))
  }

  async markDuplicates(pairs: Array<{ jobId: string; duplicateOf: string }>) {
    for (const { jobId, duplicateOf } of pairs) {
      const job = this.jobs.get(jobId)
      if (!job) continue
      this.jobs.set(jobId, { ...job, duplicateOf })
    }
  }
}
