import type {
  DashboardCursor, DashboardFilters, DashboardPage, DashboardStats,
  CompanyRatingResult, DedupCandidate, DuplicateJobs, Job, JobDetail, JobDetailFields,
  JobRecheck, NewJob,
  NodeRunEntry,
  Notification,
  NotifyPendingRow,
  Profile, RunPipeline, RunTrigger, ScoreInput, ScoredJob, Search, Source, UnscoredJobs,
} from './types.js'

export interface Store {
  // ── discover
  listEnabledSearches(): Promise<Search[]>
  /** externalId → jobId. 이미 아는 공고를 걸러내고, 그 id로 search_hits를 잇는 데 함께 쓴다. */
  findJobIdsByExternalIds(source: Source, externalIds: string[]): Promise<Map<string, string>>
  insertJobs(rows: NewJob[]): Promise<Job[]>
  linkSearchHits(searchId: string, jobIds: string[]): Promise<void>

  // ── fetchDetail
  listJobsNeedingDetail(limit: number): Promise<Job[]>
  saveJobDetail(jobId: string, fields: JobDetailFields): Promise<void>
  recordDetailFailure(jobId: string, message: string): Promise<void>

  // ── score (routine이 HTTP로 호출)
  listJobsNeedingScore(limit: number): Promise<Job[]>
  saveScore(input: ScoreInput): Promise<void>
  recordScoreFailure(jobId: string, message: string): Promise<void>

  // ── notify
  getProfile(): Promise<Profile>
  listNotifyCandidates(): Promise<ScoredJob[]>
  createNotification(jobIds: string[]): Promise<Notification>
  listPendingNotifications(): Promise<Notification[]>
  markNotificationSent(notificationId: string): Promise<void>
  markNotificationFailed(notificationId: string, message: string): Promise<void>

  // ── 대시보드 조회
  listDashboardJobs(
    params: DashboardFilters & { cursor?: DashboardCursor; limit: number },
  ): Promise<DashboardPage>
  getJobDetail(jobId: string): Promise<JobDetail | null>
  getDashboardStats(): Promise<DashboardStats>
  /**
   * listNotifyCandidates와 같은 대상(status ok · 미발송 · 제외 안 됨)을 같은 상한으로
   * 주되, 세는 데 필요한 두 컬럼만 준다. 남은 조건(minScore·만료)은 selectForDigest와
   * 같게 호출자가 적용한다 — 만료 기준(KST 오늘)이 SQL로 새어 나가지 않게.
   */
  listNotifyPending(): Promise<NotifyPendingRow[]>
  setJobBookmarked(jobId: string, bookmarked: boolean): Promise<void>
  setJobHidden(jobId: string, hidden: boolean): Promise<void>
  /**
   * 아직 status='ok' 점수가 없는 공고. 채점 실패분도 포함한다.
   * 오래된 수집분부터 limit건까지 주고, 잘리기 전 총량을 함께 준다.
   */
  listUnscoredJobs(limit: number): Promise<UnscoredJobs>
  /**
   * 중복으로 표시된 공고. 점수 목록(listDashboardJobs)으로는 낼 수 없어 별도 조회다 —
   * 그 질의는 scores에서 출발하는데 중복은 채점 큐에서 빠져 점수 행이 영영 안 생긴다.
   * 미채점 목록과 같은 모양·같은 상한 방식이고, 오래된 수집분부터 준다.
   */
  listDuplicateJobs(limit: number): Promise<DuplicateJobs>

  // ── 회사 별점 (Blind)
  /**
   * 별점을 조회해야 하는 회사명. jobs에 있는 고유 회사 중 company_ratings 행이
   * 없거나 fetched_at이 staleDays보다 오래된 것을 오래된 순으로 준다.
   * 경계는 이상(<=)이다 — staleDays=0을 "전부 다시 조회"로 쓸 수 있게 하기 위함이고,
   * 30일 같은 실제 값에서는 1밀리초 차이라 뜻이 달라지지 않는다.
   * 상태 전이가 아니라 질의로 대상을 고르므로 몇 번을 다시 돌려도 안전하다.
   */
  listCompaniesNeedingRating(limit: number, staleDays: number): Promise<string[]>
  /** 조회 결과를 확정 기록한다. 미등록(not_found)도 답이므로 행으로 남긴다. */
  saveCompanyRating(result: CompanyRatingResult): Promise<void>
  /** 조회 자체가 실패했을 때. attempts를 올리고 다음 실행이 다시 집도록 둔다. */
  recordCompanyRatingFailure(companyName: string, message: string): Promise<void>

  // ── 마감 재확인
  /**
   * 모집이 아직 열려 있는지 다시 확인할 공고. 제외되지 않았고 중복도 아니며 상세를 받은 것 중
   * 마지막 확인이 staleDays보다 오래된 것을 오래된 순으로 준다(한 번도 확인 안 한
   * 것이 가장 먼저). 상태 전이가 아니라 질의로 고르므로 몇 번을 다시 돌려도 안전하다.
   */
  listJobsNeedingRecheck(limit: number, staleDays: number): Promise<Job[]>
  /**
   * 재확인 결과를 반영한다. closed면 제외 처리하고, dueTime은 언제나 최신값으로
   * 덮는다 — 저장된 마감일이 연장되는 경우가 실제로 있어 그대로 두면 화면이 거짓말한다.
   * 제외를 풀지는 않는다(자동화가 사람의 결정을 덮어쓰지 않는다는 같은 원칙).
   */
  recordJobRecheck(jobId: string, result: JobRecheck): Promise<void>

  // ── 교차 중복
  /**
   * 중복 판정 후보. duplicate_of가 null이고 hidden이 아닌 행만 오래된 순으로 준다.
   *
   * hidden을 빼는 것이 중요하다 — recheck는 "같은 공고가 다시 올라오면 소스가 새
   * external_id를 주므로 새 행으로 정상 수집·채점된다"를 보장한다. 마감돼 숨겨진
   * 행을 후보로 두면 재등록분이 그 옛 행의 중복으로 찍혀 영원히 채점되지 않는다.
   */
  listDedupIndex(): Promise<DedupCandidate[]>
  /**
   * 새로 만든 행을 기존 행의 중복으로 표시한다.
   *
   * discover가 insertJobs 직후 그 배치에 대해서만 한 번 호출한다 — 이 파이프라인의
   * 다른 단계와 달리 "질의로 대상을 고른다" 원칙을 따르지 않고 실행 시점에 계산해
   * 소비하는 값이다. insertJobs는 성공했는데 이 호출이 실패하거나(그 사이 Vercel
   * 함수가 60초 상한에 걸리는 경우 포함) discover 자체가 중간에 죽으면, 그 행들은
   * 다음 실행에서 이미 `created`가 아니므로 다시 판정 대상이 되지 않는다 — 중복
   * 표시가 영구히 누락된 채 남는다(공고 자체는 정상 저장·채점된다).
   */
  markDuplicates(pairs: Array<{ jobId: string; duplicateOf: string }>): Promise<void>

  // ── 관측
  /** pipeline은 대시보드가 collect/notify를 구분하는 유일한 근거다 (node_runs는 빈 실행에서 비어 있다). */
  startRun(pipeline: RunPipeline, trigger: RunTrigger): Promise<string>
  endRun(runId: string): Promise<void>
  recordNodeRun(entry: NodeRunEntry): Promise<void>
}
