import { afterEach, expect, test, vi } from 'vitest'
import { createResendMailer } from '../src/index.js'

function stubFetch() {
  const calls: RequestInit[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    calls.push(init)
    return new Response('{"id":"1"}', { status: 200 })
  })
  return calls
}

afterEach(() => { vi.unstubAllGlobals() })

const message = {
  to: 'me@example.com', subject: '[Job Finder] 오늘의 공고',
  html: '<p>h</p>', text: 't', idempotencyKey: 'ntf_1',
}

// 재발송 경로가 둘이다 — 타임아웃 후 재시도, 그리고 발송 성공 직후
// markNotificationSent 실패로 pending에 남아 다음 실행이 다시 보내는 경우.
// 둘 다 같은 알림 id를 쓰므로 키가 같으면 Resend가 한 통으로 접는다.
test('같은 알림을 다시 보내면 같은 Idempotency-Key가 나간다', async () => {
  const calls = stubFetch()
  const mailer = createResendMailer('re_test', 'Job Finder <me@example.com>')

  await mailer.send(message)
  await mailer.send(message)

  const keys = calls.map((c) => (c.headers as Record<string, string>)['Idempotency-Key'])
  expect(keys).toEqual(['ntf_1', 'ntf_1'])
})

test('4xx 응답은 던진다', async () => {
  vi.stubGlobal('fetch', async () => new Response('invalid to', { status: 422 }))
  const mailer = createResendMailer('re_test', 'Job Finder <me@example.com>')
  await expect(mailer.send(message)).rejects.toThrow(/422/)
})
