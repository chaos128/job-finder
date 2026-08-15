import type { ScoredJob } from '@job-finder/db'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function breakdownLine(breakdown: Record<string, number>): string {
  return Object.entries(breakdown).map(([axis, v]) => `${axis} ${v}`).join(' · ')
}

export function renderDigest(items: ScoredJob[]): {
  subject: string
  html: string
  text: string
} {
  if (items.length === 0) {
    throw new Error('다이제스트 항목이 비어 있습니다 — 호출자가 먼저 걸러야 합니다')
  }

  const sorted = [...items].sort((a, b) => b.score.total - a.score.total)
  const top = sorted[0]!.score.total
  const subject = `[Job Finder] 오늘의 공고 ${sorted.length}건 · 최고 ${top}점`

  const text = sorted
    .map((item) => [
      `${item.score.total}점 — ${item.job.companyName} · ${item.job.position}`,
      breakdownLine(item.score.breakdown),
      item.score.reasoning,
      item.job.url,
    ].join('\n'))
    .join('\n\n---\n\n')

  const html = [
    '<div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.6;max-width:640px">',
    `<h1 style="font-size:18px;margin:0 0 20px">${escapeHtml(subject)}</h1>`,
    ...sorted.map((item) => [
      '<div style="border-top:1px solid #e0e0e0;padding:16px 0">',
      `<div style="font-size:20px;font-weight:600">${item.score.total}점</div>`,
      `<div style="font-size:15px;margin-top:4px">`,
      `${escapeHtml(item.job.companyName)} · ${escapeHtml(item.job.position)}`,
      '</div>',
      `<div style="font-family:ui-monospace,monospace;font-size:12px;color:#666;margin-top:6px">`,
      `${escapeHtml(breakdownLine(item.score.breakdown))}</div>`,
      `<p style="font-size:14px;color:#333;margin:10px 0">${escapeHtml(item.score.reasoning)}</p>`,
      `<a href="${escapeHtml(item.job.url)}" style="font-size:14px">${escapeHtml(item.job.url)}</a>`,
      '</div>',
    ].join('')),
    '</div>',
  ].join('')

  return { subject, html, text }
}
