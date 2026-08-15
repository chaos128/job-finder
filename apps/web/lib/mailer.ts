import { createResendMailer, type Mailer } from '@job-finder/mailer'

export function getMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.NOTIFY_FROM ?? 'Job Finder <onboarding@resend.dev>'
  if (!apiKey) throw new Error('RESEND_API_KEY 가 필요합니다')
  return createResendMailer(apiKey, from)
}
