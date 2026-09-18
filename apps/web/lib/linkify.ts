/**
 * 공고 본문(intro·자격요건·복지 …) 안에 평문으로 박힌 URL을 링크 조각으로 쪼갠다.
 *
 * 원문을 고치지 않고 그릴 때 바꾸는 이유: `jobs.intro` 같은 컬럼은 Wanted·Remember가
 * 준 JD 원문 그대로여야 재수집 결과와 대조가 되고, 표기를 바꾸고 싶을 때 370행을
 * 다시 만들 일이 없다. 경력 요건을 정수로 저장하고 문구는 렌더할 때 만드는 것과 같은 규칙.
 *
 * 실측(운영 370건): 79건(21%)의 본문에 URL 236개가 들어 있고 대부분 intro에 몰려 있다.
 */
export type LinkPart =
  | { type: 'text'; value: string }
  | { type: 'link'; href: string; label: string }

/**
 * URL로 인정할 문자. RFC 3986이 허용하는 것들에 **한글을 더한다** — 운영 데이터의
 * URL 236개 중 7개에 한글이 섞여 있고, 그중 둘은 경로에 한글이 진짜로 들어간
 * 정상 주소다(`apps.apple.com/kr/app/데일리샷-dailyshot/…`,
 * `tech.remember.co.kr/개발자가-개발을-안하는-세계에서-…`). 한글을 빼면 이 둘이
 * 잘린다. 나머지 다섯(꼬리 조사)은 아래 trimTail이 따로 처리한다.
 */
const URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%가-힣]+/g

/** 문장부호로 끝나면 문장의 일부다. 괄호는 짝을 세어 따로 판단한다. */
const SENTENCE_TAIL = /[.,;:!?'"\]}]+$/
/** 조사만 남은 꼬리(`)과`, `)은`, `)를`, `)에`). */
const HANGUL_TAIL = /[가-힣]+$/

function unbalancedClose(url: string): boolean {
  return url.endsWith(')')
    && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)
}

/**
 * 꼬리를 오른쪽에서 벗겨 낸다. 세 가지가 섞여 들어오기 때문이다(전부 실측된 모양):
 *
 *   (https://career.crossenf.com)            문장이 URL을 괄호로 감쌈
 *   [http://toonkit.io]                      대괄호로 감쌈
 *   (https://youtube.com/watch?v=…pkPU)과     괄호 + 한글 조사
 *
 * 닫는 괄호는 **여는 괄호보다 많을 때만** 뗀다 — `…/React_(라이브러리)`처럼 괄호가
 * 주소의 일부인 URL을 깨지 않기 위해서다. 한글 꼬리도 마찬가지로 "짝 없는 닫는 괄호
 * 바로 뒤"일 때만 조사로 보고 뗀다. 경로 한가운데의 한글은 건드리지 않는다.
 */
function trimTail(url: string): string {
  let out = url
  for (;;) {
    const before = out
    out = out.replace(SENTENCE_TAIL, '')
    const withoutHangul = out.replace(HANGUL_TAIL, '')
    if (withoutHangul !== out && unbalancedClose(withoutHangul)) out = withoutHangul
    if (unbalancedClose(out)) out = out.slice(0, -1)
    if (out === before) return out
  }
}

/** 표시용 라벨. 주소 전문은 한 줄을 통째로 먹으므로 호스트만 보여준다. */
function hostLabel(href: string): string {
  try {
    return new URL(href).host.replace(/^www\./, '')
  } catch {
    return href
  }
}

export function linkify(text: string): LinkPart[] {
  const parts: LinkPart[] = []
  let cursor = 0

  for (const match of text.matchAll(URL_RE)) {
    const href = trimTail(match[0])
    // 꼬리를 다 떼고 나면 스킴만 남는 경우가 있다("https://." 같은 오타).
    if (!/^https?:\/\/[^/]/.test(href)) continue
    const start = match.index

    if (start > cursor) parts.push({ type: 'text', value: text.slice(cursor, start) })
    parts.push({ type: 'link', href, label: hostLabel(href) })
    // 떼어낸 문장부호는 링크가 아니라 뒤따르는 글자로 되돌린다.
    cursor = start + href.length
  }

  if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) })
  return parts
}
