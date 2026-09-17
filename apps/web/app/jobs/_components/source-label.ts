import type { Source } from '@job-finder/db'

/**
 * 소스 → 배지 라벨. `row.source === 'remember' ? '리멤버' : '원티드'` 식의 삼항은
 * 매핑에 없는 값까지 전부 '원티드'로 잘못 표시한다 — 여기서는 모르는 값이면
 * 틀린 라벨 대신 원문 그대로 보여준다.
 */
const SOURCE_LABELS: Record<Source, string> = { wanted: '원티드', remember: '리멤버' }

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as Source] ?? source
}

/**
 * 출처 배지 색. 회색 배지 둘로는 훑을 때 라벨을 읽어야만 구별돼서 색을 넣는다.
 *
 * 두 서비스의 브랜드 색이 모두 파랑 계열이라 브랜드를 그대로 따르면 구별이라는
 * 목적 자체가 깨진다. 그래서 원티드만 브랜드색(blue)을 쓰고, 리멤버는 팔레트에서
 * 실제로 비어 있는 자리를 준다.
 *
 * 자리 선정은 색상환 실측이다. 이미 쓰는 hue(Tailwind v4 -500 OKLCH):
 * red 25.3(에러) · amber 70.1(경고) · lime 130.9 · teal 182.5 · sky 237.3 ·
 * indigo 277.1 · fuchsia 322.2(다섯 축). 인접 간격 중 유일하게 넓은 구간이
 * fuchsia→red의 63.1도이고 그 한가운데가 pink 354.3이다(양쪽 32.2 / 31.0도).
 *
 * blue 259.8은 indigo와 17.3도까지 붙는다 — 팔레트 규칙만 보면 피할 색이다.
 * 그래도 쓰는 이유: indigo는 카드 아래쪽 축 칩("growth 12") 안에서만 쓰이고 이
 * 배지는 회사명 옆 윗줄이라 같은 눈길에 들어오지 않으며, 원티드가 압도적 다수라
 * 브랜드색으로 바로 읽히는 이득이 더 크다. 두 배지끼리는 94.5도 떨어져 있어
 * 구별이라는 본래 목적은 넉넉히 만족한다.
 *
 * 축 칩(border + bg-50 + text-700)과 형태도 다르게 둔다 — 테두리 없는 bg-100이라
 * 같은 색 계열이어도 "점수 축"이 아니라 다른 종류의 표시로 읽힌다.
 */
const SOURCE_BADGE_CLASSES: Record<Source, string> = {
  wanted: 'bg-blue-100 text-blue-800',
  remember: 'bg-pink-100 text-pink-800',
}

export function sourceBadgeClass(source: string): string {
  // 모르는 소스는 라벨과 같은 원칙으로 중립색 — 없는 색을 지어내지 않는다.
  return SOURCE_BADGE_CLASSES[source as Source] ?? 'bg-neutral-100 text-neutral-600'
}
