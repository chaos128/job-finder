import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Store } from './store.js'
import type {
  Job, JobDetailFields, NewJob, NodeRunEntry, Notification,
  NotifyRule, Profile, RunTrigger, ScoreInput, ScoredJob, Search,
  SearchParams, Source,
} from './types.js'

const MAX_ATTEMPTS = 3

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
  reasoning: string; scorer: string; rubric_version: string
  status: string; attempts: number; error: string | null
  scored_at: string; notified_at: string | null
}

interface NotificationRow {
  id: string; status: string; job_ids: string[]
}

// scores.job_id is both primary key and FK -> jobs, so this is a 1:1
// relationship. PostgREST embeds 1:1 relations as a single nullable
// object even from the "one" side, not as an array. (This mattered for
// an earlier version of listJobsNeedingScore that embedded scores from
// jobs; that method now queries the jobs_needing_score view instead,
// but listNotifyCandidates still embeds jobs from scores below.)
type ScoreWithJobRow = ScoreRow & { jobs: JobRow }

function toJob(row: JobRow): Job {
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
    intro: row.intro,
    requirements: row.requirements,
    mainTasks: row.main_tasks,
    preferredPoints: row.preferred_points,
    benefits: row.benefits,
    skillTags: row.skill_tags,
    raw: row.raw,
    firstSeenAt: row.first_seen_at,
    detailStatus: row.detail_status as Job['detailStatus'],
    detailAttempts: row.detail_attempts,
    detailError: row.detail_error,
    bookmarked: row.bookmarked,
    hidden: row.hidden,
  }
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
      }).eq('id', jobId)
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
        reasoning: input.reasoning, scorer: input.scorer,
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
        await db.from('scores').select('*, jobs(*)')
          .eq('status', 'ok').is('notified_at', null)
          .order('total', { ascending: false }),
      )

      return rows
        .filter((r) => r.jobs && !r.jobs.hidden)
        .map((r) => ({
          job: toJob(r.jobs),
          score: {
            jobId: r.job_id, total: r.total, breakdown: r.breakdown,
            reasoning: r.reasoning, scorer: r.scorer as ScoreInput['scorer'],
            rubricVersion: r.rubric_version, status: 'ok' as const,
            attempts: r.attempts, error: r.error,
            scoredAt: r.scored_at, notifiedAt: r.notified_at,
          },
        }))
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

    async startRun(trigger: RunTrigger) {
      const row = unwrap<{ id: string }>(
        await db.from('runs').insert({ trigger }).select('id').single(),
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
