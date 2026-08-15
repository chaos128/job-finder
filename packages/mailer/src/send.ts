export interface Mailer {
  send(msg: {
    to: string
    subject: string
    html: string
    text: string
    /** 알림 id. 같은 알림의 재발송을 Resend가 한 통으로 접게 하는 키다. */
    idempotencyKey: string
  }): Promise<void>
}

/** 이 시간을 넘겨도 응답이 없으면 요청을 끊는다 — 서버리스 함수가 플랫폼
 * 제한 시간에 그냥 죽어버리면 markNotificationFailed가 아예 실행되지 못해
 * 알림이 pending에 갇힌다. 다만 끊는 것 자체는 중복을 막지 못한다: Resend가
 * 요청을 이미 받아들인 뒤 응답만 늦은 경우라면 다음 실행이 같은 알림을 다시
 * 보낸다. 그 재발송이 실제 중복 메일이 되지 않게 하는 것은 아래 키다. */
const SEND_TIMEOUT_MS = 20_000

export function createResendMailer(apiKey: string, from: string): Mailer {
  return {
    async send(msg) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // 같은 알림은 한 통만 나간다 — 타임아웃 후 재시도든, 발송 성공 직후
          // markNotificationSent가 실패해 pending으로 되돌아간 경우든 키가 같다.
          // (Resend의 유효기간은 24시간이라 그보다 늦은 재시도는 다시 나간다.)
          'Idempotency-Key': msg.idempotencyKey,
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
