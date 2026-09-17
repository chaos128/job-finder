export type Source = 'wanted' | 'remember'
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

export interface WantedSearchParams {
  source: 'wanted'
  jobGroupId: string
  tagTypeIds: string[]
  locations: string[]
  yearsFrom: number
  yearsTo: number
  country: string
  sort: string
}

/**
 * Remember 검색 페이지 URL의 ?search= JSON과 같은 모양(camelCase)이다.
 * API 본문은 snake_case를 받지만, 변환은 소스 구현이 명시적으로 한다 —
 * 여기서 미리 snake_case로 저장하면 저장값과 URL을 눈으로 대조할 수 없다.
 */
export interface RememberSearchParams {
  source: 'remember'
  jobCategoryNames: Array<{ level1: string; level2: string }>
  addresses: string[][]
  organizationType: string | null
  minExperience: number | null
}

export type SearchParams = WantedSearchParams | RememberSearchParams

export interface Search {
  id: string
  source: Source
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
  /**
   * 경력 요건. Wanted 상세 API의 annual_from/annual_to를 그대로 담는다.
   * annualTo는 100이 "상한 없음"을 뜻하는 센티널이고, annualFrom 0은 신입 포함이다.
   * 표기 변환은 화면의 몫이다(formatExperience).
   */
  annualFrom: number | null
  annualTo: number | null
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
  /** 이 공고가 중복인 경우 원본 job id. null이면 중복이 아니다. */
  duplicateOf: string | null
}

/** 중복 판정에 필요한 최소 컬럼. 전량을 받아 JS에서 맞추므로 좁게 잡는다. */
export type DedupCandidate = Pick<Job, 'id' | 'source' | 'companyName' | 'position'>

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

/**
 * Blind(teamblind.com)에 등록된 회사의 별점. 미등록 회사는 이 값이 null이고
 * 화면에 아무것도 그리지 않는다 — 실측 커버리지가 56%라, 없는 쪽을 표시하면
 * 목록 절반이 "없음" 배지로 덮인다.
 */
export interface CompanyRating {
  rating: number
  /** Blind가 매칭한 회사명. 원문과 다를 수 있다(에스케이일렉링크 → SK일렉링크). */
  blindName: string
  blindUrl: string
}

/** 별점 수집 노드가 한 회사에 대해 알아낸 결과. status로 미등록까지 확정해 기록한다. */
export type CompanyRatingResult =
  | { companyName: string; status: 'ok'; rating: number; blindName: string; blindUrl: string }
  | { companyName: string; status: 'not_found' }

/** 마감 재확인 결과. closed면 제외하고, dueTime은 화면 표시를 최신으로 맞춘다. */
export interface JobRecheck {
  closed: boolean
  dueTime: string | null
}

/** getJobDetail 전용. ScoredJob에 넣지 않는 이유는 notify 경로가 별점을 쓰지 않기 때문이다. */
export interface JobDetail extends ScoredJob {
  blind: CompanyRating | null
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
  /** Blind 별점. 미등록이거나 아직 조회 전이면 null. */
  blind: CompanyRating | null
  /** 경력 요건. 0007 이전에 수집된 행이나 상세 조회 전이면 null. */
  annualFrom: number | null
  annualTo: number | null
}

/**
 * 정렬은 `total desc, jobId desc`다. 점수 동점이 흔해서(실측 168건이 60개 값에
 * 몰려 있고 151행이 동점, 최대 9행) total 단독 커서로는 페이지 경계에서 행이
 * 누락되거나 중복된다. offset도 쓰지 않는다 — 북마크·제외 토글이나 신규 채점으로
 * 순서가 밀린다.
 *
 * hidden을 함께 들고 다니는 이유: 목록이 제외 여부로 갈려 있어(hiddenOnly) 커서가
 * 어느 쪽 목록의 것인지 남겨둬야, 필터를 바꾼 뒤 낡은 커서가 섞여 들어오는 것을
 * 스토어가 알아볼 수 있다. duplicates도 같은 이유로 들고 다닌다 — duplicatesOnly로
 * 갈리는 두 번째 배타 버킷이라, 이 축만 바뀐 낡은 커서도 똑같이 걸러내야 한다.
 * 그러지 않으면 새 버킷의 첫 페이지가 이전 버킷 커서의 (total, jobId) 다음부터
 * 시작해, 정렬 1순위인 상위 점수 행이 조용히 건너뛰어진다.
 */
export interface DashboardCursor {
  hidden: boolean
  duplicates: boolean
  total: number
  jobId: string
}

export interface DashboardFilters {
  minScore?: number
  bookmarkedOnly?: boolean
  unnotifiedOnly?: boolean
  /**
   * true면 제외(hidden)된 공고만, 아니면 제외되지 않은 것만 준다.
   * 어느 쪽이든 한쪽만 주므로 한 페이지 안에 두 값이 섞이지 않는다.
   */
  hiddenOnly?: boolean
  /**
   * true면 중복으로 표시된 공고만, 아니면 중복이 아닌 것만 준다.
   * hiddenOnly와 같은 배타 버킷이라 한 페이지에 두 값이 섞이지 않는다.
   */
  duplicatesOnly?: boolean
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
