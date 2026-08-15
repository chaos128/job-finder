export interface NodeError {
  code: string
  message: string
}

export type NodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: NodeError; retryable: boolean }

export interface Ctx {
  runId: string
}

export interface Node<In, Out> {
  readonly name: string
  run(input: In, ctx: Ctx): Promise<NodeResult<Out>>
}

export function ok<T>(value: T): NodeResult<T> {
  return { ok: true, value }
}

export function fail(code: string, message: string, retryable: boolean): NodeResult<never> {
  return { ok: false, error: { code, message }, retryable }
}
