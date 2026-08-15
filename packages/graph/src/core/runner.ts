import type { Store } from '@job-finder/db'
import type { Node } from './node.js'

export interface FailedItem {
  itemId: string
  code: string
  message: string
  retryable: boolean
}

export interface RunSummary<Out> {
  ok: Out[]
  failed: FailedItem[]
}

export interface RunnerOptions {
  runId: string
  store: Pick<Store, 'recordNodeRun'>
  /** 외부 API를 때리는 노드는 3을 넘기지 않는다. */
  concurrency?: number
}

const DEFAULT_CONCURRENCY = 3

/**
 * 노드를 항목마다 실행한다. 건별 실패는 격리되어 run 전체를 죽이지 않으며,
 * 모든 결과는 node_runs에 남는다.
 */
export async function runNode<In, Out>(
  node: Node<In, Out>,
  items: In[],
  itemId: (input: In) => string,
  opts: RunnerOptions,
): Promise<RunSummary<Out>> {
  const limit = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY)
  const summary: RunSummary<Out> = { ok: [], failed: [] }
  let cursor = 0

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      const input = items[index]!
      const id = itemId(input)
      const startedAt = Date.now()

      let result: Awaited<ReturnType<typeof node.run>>
      try {
        result = await node.run(input, { runId: opts.runId })
      } catch (cause) {
        result = {
          ok: false,
          error: { code: 'UNCAUGHT', message: String(cause) },
          retryable: false,
        }
      }

      const durationMs = Date.now() - startedAt

      if (result.ok) {
        summary.ok.push(result.value)
      } else {
        summary.failed.push({
          itemId: id,
          code: result.error.code,
          message: result.error.message,
          retryable: result.retryable,
        })
      }

      await opts.store.recordNodeRun({
        runId: opts.runId,
        node: node.name,
        itemId: id,
        status: result.ok ? 'ok' : 'failed',
        durationMs,
        error: result.ok ? null : `${result.error.code}: ${result.error.message}`,
      })
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  )
  return summary
}
