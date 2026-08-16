/**
 * 다섯 축 고정 색상의 유일한 정의처. Badge의 축 variant(이 폴더의 badge.tsx)와
 * apps/web의 세그먼트 바·상세 ScoreBars가 전부 이 객체 하나를 import해서 쓴다 —
 * 값을 다른 파일에 다시 적지 마라. packages/ui는 apps/web을 import할 수 없지만
 * 반대는 이미 성립하므로(apps/web이 @job-finder/ui에 의존), 여기 두는 쪽이 방향이 맞다.
 *
 * 색상환 위치는 Tailwind v4 팔레트의 -500 OKLCH hue 실측값이다
 * (node_modules/tailwindcss/theme.css):
 *   stack(lime) 130.85 · role(teal) 182.50 · domain(sky) 237.32 ·
 *   growth(indigo) 277.12 · conditions(fuchsia) 322.15
 * 인접 간격(축 순서대로, 막대에서 실제로 붙어 있는 쌍): 51.65 / 54.82 / 39.79 / 45.03도.
 * 최솟값 39.79도 — 이전 팔레트(green/cyan/blue/violet/fuchsia)는 65.6/44.6/32.9/29.4로
 * 뒤로 갈수록 좁아져 막대 끝에서 항상 붙어 있는 마지막 두 축(growth·conditions)이
 * 가장 구별하기 어려웠다. amber(warn, 70.08도)·red(에러, 25.33도)와는 전부 40도
 * 이상 떨어져 있다.
 */
export const AXIS_COLORS = {
  stack: { bar: 'bg-lime-500', chip: 'border-lime-300 bg-lime-50 text-lime-700' },
  role: { bar: 'bg-teal-500', chip: 'border-teal-300 bg-teal-50 text-teal-700' },
  domain: { bar: 'bg-sky-500', chip: 'border-sky-300 bg-sky-50 text-sky-700' },
  growth: { bar: 'bg-indigo-500', chip: 'border-indigo-300 bg-indigo-50 text-indigo-700' },
  conditions: { bar: 'bg-fuchsia-500', chip: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700' },
} as const

export type Axis = keyof typeof AXIS_COLORS
