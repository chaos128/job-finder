import type { DashboardCursor, DashboardFilters, DashboardRow } from '@job-finder/db'

/**
 * 무한스크롤로 쌓은 목록을 상세에 다녀오는 동안 들고 있는다.
 *
 * 왜 필요한가: 스크롤 복원 자체는 이미 동작한다(첫 페이지 안에서 움직였을 때는
 * 정확히 돌아온다). 깨지는 건 목록이 initialRows로 되감기면서 문서가 짧아질 때다 —
 * 실측: 224장까지 내린 뒤 상세에 다녀오면 문서 높이가 61231→11539로 줄고
 * 스크롤이 20000에서 5185로 잘려, 전혀 다른 카드 앞에 서게 된다.
 * 목록을 그대로 되살리면 문서 높이가 유지되고 브라우저의 복원이 제자리를 찾는다.
 *
 * sessionStorage가 아니라 모듈 스코프인 이유: 새로고침하면 사라지는 편이 맞다
 * (그때는 새 데이터를 봐야 한다). 직렬화 비용도, 용량 한도도 없다.
 */
interface ListCache {
  rows: DashboardRow[]
  cursor: DashboardCursor | null
  filters: DashboardFilters
  /** 필터에 걸린 전체 건수. 커서 페이지 응답은 세지 않으므로 목록과 함께 들고 있어야 한다. */
  total: number | null
  /** 입력 중인 검색어. filters.search는 디바운스된 값이라 되살릴 때 입력칸이 비어 보인다. */
  searchInput: string
}

let cache: ListCache | null = null
let leavingForDetail = false

/** 카드에서 상세로 떠나기 직전에 표시한다. 이 표시가 있을 때만 목록을 담아둔다. */
export function markDetailNavigation(): void {
  leavingForDetail = true
}

export function saveListCache(value: ListCache): void {
  // 표시가 없으면 담지 않는다. 상단 네비게이션으로 홈에 갔다가 다시 들어오는
  // 경우까지 되살리면, 새로 수집·채점된 공고가 안 보이는 낡은 목록을 보게 된다.
  if (!leavingForDetail) return
  leavingForDetail = false
  cache = value
}

/**
 * 한 번만 꺼내 쓰고 비운다. "뒤로 왔는가"를 직접 알 방법이 없어서 이렇게 가른다 —
 * 상세로 떠날 때 담고 돌아올 때 꺼내면, 상단 네비게이션으로 새로 들어오는 경우엔
 * 이미 비어 있어 서버가 준 최신 목록을 그대로 쓴다.
 */
export function takeListCache(): ListCache | null {
  const taken = cache
  cache = null
  return taken
}
