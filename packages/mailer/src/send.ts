export interface Mailer {
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<void>
}

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
      })
      if (!res.ok) {
        throw new Error(`Resend ${res.status}: ${await res.text()}`)
      }
    },
  }
}
