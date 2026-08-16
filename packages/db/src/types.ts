export type Source = 'wanted'
export type DetailStatus = 'pending' | 'ok' | 'failed'
export type ScoreStatus = 'ok' | 'failed'
export type Scorer = 'routine' | 'api'
export type NotificationStatus = 'pending' | 'sent' | 'failed'
export type RunTrigger = 'cron' | 'manual' | 'cli'
export type RunPipeline = 'collect' | 'notify'

export interface RunSummary {
  id: string
  /** 0003 적용 전에 생긴 행은 null이다. 화면에서는 '알 수 없음'으로 표시한다. */
  pipeline: RunPipeline | null
  trigger: RunTrigger
  startedAt: string
  endedAt: string | null
}

export interface SearchParams {
  jobGroupId: string
  tagTypeIds: string[]
  locations: string[]
  yearsFrom: number
  yearsTo: number
  country: string
  sort: string
}

export interface Search {
  id: string
  url: string
  params: SearchParams
  enabled: boolean
}

export interface NewJob {
  source: Source
  externalId: string
  position: string
  companyName: string
  companyId: number | null
  addressDistrict: string | null
  addressFull: string | null
  url: string
  dueTime: string | null
}

export interface JobDetailFields {
  intro: string | null
  requirements: string | null
  mainTasks: string | null
  preferredPoints: string | null
  benefits: string | null
  skillTags: string[]
  raw: unknown
}

export interface Job extends NewJob, Partial<JobDetailFields> {
  id: string
  firstSeenAt: string
  detailStatus: DetailStatus
  detailAttempts: number
  detailError: string | null
  bookmarked: boolean
  hidden: boolean
}

export interface ScoreInput {
  jobId: string
  total: number
  breakdown: Record<string, number>
  reasoning: string
  scorer: Scorer
  rubricVersion: string
}

export interface Score extends ScoreInput {
  status: ScoreStatus
  attempts: number
  error: string | null
  scoredAt: string
  notifiedAt: string | null
}

export interface ScoredJob {
  job: Job
  score: Score
}

export interface NotifyRule {
  topN: number
  minScore: number
}

export interface Profile {
  resumeText: string
  rubricVersion: string
  notifyEmail: string
  notifyRule: NotifyRule
}

export interface Notification {
  id: string
  status: NotificationStatus
  jobIds: string[]
}

export interface NodeRunEntry {
  runId: string
  node: string
  itemId: string
  status: 'ok' | 'failed'
  durationMs: number
  error: string | null
}

/** 목록용. reasoning을 넣지 않는다 — 168행 페이로드 107KB 중 64KB가 reasoning인데 목록에서는 표시하지 않는다. */
export interface DashboardRow {
  jobId: string
  companyName: string
  position: string
  url: string
  dueTime: string | null
  bookmarked: boolean
  total: number
  breakdown: Record<string, number>
  notifiedAt: string | null
}

/**
 * 커서가 두 값인 이유: 점수 동점이 흔하다(실측 168건이 60개 값에 몰려 있고
 * 151행이 동점, 최대 9행). total 단독 커서로는 페이지 경계에서 행이 누락되거나
 * 중복된다. offset도 쓰지 않는다 — 북마크 토글이나 신규 채점으로 순서가 밀린다.
 */
export interface DashboardCursor {
  total: number
  jobId: string
}

export interface DashboardFilters {
  minScore?: number
  bookmarkedOnly?: boolean
  unnotifiedOnly?: boolean
}

export interface DashboardPage {
  rows: DashboardRow[]
  nextCursor: DashboardCursor | null
}
