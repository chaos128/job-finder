import type { Store } from './store.js'
import type {
  Job, JobDetailFields, NewJob, NodeRunEntry, Notification,
  Profile, RunTrigger, Score, ScoreInput, ScoredJob, Search, Source,
} from './types.js'

const MAX_ATTEMPTS = 3
/** SupabaseStore의 listNotifyCandidates와 같은 상한 — 두 구현이 같은 계약을 지켜야 한다. */
const NOTIFY_CANDIDATE_LIMIT = 200

export class MemoryStore implements Store {
  private seq = 0
  readonly searches: Search[] = []
  readonly jobs = new Map<string, Job>()
  readonly hits = new Set<string>()
  readonly scores = new Map<string, Score>()
  readonly notifications = new Map<string, Notification>()
  /** notifications.attempts 컬럼에 대응. Notification 타입에는 노출하지 않는다. */
  private readonly notificationAttempts = new Map<string, number>()
  readonly nodeRuns: NodeRunEntry[] = []
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
    for (const row of rows) {
      const exists = [...this.jobs.values()].some(
        (j) => j.source === row.source && j.externalId === row.externalId,
      )
      if (exists) continue
      const job: Job = {
        ...row,
        id: this.nextId('job'),
        firstSeenAt: new Date(0).toISOString(),
        detailStatus: 'pending',
        detailAttempts: 0,
        detailError: null,
        bookmarked: false,
        hidden: false,
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
      if (job && !job.hidden) out.push({ job, score })
    }
    return out
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, NOTIFY_CANDIDATE_LIMIT)
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

  async startRun(_trigger: RunTrigger) { return this.nextId('run') }
  async endRun(_runId: string) {}
  async recordNodeRun(entry: NodeRunEntry) { this.nodeRuns.push(entry) }
}
