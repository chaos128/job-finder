import type { Job, Store } from '@job-finder/db'
import { WantedHttpError, parseJobOpenState, type JobSource } from '@job-finder/sources'
import { fail, ok, type Node, type NodeResult } from '../core/node.js'

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * 이미 수집한 공고가 아직 모집 중인지 다시 확인해, 닫혔으면 목록에서 제외한다.
 *
 * 저장된 due_time으로는 판단할 수 없다. 실측(마감일이 지난 비제외 7건을 다시 조회):
 * 2건은 여전히 active였고(한 건은 마감이 09-10 → 09-27로 연장, 한 건은 상시채용
 * 전환), 반대로 마감일이 미래인데 status가 close인 건도 있었다. 게다가 운영 240건
 * 중 198건이 상시채용이라 날짜로는 아예 판단할 수 없다.
 *
 * 삭제하지 않고 제외만 하는 이유: 삭제는 scores를 연쇄로 지워 손으로 매긴 채점
 * 근거가 사라지고, notifications.job_ids는 FK가 아니라 지난 다이제스트의 링크가
 * 깨진다. 재등록을 놓칠 걱정도 없다 — 같은 공고가 다시 올라오면 Wanted가 새
 * external_id를 주므로(실측 7쌍 전부) 새 행으로 들어와 정상 수집·채점된다.
 */
export function createRecheckNode(
  deps: { store: Store; source: JobSource },
): Node<Job, string> {
  return {
    name: 'recheck',

    async run(job): Promise<NodeResult<string>> {
      let raw: Awaited<ReturnType<JobSource['fetchDetail']>>
      try {
        raw = await deps.source.fetchDetail(job.externalId)
      } catch (cause) {
        const retryable = cause instanceof WantedHttpError ? cause.retryable : false
        return fail('WANTED_HTTP', messageOf(cause), retryable)
      }

      let state: ReturnType<typeof parseJobOpenState>
      try {
        state = parseJobOpenState(raw)
      } catch (cause) {
        return fail('PARSE_FAILED', messageOf(cause), false)
      }

      try {
        await deps.store.recordJobRecheck(job.id, state)
        return ok(job.id)
      } catch (cause) {
        return fail('STORE_FAILED', messageOf(cause), true)
      }
    },
  }
}
