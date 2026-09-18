"use client";

import { Button, cn } from "@job-finder/ui";
import { axisPercent } from "@/lib/dashboard";
import type { DashboardRow } from "@job-finder/db";
import { Bookmark, RotateCcw, X, } from "lucide-react";
import Link from "next/link";
import { BlindRating } from "./blind-rating";
import { formatExperience } from "./experience";
import { markDetailNavigation } from "./list-cache";
import { AXIS_BAR_COLOR, AXIS_LABEL, scoreBandClass } from "./score-visuals";
import { sourceBadgeClass, sourceLabel } from "./source-label";

const AXES = ["stack", "role", "domain", "growth", "conditions"] as const;

export function JobCard({
  row,
  onToggleBookmark,
  onToggleHidden,
}: {
  row: DashboardRow;
  onToggleBookmark: (jobId: string, next: boolean) => void;
  onToggleHidden: (jobId: string, next: boolean) => void;
}) {
  const experience = formatExperience(row.annualFrom, row.annualTo);
  return (
    <div
      className={cn(
        // 레일은 폭과 무관하게 항상 가로다. 세로 레일은 카드 높이만큼 빈 띠를
        // 남기고 본문을 그만큼 눌렀다 — 좁은 폭에서 본문의 11%였고, 넓은 폭에서도
        // 요약이 한 칸 안쪽에서 시작해 이득이 없었다.
        "flex flex-col gap-3 rounded-2xl border border-line bg-white p-5",
        // 북마크한 카드는 배경만 살짝 물들인다. amber-50은 흰 카드와 명도가 거의
        // 같아서(페이지 배경 #fafafa와도) 목록을 훑을 때 덩어리로만 보이고 글자
        // 대비는 그대로다 — "은은하게"가 요구사항이라 -100 이상은 쓰지 않는다.
        // 별점(Star)이 이미 amber라 같은 계열로 묶어 "내가 표시해 둔 것"으로 읽힌다.
        // hidden보다 먼저 써서, 둘 다 해당하면 아래 회색이 이긴다 — 제외된 카드가
        // 노랗게 남아 있으면 비활성으로 안 읽힌다.
        row.bookmarked && "border-amber-200 bg-amber-50",
        // 제외된 카드는 비활성처럼 보이게: 회색 배경 + 텍스트 흐림 + 클릭 대상이
        // 아님을 알리는 opacity. 실제로 pointer-events를 막지는 않는다 — 되돌리기
        // 버튼(과 상세 링크)은 계속 눌러야 하기 때문이다. neutral-200인 이유:
        // opacity-60이 배경색까지 페이지(#fafafa)와 섞어버려서, neutral-100은
        // 합성 결과가 #f7f7f7 — 정상 카드(흰색)와 달리 "회색"으로 안 읽힌다.
        row.hidden && "bg-neutral-200 opacity-60 grayscale",
      )}
    >
      {/* 머리 줄: 점수는 왼쪽, 액션은 오른쪽 끝. 아래 본문은 전폭을 쓴다. */}
      <div className="flex shrink-0 flex-row items-center gap-3">
        <div
          className={cn(
            "text-3xl leading-none font-bold tabular-nums",
            scoreBandClass(row.total),
          )}
        >
          {row.total}
        </div>
        <div className="ml-auto flex flex-row items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            aria-label={row.bookmarked ? "북마크 해제" : "북마크"}
            onClick={() => onToggleBookmark(row.jobId, !row.bookmarked)}
            className={cn(
              "size-8 rounded-lg p-0",
              row.bookmarked ? "text-amber-600" : "text-neutral-400",
            )}
          >
            {/* 채운 북마크 = 켜짐. 상세(BookmarkToggle)와 같은 아이콘·같은 규약. */}
            <Bookmark className={row.bookmarked ? "size-4 fill-current" : "size-4"} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={row.hidden ? "제외 해제" : "제외"}
            aria-pressed={row.hidden}
            onClick={() => onToggleHidden(row.jobId, !row.hidden)}
            className={cn(
              "size-8 rounded-lg p-0",
              row.hidden ? "text-neutral-900" : "text-neutral-400",
            )}
          >
            {row.hidden ? <RotateCcw className="size-4" /> : <X className="size-4" />}
          </Button>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {/* 회사명과 포지션을 한 Link로 묶지 않는다 — 회사명 옆의 Blind 배지가
            자기 링크(a)를 가지는데, a 안의 a는 무효 마크업이라서다. */}
        <div className="flex items-center gap-2">
          {/* 회사명을 muted 캡션으로 두면 목록을 훑을 때 안 읽힌다 — 어느 회사인지가
              포지션만큼 중요한 판단 재료라 굵기와 크기를 올렸다. */}
          <Link
            href={`/jobs/${row.jobId}`}
            onClick={markDetailNavigation}
            className="min-w-0 text-base font-semibold text-neutral-800 hover:underline"
          >
            {row.companyName}
          </Link>
          <BlindRating blind={row.blind} />
          {/* 출처가 둘이 되면서 같은 회사·비슷한 제목이 나란히 보일 수 있다 —
              어디서 온 공고인지가 카드에서 바로 보여야 한다. */}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-medium",
              sourceBadgeClass(row.source),
            )}
          >
            {sourceLabel(row.source)}
          </span>
          {/* 중복 판정은 휴리스틱이라 사람이 원본과 대조해 확인할 창이 필요하다. */}
          {row.duplicateOf && (
            <Link
              href={`/jobs/${row.duplicateOf}`}
              onClick={markDetailNavigation}
              className="text-xs text-neutral-500 underline"
            >
              원본 보기
            </Link>
          )}
        </div>
        {/* truncate를 쓰지 않는다. 포지션 제목에 괄호로 도메인이 붙는 경우가 많은데
            (예: "Frontend Engineer (MLOps, Vision AI Platform)") 잘리면 그 부분이
            통째로 사라져 무슨 일인지 알 수 없다. 줄바꿈시킨다. */}
        <Link
          href={`/jobs/${row.jobId}`}
          onClick={markDetailNavigation}
          className="block text-lg font-medium hover:underline"
        >
          {row.position}
        </Link>
        {/* 경력·마감은 지원 여부를 가르는 1차 조건이라 제목 바로 아래에 둔다 —
            요약과 미터 아래 회색 캡션으로 깔려 있을 때는 훑을 때 읽히지 않았다.
            경력 값이 없는 행(0007 적용 전 수집분)은 그 자리를 그리지 않는다. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {experience && (
            <span className="font-medium text-neutral-700">{experience}</span>
          )}
          <span className="text-neutral-500">
            {row.dueTime ? `마감 ${row.dueTime}` : "상시채용"}
          </span>
        </div>
        {/* 줄 수 상한을 두지 않는다. 포지션 제목과 같은 이유로, 잘린 요약은 무슨 일인지
            판단할 재료를 없앤다. 루브릭이 summary를 400자로 제한하고 실측(168건)도
            170~313자에 몰려 있어 카드가 무한정 길어지지 않는다. */}
        <p className="text-sm text-neutral-600">{row.summary}</p>
        {/* 축별 점수. 예전에는 같은 정보를 두 벌로 그렸다 — 제목 아래 누적 막대와
            여기 배지 줄. 막대 쪽은 라벨이 없어 어느 색이 어느 축인지 아래 배지와
            대조해야 알 수 있었고(정체를 색에만 맡긴 셈), 축 하나가 20점 만점인데
            트랙은 100점 기준이라 한 축의 잘하고 못함이 길이로 드러나지 않았다.
            축마다 "한계(20) 대비 한 값"이므로 미터가 맞는 형태다 — 라벨·숫자·길이가
            한자리에 모이고, 칸 위치가 카드마다 같아 세로로 훑으며 비교된다. */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-0.5 sm:grid-cols-5">
          {AXES.map((a) => {
            const v = row.breakdown[a] ?? 0;
            return (
              <div key={a}>
                <div className="flex items-baseline justify-between gap-1">
                  <span className="truncate text-[11px] text-neutral-500">
                    {AXIS_LABEL[a]}
                  </span>
                  <span className="text-[11px] font-semibold text-neutral-700 tabular-nums">
                    {v}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                  {/* overflow-hidden: 20을 넘는 값이 들어와도 트랙을 넘지 않는다.
                      상세의 ScoreBars와 같은 색 매핑·같은 백분율 계산을 쓴다. */}
                  <div
                    className={cn("h-full rounded-full", AXIS_BAR_COLOR[a])}
                    style={{ width: `${axisPercent(v)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
