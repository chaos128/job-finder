import type { Job, Store } from '@job-finder/db'
import { WantedHttpError, type JobSource } from '@job-finder/sources'
import { fail, ok, type Node, type NodeResult } from '../core/node.js'

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * 실패 사유를 store에 기록하고 그 결과를 반환한다. recordDetailFailure 자체가
 * 실패해도(store 장애) 원래 실패 사유를 그대로 보고한다 — 시도 횟수가 이번엔
 * 못 올라가지만, pending으로 남아 다음 실행에서 다시 시도되므로 안전하다.
 * 이중 실패로 헷갈리게 하거나 unhandled rejection을 내는 것보다 낫다.
 */
async function reportFailure(
  store: Store,
  jobId: string,
  code: string,
  message: string,
  retryable: boolean,
): Promise<NodeResult<never>> {
  try {
    await store.recordDetailFailure(jobId, `${code}: ${message}`)
  } catch {
    // 관측 손실일 뿐이다 — 원래 실패를 아래에서 그대로 보고한다.
  }
  return fail(code, message, retryable)
}

export function createFetchDetailNode(
  deps: { store: Store; source: JobSource },
): Node<Job, string> {
  return {
    name: 'fetchDetail',

    async run(job) {
      let raw: Awaited<ReturnType<JobSource['fetchDetail']>>
      try {
        raw = await deps.source.fetchDetail(job.externalId)
      } catch (cause) {
        const retryable = cause instanceof WantedHttpError ? cause.retryable : false
        return reportFailure(deps.store, job.id, 'WANTED_HTTP', messageOf(cause), retryable)
      }

      let fields: ReturnType<JobSource['normalize']>
      try {
        fields = deps.source.normalize(raw)
      } catch (cause) {
        return reportFailure(deps.store, job.id, 'NORMALIZE_FAILED', messageOf(cause), false)
      }

      try {
        await deps.store.saveJobDetail(job.id, fields)
        return ok(job.id)
      } catch (cause) {
        return reportFailure(deps.store, job.id, 'STORE_FAILED', messageOf(cause), true)
      }
    },
  }
}
