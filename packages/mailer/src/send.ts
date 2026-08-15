export interface Mailer {
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<void>
}

/** 이 시간을 넘겨도 응답이 없으면 요청을 끊는다 — 서버리스 함수가 플랫폼
 * 제한 시간에 그냥 죽어버리면 markNotificationFailed가 아예 실행되지 못해
 * pending인 채로 남고, 실제로는 메일이 나갔을 수도 있어 다음 실행이 반드시
 * 중복 발송하게 된다. */
const SEND_TIMEOUT_MS = 20_000

export function createResendMailer(apiKey: string, from: string): Mailer {
  return {
    async send(msg) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
      if (!res.ok) {
        throw new Error(`Resend ${res.status}: ${await res.text()}`)
      }
    },
  }
}
