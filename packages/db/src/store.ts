import type {
  DashboardCursor, DashboardFilters, DashboardPage,
  Job, JobDetailFields, NewJob, NodeRunEntry, Notification,
  Profile, RunPipeline, RunTrigger, ScoreInput, ScoredJob, Search, Source,
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

  // ── 관측
  /** pipeline은 대시보드가 collect/notify를 구분하는 유일한 근거다 (node_runs는 빈 실행에서 비어 있다). */
  startRun(pipeline: RunPipeline, trigger: RunTrigger): Promise<string>
  endRun(runId: string): Promise<void>
  recordNodeRun(entry: NodeRunEntry): Promise<void>
}
