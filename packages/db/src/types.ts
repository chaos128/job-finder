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
  /** 공고가 어떤 일인지 약 세 문장. 목록 카드에 그대로 실린다. */
  summary: string
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
  /** 제외됨(exclude) 여부. true면 목록 맨 뒤로 정렬되고 카드가 비활성 처리된다. */
  hidden: boolean
  total: number
  breakdown: Record<string, number>
  notifiedAt: string | null
  /** 채점 시 함께 받은 JD 요약(약 세 문장). 0004 이전 행은 빈 문자열(reasoning과 같은 관례). */
  summary: string
}

/**
 * 커서가 세 값인 이유: 정렬이 `hidden asc, total desc, jobId desc`다 — 제외된
 * 공고는 점수와 무관하게 맨 뒤로 보낸다. 점수 동점도 흔해서(실측 168건이 60개
 * 값에 몰려 있고 151행이 동점, 최대 9행) total 단독 커서로는 페이지 경계에서
 * 행이 누락되거나 중복된다. hidden까지 포함해야 "제외 안 됨 → 제외됨" 경계도
 * 같은 이유로 안전하다. offset도 쓰지 않는다 — 북마크·제외 토글이나 신규
 * 채점으로 순서가 밀린다.
 */
export interface DashboardCursor {
  hidden: boolean
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

/**
 * "알림 대기" 건수를 세는 데 필요한 최소 컬럼. 같은 대상을 listNotifyCandidates로도
 * 셀 수 있지만 그건 발송용이라 공고 전문에 가까운 컬럼을 다 끌고 온다 — 실측
 * 134건에 320ms로, /jobs 첫 응답 전체(356ms)를 혼자 잡아먹었다.
 */
export interface NotifyPendingRow {
  total: number
  dueTime: string | null
}

export interface DashboardStats {
  totalJobs: number
  scoredJobs: number
  /** null이면 아직 한 건도 채점되지 않았다. */
  lastScoredAt: string | null
  rubricVersions: Record<string, number>
  recentRuns: RunSummary[]
}

/**
 * 아직 채점되지 않은 공고. 점수가 없으므로 DashboardRow와 같은 모양일 수 없고,
 * 커서 페이징(total 기준)도 적용되지 않는다 — 상한만 걸어 한 번에 받는다.
 */
export interface UnscoredJob {
  jobId: string
  companyName: string
  position: string
  url: string
  dueTime: string | null
  firstSeenAt: string
}

/**
 * 미채점 목록은 상한에서 잘린다. 잘린 건수를 백로그 총량인 것처럼 보여주면
 * 정확히 상한값(100건)에서 화면이 거짓말을 하므로, 상한과 무관한 총량을 함께 준다.
 */
export interface UnscoredJobs {
  rows: UnscoredJob[]
  /** limit 적용 전 전체 미채점 건수. rows.length보다 클 수 있다. */
  total: number
}
